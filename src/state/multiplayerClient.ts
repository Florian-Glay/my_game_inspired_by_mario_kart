import type {
  MultiplayerClientMessage,
  MultiplayerGrandPrixId,
  MultiplayerLobbyPlayerState,
  MultiplayerPlayerLoadout,
  MultiplayerPose,
  MultiplayerRaceEvent,
  MultiplayerRaceState,
  MultiplayerSnapshot,
} from '../../shared/multiplayerProtocol';

const MULTIPLAYER_RESUME_TOKEN_STORAGE_KEY = 'mk-multiplayer-resume-token';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 5000;

type LocalMultiplayerSnapshot = MultiplayerSnapshot;

const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let manuallyDisconnected = false;
let outboundQueue: MultiplayerClientMessage[] = [];
let pendingSnapshotMessage: Omit<MultiplayerSnapshot, 'connectionStatus' | 'connectionError'> | null = null;
let snapshotAnimationFrame: number | null = null;

let snapshot: LocalMultiplayerSnapshot = {
  connectionStatus: 'disconnected',
  sessionId: null,
  resumeToken: null,
  serverTime: null,
  lobbies: [],
  currentLobbyId: null,
  currentLobby: null,
  currentRace: null,
  connectionError: null,
};

function notify() {
  listeners.forEach((listener) => listener());
}

function setSnapshot(partial: Partial<LocalMultiplayerSnapshot>) {
  snapshot = {
    ...snapshot,
    ...partial,
  };
  notify();
}

function applyServerSnapshot(messageSnapshot: Omit<MultiplayerSnapshot, 'connectionStatus' | 'connectionError'>) {
  if (typeof window === 'undefined') {
    setSnapshot({
      connectionStatus: 'connected',
      sessionId: messageSnapshot.sessionId ?? snapshot.sessionId,
      resumeToken: messageSnapshot.resumeToken ?? snapshot.resumeToken,
      serverTime: messageSnapshot.serverTime ?? Date.now(),
      lobbies: Array.isArray(messageSnapshot.lobbies) ? messageSnapshot.lobbies : [],
      currentLobbyId: messageSnapshot.currentLobbyId ?? null,
      currentLobby: messageSnapshot.currentLobby ?? null,
      currentRace: messageSnapshot.currentRace ?? null,
      connectionError: null,
    });
    return;
  }

  pendingSnapshotMessage = messageSnapshot;
  if (snapshotAnimationFrame !== null) return;

  snapshotAnimationFrame = window.requestAnimationFrame(() => {
    snapshotAnimationFrame = null;
    const nextSnapshot = pendingSnapshotMessage;
    pendingSnapshotMessage = null;
    if (!nextSnapshot) return;

    setSnapshot({
      connectionStatus: 'connected',
      sessionId: nextSnapshot.sessionId ?? snapshot.sessionId,
      resumeToken: nextSnapshot.resumeToken ?? snapshot.resumeToken,
      serverTime: nextSnapshot.serverTime ?? Date.now(),
      lobbies: Array.isArray(nextSnapshot.lobbies) ? nextSnapshot.lobbies : [],
      currentLobbyId: nextSnapshot.currentLobbyId ?? null,
      currentLobby: nextSnapshot.currentLobby ?? null,
      currentRace: nextSnapshot.currentRace ?? null,
      connectionError: null,
    });
  });
}

function getStoredResumeToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(MULTIPLAYER_RESUME_TOKEN_STORAGE_KEY);
}

function persistResumeToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(MULTIPLAYER_RESUME_TOKEN_STORAGE_KEY, token);
    return;
  }
  window.localStorage.removeItem(MULTIPLAYER_RESUME_TOKEN_STORAGE_KEY);
}

function getWebSocketUrl() {
  const configuredUrl = import.meta.env.VITE_MULTIPLAYER_WS_URL as string | undefined;
  if (configuredUrl && configuredUrl.trim().length > 0) {
    return configuredUrl.trim();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isLocalDevPort = window.location.port === '5173';
  const host =
    isLocalDevPort ? `${window.location.hostname}:8787`
    : window.location.host;
  return `${protocol}//${host}/ws`;
}

function flushQueue() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const queuedMessages = outboundQueue;
  outboundQueue = [];
  queuedMessages.forEach((message) => {
    socket?.send(JSON.stringify(message));
  });
}

function enqueueOrSend(message: MultiplayerClientMessage) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return;
  }

  if (message.type === 'race:pose') {
    outboundQueue = outboundQueue.filter(
      (queuedMessage) =>
        !(
          queuedMessage.type === 'race:pose' &&
          queuedMessage.raceId === message.raceId &&
          queuedMessage.participantId === message.participantId
        ),
    );
  }

  if (message.type === 'lobby:update-profile') {
    outboundQueue = outboundQueue.filter((queuedMessage) => queuedMessage.type !== 'lobby:update-profile');
  }

  outboundQueue.push(message);
}

function scheduleReconnect() {
  if (manuallyDisconnected || reconnectTimer !== null || typeof window === 'undefined') return;
  const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * (reconnectAttempt + 1));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempt += 1;
    connectMultiplayerClient();
  }, delay);
}

export function connectMultiplayerClient() {
  if (typeof window === 'undefined') return;
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  manuallyDisconnected = false;
  setSnapshot({
    connectionStatus: 'connecting',
    connectionError: null,
  });

  socket = new window.WebSocket(getWebSocketUrl());

  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
    enqueueOrSend({
      type: 'session:hello',
      resumeToken: snapshot.resumeToken ?? getStoredResumeToken() ?? undefined,
    });
    flushQueue();
  });

  socket.addEventListener('message', (event) => {
    let message: any = null;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      setSnapshot({
        connectionError: 'Message serveur invalide.',
      });
      return;
    }

    if (message.type === 'session:ack') {
      const resumeToken = typeof message.resumeToken === 'string' ? message.resumeToken : null;
      persistResumeToken(resumeToken);
      setSnapshot({
        connectionStatus: 'connected',
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : null,
        resumeToken,
        serverTime: typeof message.serverTime === 'number' ? message.serverTime : Date.now(),
        connectionError: null,
      });
      flushQueue();
      return;
    }

    if (message.type === 'state:snapshot' && message.snapshot) {
      applyServerSnapshot(message.snapshot);
      return;
    }

    if (message.type === 'error') {
      setSnapshot({
        connectionError: typeof message.message === 'string' ? message.message : 'Erreur serveur.',
      });
    }
  });

  socket.addEventListener('close', () => {
    socket = null;
    if (snapshotAnimationFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(snapshotAnimationFrame);
      snapshotAnimationFrame = null;
    }
    pendingSnapshotMessage = null;
    setSnapshot({
      connectionStatus: 'disconnected',
    });
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    setSnapshot({
      connectionError: 'Connexion WebSocket indisponible.',
    });
  });
}

export function disconnectMultiplayerClient() {
  manuallyDisconnected = true;
  if (reconnectTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (snapshotAnimationFrame !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(snapshotAnimationFrame);
    snapshotAnimationFrame = null;
  }
  pendingSnapshotMessage = null;
  socket?.close();
  socket = null;
  setSnapshot({
    connectionStatus: 'disconnected',
  });
}

export function subscribeToMultiplayerState(listener: () => void) {
  listeners.add(listener);
  connectMultiplayerClient();
  return () => {
    listeners.delete(listener);
  };
}

export function getMultiplayerStateSnapshot() {
  snapshot.resumeToken ??= getStoredResumeToken();
  return snapshot;
}

function sendLobbyProfileMessage(
  type: 'lobby:create' | 'lobby:join' | 'lobby:update-profile',
  options: {
    displayName: string;
    loadout: MultiplayerPlayerLoadout;
    lobbyId?: string;
    code?: string;
  },
) {
  connectMultiplayerClient();
  enqueueOrSend({
    type,
    displayName: options.displayName.trim(),
    loadout: {
      characterId: options.loadout.characterId,
      vehicleId: options.loadout.vehicleId,
      wheelId: options.loadout.wheelId,
    },
    ...(options.lobbyId ? { lobbyId: options.lobbyId } : {}),
    ...(options.code ? { code: options.code } : {}),
  } as MultiplayerClientMessage);
}

export function createServerLobby(player: { name: string; loadout: MultiplayerPlayerLoadout }) {
  sendLobbyProfileMessage('lobby:create', {
    displayName: player.name,
    loadout: player.loadout,
  });
}

export function joinServerLobby(lobbyId: string, player: { name: string; loadout: MultiplayerPlayerLoadout }) {
  sendLobbyProfileMessage('lobby:join', {
    lobbyId,
    displayName: player.name,
    loadout: player.loadout,
  });
}

export function joinServerLobbyByCode(code: string, player: { name: string; loadout: MultiplayerPlayerLoadout }) {
  sendLobbyProfileMessage('lobby:join', {
    code: code.trim().toUpperCase(),
    displayName: player.name,
    loadout: player.loadout,
  });
}

export function updateServerLobbyProfile(player: { name: string; loadout: MultiplayerPlayerLoadout }) {
  sendLobbyProfileMessage('lobby:update-profile', {
    displayName: player.name,
    loadout: player.loadout,
  });
}

export function leaveServerLobby() {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'lobby:leave',
  });
}

export function startServerRace(grandPrixId: MultiplayerGrandPrixId, cc: MultiplayerRaceState['cc']) {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'lobby:start-race',
    grandPrixId,
    cc,
  });
}

export function markServerRaceLoaded(raceId: string) {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'race:loaded',
    raceId,
  });
}

export function acknowledgeServerRaceResult(raceId: string) {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'race:ack-result',
    raceId,
  });
}

export function sendServerRaceHostCommand(raceId: string, command: 'gmp') {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'race:host-command',
    raceId,
    command,
  });
}

export function publishServerRacePose(
  raceId: string,
  participantId: string,
  pose: MultiplayerPose,
  options?: {
    lapProgress?: MultiplayerRaceState['participants'][number]['lapProgress'];
    itemState?: MultiplayerRaceState['participants'][number]['itemState'];
  },
) {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'race:pose',
    raceId,
    participantId,
    pose,
    ...(options?.lapProgress ? { lapProgress: options.lapProgress } : {}),
    ...(options?.itemState ? { itemState: options.itemState } : {}),
  });
}

export function sendServerRaceEvent(raceId: string, event: MultiplayerRaceEvent) {
  connectMultiplayerClient();
  enqueueOrSend({
    type: 'race:event',
    raceId,
    event,
  });
}

export function getCurrentLobbyPlayer(sessionId: string | null) {
  if (!sessionId || !snapshot.currentLobby) return null;
  return (
    snapshot.currentLobby.players.find((player: MultiplayerLobbyPlayerState) => player.sessionId === sessionId) ?? null
  );
}

export function getCurrentRaceParticipant(sessionId: string | null) {
  if (!sessionId || !snapshot.currentRace) return null;
  return (
    snapshot.currentRace.participants.find((participant) => participant.sessionId === sessionId) ?? null
  );
}
