import type { CcLevel, GrandPrixId, PlayerLoadoutSelection } from '../types/game';

export const ONLINE_LOBBY_PLAYER_CAPACITY = 12;
export const ONLINE_LOBBY_AUTO_START_MS = 10_000;

const ONLINE_LOBBY_STORAGE_KEY = 'mk-online-lobbies-v1';
const ONLINE_LOBBY_CHANNEL_NAME = 'mk-online-lobbies-channel-v1';
const ONLINE_LOBBY_PLAYER_STALE_MS = 15_000;
const ONLINE_LOBBY_LAUNCHED_STALE_MS = 45 * 60_000;

export type OnlineLobbyPlayerInput = {
  sessionId: string;
  name: string;
  loadout: PlayerLoadoutSelection;
};

export type OnlineLobbyPlayer = OnlineLobbyPlayerInput & {
  joinedAt: number;
  lastSeenAt: number;
};

export type OnlineLobbyLaunchBot = {
  botId: string;
  displayName: string;
  loadout: PlayerLoadoutSelection;
};

export type OnlineLobbyLaunchState = {
  token: string;
  launchedAt: number;
  grandPrixId: GrandPrixId;
  cc: CcLevel;
  players: OnlineLobbyPlayer[];
  bots: OnlineLobbyLaunchBot[];
};

export type OnlineLobbyStatus = 'waiting' | 'countdown' | 'launched';

export type OnlineLobby = {
  id: string;
  label: string;
  hostSessionId: string;
  createdAt: number;
  updatedAt: number;
  status: OnlineLobbyStatus;
  countdownEndsAt: number | null;
  players: OnlineLobbyPlayer[];
  launchState: OnlineLobbyLaunchState | null;
};

type OnlineLobbyStoreSnapshot = {
  version: 1;
  lobbies: OnlineLobby[];
};

const EMPTY_STORE: OnlineLobbyStoreSnapshot = {
  version: 1,
  lobbies: [],
};

const listeners = new Set<() => void>();
let browserEventsBound = false;
let broadcastChannel: BroadcastChannel | null = null;

function cloneLoadout(loadout: PlayerLoadoutSelection): PlayerLoadoutSelection {
  return {
    characterId: loadout.characterId,
    vehicleId: loadout.vehicleId,
    wheelId: loadout.wheelId,
  };
}

function clonePlayer(player: OnlineLobbyPlayer): OnlineLobbyPlayer {
  return {
    sessionId: player.sessionId,
    name: player.name,
    loadout: cloneLoadout(player.loadout),
    joinedAt: player.joinedAt,
    lastSeenAt: player.lastSeenAt,
  };
}

function cloneLaunchState(launchState: OnlineLobbyLaunchState | null): OnlineLobbyLaunchState | null {
  if (!launchState) return null;
  return {
    token: launchState.token,
    launchedAt: launchState.launchedAt,
    grandPrixId: launchState.grandPrixId,
    cc: launchState.cc,
    players: launchState.players.map(clonePlayer),
    bots: launchState.bots.map((bot) => ({
      botId: bot.botId,
      displayName: bot.displayName,
      loadout: cloneLoadout(bot.loadout),
    })),
  };
}

function cloneLobby(lobby: OnlineLobby): OnlineLobby {
  return {
    id: lobby.id,
    label: lobby.label,
    hostSessionId: lobby.hostSessionId,
    createdAt: lobby.createdAt,
    updatedAt: lobby.updatedAt,
    status: lobby.status,
    countdownEndsAt: lobby.countdownEndsAt,
    players: lobby.players.map(clonePlayer),
    launchState: cloneLaunchState(lobby.launchState),
  };
}

function createLobbyStoreSnapshot(lobbies: OnlineLobby[]): OnlineLobbyStoreSnapshot {
  return {
    version: 1,
    lobbies: lobbies.map(cloneLobby),
  };
}

function sanitizePlayerInput(player: OnlineLobbyPlayerInput) {
  const trimmedName = player.name.trim().slice(0, 24);
  return {
    sessionId: player.sessionId.trim(),
    name: trimmedName.length > 0 ? trimmedName : 'Pilote',
    loadout: cloneLoadout(player.loadout),
  };
}

function sanitizePlayer(player: OnlineLobbyPlayer, now: number): OnlineLobbyPlayer | null {
  const sanitized = sanitizePlayerInput(player);
  if (!sanitized.sessionId) return null;
  return {
    sessionId: sanitized.sessionId,
    name: sanitized.name,
    loadout: sanitized.loadout,
    joinedAt: Number.isFinite(player.joinedAt) ? player.joinedAt : now,
    lastSeenAt: Number.isFinite(player.lastSeenAt) ? player.lastSeenAt : now,
  };
}

function normalizePlayers(players: OnlineLobbyPlayer[], now: number) {
  const uniquePlayers = new Map<string, OnlineLobbyPlayer>();
  for (const rawPlayer of players) {
    const sanitizedPlayer = sanitizePlayer(rawPlayer, now);
    if (!sanitizedPlayer) continue;
    if (now - sanitizedPlayer.lastSeenAt > ONLINE_LOBBY_PLAYER_STALE_MS) continue;
    const existing = uniquePlayers.get(sanitizedPlayer.sessionId);
    if (!existing) {
      uniquePlayers.set(sanitizedPlayer.sessionId, sanitizedPlayer);
      continue;
    }

    uniquePlayers.set(sanitizedPlayer.sessionId, {
      ...sanitizedPlayer,
      joinedAt: Math.min(existing.joinedAt, sanitizedPlayer.joinedAt),
      lastSeenAt: Math.max(existing.lastSeenAt, sanitizedPlayer.lastSeenAt),
    });
  }

  return Array.from(uniquePlayers.values())
    .sort((left, right) => {
      if (left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
      return left.sessionId.localeCompare(right.sessionId);
    })
    .slice(0, ONLINE_LOBBY_PLAYER_CAPACITY);
}

function normalizeLobby(rawLobby: OnlineLobby, now: number): OnlineLobby | null {
  const players = normalizePlayers(rawLobby.players ?? [], now);
  if (players.length === 0) return null;

  const hostSessionId =
    players.some((player) => player.sessionId === rawLobby.hostSessionId) ?
      rawLobby.hostSessionId
    : players[0]?.sessionId ?? '';
  if (!hostSessionId) return null;

  const label = typeof rawLobby.label === 'string' && rawLobby.label.trim().length > 0 ? rawLobby.label.trim() : 'Lobby';
  const createdAt = Number.isFinite(rawLobby.createdAt) ? rawLobby.createdAt : now;
  let updatedAt = Number.isFinite(rawLobby.updatedAt) ? rawLobby.updatedAt : now;
  let status: OnlineLobbyStatus = rawLobby.status === 'launched' ? 'launched' : rawLobby.status === 'countdown' ? 'countdown' : 'waiting';
  let countdownEndsAt =
    status === 'countdown' && Number.isFinite(rawLobby.countdownEndsAt) ? rawLobby.countdownEndsAt : null;
  let launchState = cloneLaunchState(rawLobby.launchState);

  if (status === 'launched') {
    if (!launchState || now - updatedAt > ONLINE_LOBBY_LAUNCHED_STALE_MS) {
      return null;
    }
  } else if (players.length >= ONLINE_LOBBY_PLAYER_CAPACITY) {
    status = 'countdown';
    countdownEndsAt = countdownEndsAt ?? now + ONLINE_LOBBY_AUTO_START_MS;
    launchState = null;
  } else {
    status = 'waiting';
    countdownEndsAt = null;
    launchState = null;
  }

  updatedAt = Math.max(updatedAt, createdAt, ...players.map((player) => player.lastSeenAt));

  return {
    id: rawLobby.id,
    label,
    hostSessionId,
    createdAt,
    updatedAt,
    status,
    countdownEndsAt,
    players,
    launchState,
  };
}

function normalizeStore(rawStore: Partial<OnlineLobbyStoreSnapshot> | null | undefined, now = Date.now()) {
  const rawLobbies = Array.isArray(rawStore?.lobbies) ? rawStore.lobbies : [];
  const lobbies = rawLobbies
    .map((rawLobby) => normalizeLobby(rawLobby, now))
    .filter((lobby): lobby is OnlineLobby => Boolean(lobby))
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'launched' ? 1 : right.status === 'launched' ? -1 : 0;
      }
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
      return left.id.localeCompare(right.id);
    });
  return createLobbyStoreSnapshot(lobbies);
}

function readRawStore(): Partial<OnlineLobbyStoreSnapshot> | null {
  if (typeof window === 'undefined') return EMPTY_STORE;
  try {
    const serialized = window.localStorage.getItem(ONLINE_LOBBY_STORAGE_KEY);
    if (!serialized) return EMPTY_STORE;
    return JSON.parse(serialized) as Partial<OnlineLobbyStoreSnapshot>;
  } catch {
    return EMPTY_STORE;
  }
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function bindBrowserEvents() {
  if (browserEventsBound || typeof window === 'undefined') return;
  browserEventsBound = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== ONLINE_LOBBY_STORAGE_KEY) return;
    notifyListeners();
  });

  if (typeof BroadcastChannel === 'undefined') return;
  broadcastChannel = new BroadcastChannel(ONLINE_LOBBY_CHANNEL_NAME);
  broadcastChannel.addEventListener('message', () => {
    notifyListeners();
  });
}

function writeStore(store: OnlineLobbyStoreSnapshot) {
  if (typeof window === 'undefined') return;
  const normalizedStore = normalizeStore(store);
  window.localStorage.setItem(ONLINE_LOBBY_STORAGE_KEY, JSON.stringify(normalizedStore));
  broadcastChannel?.postMessage({ type: 'online-lobby-store-updated' });
  notifyListeners();
}

function mutateStore<T>(mutator: (store: OnlineLobbyStoreSnapshot, now: number) => T): T {
  const now = Date.now();
  const store = normalizeStore(readRawStore(), now);
  const result = mutator(store, now);
  writeStore(store);
  return result;
}

function upsertPlayer(players: OnlineLobbyPlayer[], input: OnlineLobbyPlayerInput, now: number) {
  const sanitized = sanitizePlayerInput(input);
  const nextPlayers = players.map(clonePlayer);
  const existingIndex = nextPlayers.findIndex((player) => player.sessionId === sanitized.sessionId);
  if (existingIndex >= 0) {
    const existing = nextPlayers[existingIndex];
    if (!existing) return nextPlayers;
    nextPlayers[existingIndex] = {
      ...existing,
      name: sanitized.name,
      loadout: sanitized.loadout,
      lastSeenAt: now,
    };
    return nextPlayers;
  }

  nextPlayers.push({
    sessionId: sanitized.sessionId,
    name: sanitized.name,
    loadout: sanitized.loadout,
    joinedAt: now,
    lastSeenAt: now,
  });
  return nextPlayers;
}

function removePlayerFromLobby(lobby: OnlineLobby, sessionId: string) {
  lobby.players = lobby.players.filter((player) => player.sessionId !== sessionId);
  if (lobby.hostSessionId === sessionId) {
    lobby.hostSessionId = lobby.players[0]?.sessionId ?? '';
  }
}

function removePlayerFromAllLobbies(store: OnlineLobbyStoreSnapshot, sessionId: string) {
  const nextLobbies: OnlineLobby[] = [];
  for (const lobby of store.lobbies) {
    const nextLobby = cloneLobby(lobby);
    removePlayerFromLobby(nextLobby, sessionId);
    const normalizedLobby = normalizeLobby(nextLobby, Date.now());
    if (normalizedLobby) {
      nextLobbies.push(normalizedLobby);
    }
  }
  store.lobbies = nextLobbies;
}

export function subscribeToOnlineLobbies(listener: () => void) {
  bindBrowserEvents();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOnlineLobbyStoreSnapshot() {
  bindBrowserEvents();
  return normalizeStore(readRawStore());
}

export function createOnlineLobby(playerInput: OnlineLobbyPlayerInput) {
  return mutateStore<OnlineLobby | null>((store, now) => {
    const sanitized = sanitizePlayerInput(playerInput);
    if (!sanitized.sessionId) return null;

    removePlayerFromAllLobbies(store, sanitized.sessionId);

    const lobby: OnlineLobby = {
      id: crypto.randomUUID(),
      label: `Lobby ${sanitized.name}`,
      hostSessionId: sanitized.sessionId,
      createdAt: now,
      updatedAt: now,
      status: 'waiting',
      countdownEndsAt: null,
      players: [
        {
          sessionId: sanitized.sessionId,
          name: sanitized.name,
          loadout: sanitized.loadout,
          joinedAt: now,
          lastSeenAt: now,
        },
      ],
      launchState: null,
    };

    store.lobbies = [...store.lobbies, lobby];
    return normalizeLobby(lobby, now);
  });
}

export function joinOnlineLobby(lobbyId: string, playerInput: OnlineLobbyPlayerInput) {
  return mutateStore<OnlineLobby | null>((store, now) => {
    const sanitized = sanitizePlayerInput(playerInput);
    if (!sanitized.sessionId) return null;

    removePlayerFromAllLobbies(store, sanitized.sessionId);

    const targetLobby = store.lobbies.find((lobby) => lobby.id === lobbyId);
    if (!targetLobby || targetLobby.status === 'launched') return null;

    if (
      targetLobby.players.length >= ONLINE_LOBBY_PLAYER_CAPACITY &&
      !targetLobby.players.some((player) => player.sessionId === sanitized.sessionId)
    ) {
      return null;
    }

    targetLobby.players = upsertPlayer(targetLobby.players, sanitized, now);
    targetLobby.updatedAt = now;
    return normalizeLobby(targetLobby, now);
  });
}

export function heartbeatOnlineLobby(lobbyId: string, playerInput: OnlineLobbyPlayerInput) {
  return mutateStore<OnlineLobby | null>((store, now) => {
    const sanitized = sanitizePlayerInput(playerInput);
    if (!sanitized.sessionId) return null;

    const targetLobby = store.lobbies.find((lobby) => lobby.id === lobbyId);
    if (!targetLobby) return null;
    if (!targetLobby.players.some((player) => player.sessionId === sanitized.sessionId)) return null;

    targetLobby.players = upsertPlayer(targetLobby.players, sanitized, now);
    targetLobby.updatedAt = now;
    return normalizeLobby(targetLobby, now);
  });
}

export function leaveOnlineLobby(lobbyId: string, sessionId: string) {
  return mutateStore<OnlineLobby | null>((store, now) => {
    const targetLobby = store.lobbies.find((lobby) => lobby.id === lobbyId);
    if (!targetLobby) return null;

    removePlayerFromLobby(targetLobby, sessionId);
    targetLobby.updatedAt = now;
    return normalizeLobby(targetLobby, now);
  });
}

export function launchOnlineLobby(
  lobbyId: string,
  buildLaunchState: (lobby: OnlineLobby) => OnlineLobbyLaunchState,
) {
  return mutateStore<OnlineLobby | null>((store, now) => {
    const targetLobby = store.lobbies.find((lobby) => lobby.id === lobbyId);
    if (!targetLobby) return null;

    const normalizedLobby = normalizeLobby(targetLobby, now);
    if (!normalizedLobby || normalizedLobby.status === 'launched') return normalizedLobby;

    const launchState = buildLaunchState(normalizedLobby);
    const players = launchState.players.map((player) => ({
      ...clonePlayer(player),
      lastSeenAt: now,
    }));

    targetLobby.status = 'launched';
    targetLobby.countdownEndsAt = null;
    targetLobby.updatedAt = launchState.launchedAt;
    targetLobby.players = players;
    targetLobby.launchState = cloneLaunchState(launchState);

    return normalizeLobby(targetLobby, now);
  });
}
