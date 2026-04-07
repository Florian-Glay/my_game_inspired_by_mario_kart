import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { CIRCUITS, GRAND_PRIXS } from '../../src/config/raceCatalog.ts';
import {
  HOST,
  MAX_WS_PAYLOAD_BYTES,
  MULTIPLAYER_ONLINE_BOT_TARGET,
  PORT,
  RACE_SNAPSHOT_INTERVAL_MS,
  WS_PATH,
} from './multiplayer/config.ts';
import type { LobbyStateInternal, RaceStateInternal, SessionState } from './multiplayer/types.ts';
import {
  createBotLoadout,
  createInitialItemState,
  createInitialLapProgress,
  isBotSessionId,
  isOriginAllowed,
  sanitizeDisplayName,
  sanitizeLoadout,
} from './multiplayer/helpers.ts';
import {
  MULTIPLAYER_BOT_SESSION_ID_PREFIX,
  MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS,
  MULTIPLAYER_MAX_PLAYERS,
  MULTIPLAYER_OBJECT_CRATE_RESPAWN_MS,
  MULTIPLAYER_RECONNECT_GRACE_MS,
  MULTIPLAYER_START_COUNTDOWN_MS,
  MULTIPLAYER_START_WAIT_BEFORE_COUNTDOWN_MS,
  MULTIPLAYER_THROWABLE_MIN_TTL_MS,
  MULTIPLAYER_TRACK_COIN_RESPAWN_MS,
  type MultiplayerClientMessage,
  type MultiplayerGrandPrixId,
  type MultiplayerLobbyPlayerState,
  type MultiplayerLobbyState,
  type MultiplayerPlayerLoadout,
  type MultiplayerRaceEvent,
  type MultiplayerRaceParticipantState,
  type MultiplayerRaceState,
  type MultiplayerServerMessage,
  type MultiplayerSnapshot,
  type MultiplayerThrowableObjectState,
} from '../../shared/multiplayerProtocol.ts';

const sessionsById = new Map<string, SessionState>();
const sessionIdByResumeToken = new Map<string, string>();
const sessionIdBySocket = new Map<WebSocket, string>();
const lobbiesById = new Map<string, LobbyStateInternal>();
const racesById = new Map<string, RaceStateInternal>();
const lobbyAutoStartTimers = new Map<string, NodeJS.Timeout>();

function cloneLobbyPlayer(player: MultiplayerLobbyPlayerState): MultiplayerLobbyPlayerState {
  return {
    sessionId: player.sessionId,
    displayName: player.displayName,
    loadout: sanitizeLoadout(player.loadout),
    connected: player.connected,
    joinedAt: player.joinedAt,
  };
}

function cloneRaceParticipant(player: MultiplayerRaceParticipantState): MultiplayerRaceParticipantState {
  return {
    participantId: player.participantId,
    sessionId: player.sessionId,
    displayName: player.displayName,
    loadout: sanitizeLoadout(player.loadout),
    connected: player.connected,
    loaded: player.loaded,
    pose: player.pose ? { ...player.pose } : null,
    lapProgress: { ...player.lapProgress },
    itemState: { ...player.itemState },
  };
}

function cloneThrowableObject(throwable: MultiplayerThrowableObjectState): MultiplayerThrowableObjectState {
  return {
    throwableId: throwable.throwableId,
    sourceObjectValue: throwable.sourceObjectValue,
    ownerParticipantId: throwable.ownerParticipantId,
    behavior: throwable.behavior,
    modelPath: throwable.modelPath,
    spawnPosition: [...throwable.spawnPosition] as [number, number, number],
    launchVelocity: [...throwable.launchVelocity] as [number, number, number],
    ttlMs: throwable.ttlMs,
  };
}

function getOrderedLobbyPlayers(lobby: LobbyStateInternal) {
  return Array.from(lobby.players.values()).sort((left, right) => {
    if (left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
    return left.sessionId.localeCompare(right.sessionId);
  });
}

function getOrderedRaceParticipants(race: RaceStateInternal) {
  return Array.from(race.participants.values());
}

function serializeLobby(lobby: LobbyStateInternal): MultiplayerLobbyState {
  return {
    id: lobby.id,
    code: lobby.code,
    hostSessionId: lobby.hostSessionId,
    createdAt: lobby.createdAt,
    updatedAt: lobby.updatedAt,
    status: lobby.status,
    autoStartAt: lobby.autoStartAt,
    maxPlayers: lobby.maxPlayers,
    players: getOrderedLobbyPlayers(lobby).map(cloneLobbyPlayer),
    raceId: lobby.raceId,
  };
}

function serializeRace(race: RaceStateInternal): MultiplayerRaceState {
  return {
    raceId: race.raceId,
    lobbyId: race.lobbyId,
    status: race.status,
    grandPrixId: race.grandPrixId,
    cc: race.cc,
    courseId: race.courseId,
    courseLabel: race.courseLabel,
    circuitId: race.circuitId,
    courseIndex: race.courseIndex,
    totalCourses: race.totalCourses,
    countdownStartAt: race.countdownStartAt,
    startedAt: race.startedAt,
    participants: getOrderedRaceParticipants(race).map(cloneRaceParticipant),
    sharedState: {
      activeObjectCrateIds:
        race.sharedState.activeObjectCrateIds ? [...race.sharedState.activeObjectCrateIds] : null,
      activeTrackCoinIds:
        race.sharedState.activeTrackCoinIds ? [...race.sharedState.activeTrackCoinIds] : null,
      throwableObjects: race.sharedState.throwableObjects.map(cloneThrowableObject),
    },
  };
}

function buildSnapshot(session: SessionState): Omit<MultiplayerSnapshot, 'connectionStatus' | 'connectionError'> {
  const currentLobby =
    session.currentLobbyId ? lobbiesById.get(session.currentLobbyId) ?? null : null;
  const currentRace =
    currentLobby?.raceId ? racesById.get(currentLobby.raceId) ?? null : null;

  const lobbies = Array.from(lobbiesById.values())
    .sort((left, right) => {
      if (left.status !== right.status) {
        if (left.status === 'racing') return 1;
        if (right.status === 'racing') return -1;
      }
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
      return left.id.localeCompare(right.id);
    })
    .map(serializeLobby);

  return {
    sessionId: session.sessionId,
    resumeToken: session.resumeToken,
    serverTime: Date.now(),
    lobbies,
    currentLobbyId: currentLobby?.id ?? null,
    currentLobby: currentLobby ? serializeLobby(currentLobby) : null,
    currentRace: currentRace ? serializeRace(currentRace) : null,
  };
}

function sendMessage(socket: WebSocket, message: MultiplayerServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, message: string) {
  sendMessage(socket, {
    type: 'error',
    message,
  });
}

function sendSnapshot(session: SessionState) {
  if (!session.socket) return;
  sendMessage(session.socket, {
    type: 'state:snapshot',
    snapshot: buildSnapshot(session),
  });
}

function sendSnapshotsToSessions(sessions: Iterable<SessionState>) {
  const uniqueSessions = new Map<string, SessionState>();
  for (const session of sessions) {
    if (!session.socket) continue;
    uniqueSessions.set(session.sessionId, session);
  }
  uniqueSessions.forEach((session) => {
    sendSnapshot(session);
  });
}

function broadcastSnapshots() {
  sendSnapshotsToSessions(sessionsById.values());
}

function getSessionsForLobby(lobbyId: string) {
  return Array.from(sessionsById.values()).filter((session) => session.currentLobbyId === lobbyId);
}

function broadcastSnapshotsForLobby(lobbyId: string) {
  sendSnapshotsToSessions(getSessionsForLobby(lobbyId));
}

function clearRaceSnapshotTimer(race: RaceStateInternal) {
  if (!race.snapshotTimer) return;
  clearTimeout(race.snapshotTimer);
  race.snapshotTimer = null;
}

function scheduleRaceSnapshotBroadcast(
  race: RaceStateInternal,
  delayMs = RACE_SNAPSHOT_INTERVAL_MS,
) {
  if (race.snapshotTimer) return;
  race.snapshotTimer = setTimeout(() => {
    const refreshedRace = racesById.get(race.raceId);
    if (!refreshedRace) return;
    refreshedRace.snapshotTimer = null;
    broadcastSnapshotsForLobby(refreshedRace.lobbyId);
  }, Math.max(0, delayMs));
}

function flushRaceSnapshotBroadcast(race: RaceStateInternal) {
  clearRaceSnapshotTimer(race);
  broadcastSnapshotsForLobby(race.lobbyId);
}

function getSessionFromSocket(socket: WebSocket) {
  const sessionId = sessionIdBySocket.get(socket);
  if (!sessionId) return null;
  return sessionsById.get(sessionId) ?? null;
}

function generateLobbyCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'X';
    }
    const exists = Array.from(lobbiesById.values()).some((lobby) => lobby.code === code);
    if (!exists) return code;
  }
  return crypto.randomUUID().slice(0, 6).toUpperCase();
}

function clearLobbyAutoStartTimer(lobbyId: string) {
  const timer = lobbyAutoStartTimers.get(lobbyId);
  if (!timer) return;
  clearTimeout(timer);
  lobbyAutoStartTimers.delete(lobbyId);
}

function removeRace(raceId: string | null) {
  if (!raceId) return;
  const race = racesById.get(raceId);
  if (!race) return;
  if (race.countdownTimer) {
    clearTimeout(race.countdownTimer);
    race.countdownTimer = null;
  }
  clearRaceSnapshotTimer(race);
  race.throwableTimers.forEach((timer) => clearTimeout(timer));
  race.throwableTimers.clear();
  race.objectCrateRespawnTimers.forEach((timer) => clearTimeout(timer));
  race.objectCrateRespawnTimers.clear();
  race.trackCoinRespawnTimers.forEach((timer) => clearTimeout(timer));
  race.trackCoinRespawnTimers.clear();
  if (race.hostCommandAdvanceTimer) {
    clearTimeout(race.hostCommandAdvanceTimer);
    race.hostCommandAdvanceTimer = null;
  }
  race.hostCommandAdvancePending = false;
  racesById.delete(raceId);
}

function cloneRaceParticipantForNextCourse(
  participant: MultiplayerRaceParticipantState,
): MultiplayerRaceParticipantState {
  return {
    participantId: participant.participantId,
    sessionId: participant.sessionId,
    displayName: participant.displayName,
    loadout: sanitizeLoadout(participant.loadout),
    connected: participant.connected,
    loaded: isBotSessionId(participant.sessionId) || !participant.connected,
    pose: null,
    lapProgress: createInitialLapProgress(),
    itemState: createInitialItemState(),
  };
}

function createRaceParticipantsForLobby(lobby: LobbyStateInternal) {
  const participants = new Map<string, MultiplayerRaceParticipantState>();
  getOrderedLobbyPlayers(lobby).forEach((player) => {
    participants.set(player.sessionId, {
      participantId: `player-${player.sessionId}`,
      sessionId: player.sessionId,
      displayName: player.displayName,
      loadout: sanitizeLoadout(player.loadout),
      connected: player.connected,
      loaded: !player.connected,
      pose: null,
      lapProgress: createInitialLapProgress(),
      itemState: createInitialItemState(),
    });
  });

  const botCount = Math.max(0, MULTIPLAYER_ONLINE_BOT_TARGET - participants.size);
  for (let botIndex = 0; botIndex < botCount; botIndex += 1) {
    const botSessionId = `${MULTIPLAYER_BOT_SESSION_ID_PREFIX}${botIndex + 1}`;
    participants.set(botSessionId, {
      participantId: botSessionId,
      sessionId: botSessionId,
      displayName: `Bot ${botIndex + 1}`,
      loadout: createBotLoadout(botIndex),
      connected: true,
      loaded: true,
      pose: null,
      lapProgress: createInitialLapProgress(),
      itemState: createInitialItemState(),
    });
  }

  return participants;
}

function createRaceForLobbyCourse(options: {
  lobbyId: string;
  grandPrixId: MultiplayerGrandPrixId;
  cc: MultiplayerRaceState['cc'];
  courseIndex: number;
  totalCourses: number;
  participants: Map<string, MultiplayerRaceParticipantState>;
}) {
  const selectedGrandPrix = GRAND_PRIXS[options.grandPrixId];
  const selectedCourse = selectedGrandPrix?.courses[options.courseIndex];
  if (!selectedGrandPrix || !selectedCourse) return null;

  const circuitConfig = CIRCUITS[selectedCourse.circuitId];
  if (!circuitConfig) return null;

  return {
    raceId: crypto.randomUUID(),
    lobbyId: options.lobbyId,
    status: 'loading',
    grandPrixId: options.grandPrixId,
    cc: options.cc,
    courseId: selectedCourse.id,
    courseLabel: selectedCourse.label,
    circuitId: selectedCourse.circuitId,
    courseIndex: options.courseIndex,
    totalCourses: options.totalCourses,
    countdownStartAt: null,
    startedAt: null,
    participants: options.participants,
    sharedState: {
      activeObjectCrateIds: circuitConfig.objectCrateSpawns.map((_, index) => `${selectedCourse.id}-crate-${index}`),
      activeTrackCoinIds: circuitConfig.coinSpawns.map((_, index) => `${selectedCourse.id}-coin-${index}`),
      throwableObjects: [],
    },
    countdownTimer: null,
    snapshotTimer: null,
    throwableTimers: new Map<string, NodeJS.Timeout>(),
    objectCrateRespawnTimers: new Map<string, NodeJS.Timeout>(),
    trackCoinRespawnTimers: new Map<string, NodeJS.Timeout>(),
    resultAckSessionIds: new Set<string>(),
    hostCommandAdvanceTimer: null,
    hostCommandAdvancePending: false,
  } satisfies RaceStateInternal;
}

function getResultAcknowledgementRequiredSessionIds(race: RaceStateInternal) {
  return Array.from(race.participants.values())
    .filter((participant) => !isBotSessionId(participant.sessionId) && participant.connected)
    .map((participant) => participant.sessionId);
}

function advanceRaceToNextCourse(race: RaceStateInternal) {
  if (race.courseIndex + 1 >= race.totalCourses) return false;

  const lobby = lobbiesById.get(race.lobbyId);
  if (!lobby) return false;

  const nextParticipants = new Map<string, MultiplayerRaceParticipantState>();
  race.participants.forEach((participant, sessionId) => {
    nextParticipants.set(sessionId, cloneRaceParticipantForNextCourse(participant));
  });

  const nextRace = createRaceForLobbyCourse({
    lobbyId: lobby.id,
    grandPrixId: race.grandPrixId,
    cc: race.cc,
    courseIndex: race.courseIndex + 1,
    totalCourses: race.totalCourses,
    participants: nextParticipants,
  });
  if (!nextRace) return false;

  racesById.set(nextRace.raceId, nextRace);
  lobby.raceId = nextRace.raceId;
  lobby.status = 'loading';
  lobby.autoStartAt = null;
  lobby.updatedAt = Date.now();
  removeRace(race.raceId);
  broadcastSnapshotsForLobby(lobby.id);
  return true;
}

function maybeAdvanceRaceAfterResultAcknowledgements(race: RaceStateInternal) {
  if (race.status !== 'finished') return false;
  if (race.hostCommandAdvancePending) return false;
  if (race.courseIndex + 1 >= race.totalCourses) return false;

  const requiredSessionIds = getResultAcknowledgementRequiredSessionIds(race);
  const everyoneAcknowledged = requiredSessionIds.every((sessionId) =>
    race.resultAckSessionIds.has(sessionId),
  );
  if (!everyoneAcknowledged) return false;

  return advanceRaceToNextCourse(race);
}

function scheduleRaceAdvanceAfterDelay(race: RaceStateInternal, delayMs: number) {
  if (race.status !== 'finished') return false;
  if (race.courseIndex + 1 >= race.totalCourses) return false;

  if (race.hostCommandAdvancePending) return true;
  race.hostCommandAdvancePending = true;

  if (race.hostCommandAdvanceTimer) {
    clearTimeout(race.hostCommandAdvanceTimer);
  }
  race.hostCommandAdvanceTimer = setTimeout(() => {
    const refreshedRace = racesById.get(race.raceId);
    if (!refreshedRace) return;
    refreshedRace.hostCommandAdvanceTimer = null;
    refreshedRace.hostCommandAdvancePending = false;

    if (advanceRaceToNextCourse(refreshedRace)) return;
    flushRaceSnapshotBroadcast(refreshedRace);
  }, Math.max(0, delayMs));

  return true;
}

function deleteLobby(lobbyId: string | null) {
  if (!lobbyId) return;
  const lobby = lobbiesById.get(lobbyId);
  if (!lobby) return;
  clearLobbyAutoStartTimer(lobby.id);
  removeRace(lobby.raceId);
  lobbiesById.delete(lobby.id);
}

function syncLobbyState(lobby: LobbyStateInternal | null) {
  if (!lobby) return;

  if (lobby.players.size === 0) {
    deleteLobby(lobby.id);
    return;
  }

  if (!lobby.players.has(lobby.hostSessionId)) {
    lobby.hostSessionId = getOrderedLobbyPlayers(lobby)[0]?.sessionId ?? lobby.hostSessionId;
  }

  const race = lobby.raceId ? racesById.get(lobby.raceId) ?? null : null;
  if (race) {
    lobby.status =
      race.status === 'loading' ? 'loading'
      : race.status === 'countdown' || race.status === 'running' || race.status === 'finished' ? 'racing'
      : 'racing';
    lobby.autoStartAt = null;
    clearLobbyAutoStartTimer(lobby.id);
    lobby.updatedAt = Date.now();
    return;
  }

  lobby.status = 'waiting';
  lobby.autoStartAt = null;
  clearLobbyAutoStartTimer(lobby.id);

  lobby.updatedAt = Date.now();
}

function upsertLobbyPlayer(
  lobby: LobbyStateInternal,
  sessionId: string,
  displayName: string,
  loadout: MultiplayerPlayerLoadout,
) {
  const now = Date.now();
  const existing = lobby.players.get(sessionId);
  lobby.players.set(sessionId, {
    sessionId,
    displayName: sanitizeDisplayName(displayName),
    loadout: sanitizeLoadout(loadout),
    connected: true,
    joinedAt: existing?.joinedAt ?? now,
  });
  lobby.updatedAt = now;
}

function maybeMarkRaceFinished(race: RaceStateInternal) {
  if (race.status !== 'running') return false;

  const nonBotParticipants = Array.from(race.participants.values()).filter(
    (participant) => !isBotSessionId(participant.sessionId),
  );
  const participantsToTrack =
    nonBotParticipants.length > 0 ? nonBotParticipants : Array.from(race.participants.values());
  const everyoneFinishedOrDisconnected = participantsToTrack.every(
    (participant) => participant.lapProgress.finished || !participant.connected,
  );
  if (!everyoneFinishedOrDisconnected) return false;

  race.status = 'finished';
  race.countdownStartAt = null;
  race.resultAckSessionIds.clear();

  const lobby = lobbiesById.get(race.lobbyId);
  if (lobby) {
    lobby.status = 'racing';
    lobby.autoStartAt = null;
    lobby.updatedAt = Date.now();
  }

  scheduleRaceAdvanceAfterDelay(race, MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS);

  return true;
}

function getRaceParticipantByParticipantId(
  race: RaceStateInternal,
  participantId: string,
) {
  for (const participant of race.participants.values()) {
    if (participant.participantId === participantId) {
      return participant;
    }
  }
  return null;
}

function canSessionControlParticipant(
  session: SessionState,
  race: RaceStateInternal,
  participant: MultiplayerRaceParticipantState,
) {
  if (participant.sessionId === session.sessionId) return true;
  if (!isBotSessionId(participant.sessionId)) return false;

  const lobby = lobbiesById.get(race.lobbyId);
  return lobby?.hostSessionId === session.sessionId;
}

function resolveAuthorizedRaceParticipant(
  session: SessionState,
  race: RaceStateInternal,
  participantId: string,
) {
  const participant = getRaceParticipantByParticipantId(race, participantId);
  if (!participant) return null;
  if (!canSessionControlParticipant(session, race, participant)) return null;
  return participant;
}

function getRaceEventParticipantId(event: MultiplayerRaceEvent) {
  if (event.type === 'throwable-spawned') {
    return event.throwable.ownerParticipantId;
  }
  return event.participantId;
}

function leaveCurrentLobby(session: SessionState) {
  const lobbyId = session.currentLobbyId;
  if (!lobbyId) return;
  const lobby = lobbiesById.get(lobbyId);
  session.currentLobbyId = null;
  if (!lobby) return;

  lobby.players.delete(session.sessionId);
  if (lobby.raceId) {
    const race = racesById.get(lobby.raceId);
    if (race) {
      race.participants.delete(session.sessionId);
      if (race.participants.size === 0) {
        removeRace(race.raceId);
        lobby.raceId = null;
      } else if (race.status === 'finished') {
        maybeAdvanceRaceAfterResultAcknowledgements(race);
      }
    }
  }

  syncLobbyState(lobby);
}

function scheduleDisconnectCleanup(session: SessionState) {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
  }
  session.disconnectTimer = setTimeout(() => {
    session.disconnectTimer = null;
    const lobby = session.currentLobbyId ? lobbiesById.get(session.currentLobbyId) ?? null : null;
    if (lobby) {
      const player = lobby.players.get(session.sessionId);
      if (player) {
        player.connected = false;
        lobby.players.set(session.sessionId, player);
      }

      if (!lobby.raceId) {
        lobby.players.delete(session.sessionId);
        session.currentLobbyId = null;
      } else {
        const race = racesById.get(lobby.raceId);
        const raceParticipant = race?.participants.get(session.sessionId);
        if (raceParticipant) {
          raceParticipant.connected = false;
          raceParticipant.loaded = true;
          race?.participants.set(session.sessionId, raceParticipant);
          if (race) {
            maybeMarkRaceFinished(race);
            maybeAdvanceRaceAfterResultAcknowledgements(race);
          }
        }
      }

      syncLobbyState(lobby);
    }

    broadcastSnapshots();
  }, MULTIPLAYER_RECONNECT_GRACE_MS);
}

function attachSocketToSession(session: SessionState, socket: WebSocket) {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }

  if (session.socket && session.socket !== socket) {
    sessionIdBySocket.delete(session.socket);
    try {
      session.socket.close();
    } catch {
      // ignore stale socket close failure
    }
  }

  session.socket = socket;
  sessionIdBySocket.set(socket, session.sessionId);

  const lobby = session.currentLobbyId ? lobbiesById.get(session.currentLobbyId) ?? null : null;
  if (lobby) {
    const player = lobby.players.get(session.sessionId);
    if (player) {
      player.connected = true;
      lobby.players.set(session.sessionId, player);
    }

    const race = lobby.raceId ? racesById.get(lobby.raceId) ?? null : null;
    if (race) {
      const raceParticipant = race.participants.get(session.sessionId);
      if (raceParticipant) {
        raceParticipant.connected = true;
        race.participants.set(session.sessionId, raceParticipant);
      }
    }
  }
}

function createSession() {
  const sessionId = crypto.randomUUID();
  const resumeToken = crypto.randomUUID();
  const session: SessionState = {
    sessionId,
    resumeToken,
    socket: null,
    currentLobbyId: null,
    disconnectTimer: null,
  };
  sessionsById.set(sessionId, session);
  sessionIdByResumeToken.set(resumeToken, sessionId);
  return session;
}

function resolveSession(resumeToken?: string) {
  if (resumeToken) {
    const existingSessionId = sessionIdByResumeToken.get(resumeToken);
    if (existingSessionId) {
      const existingSession = sessionsById.get(existingSessionId);
      if (existingSession) return existingSession;
    }
  }
  return createSession();
}

function startRaceForLobby(
  lobby: LobbyStateInternal,
  grandPrixId: MultiplayerGrandPrixId,
  cc: MultiplayerRaceState['cc'],
) {
  if (lobby.raceId) return;

  const selectedGrandPrix = GRAND_PRIXS[grandPrixId];
  if (!selectedGrandPrix) return;

  clearLobbyAutoStartTimer(lobby.id);
  const race = createRaceForLobbyCourse({
    lobbyId: lobby.id,
    grandPrixId,
    cc,
    courseIndex: 0,
    totalCourses: selectedGrandPrix.courses.length,
    participants: createRaceParticipantsForLobby(lobby),
  });
  if (!race) return;

  racesById.set(race.raceId, race);
  lobby.raceId = race.raceId;
  lobby.status = 'loading';
  lobby.autoStartAt = null;
  lobby.updatedAt = Date.now();
  broadcastSnapshots();
}

function handleRaceLoaded(session: SessionState, raceId: string) {
  const race = racesById.get(raceId);
  if (!race) return;
  const participant = race.participants.get(session.sessionId);
  if (!participant) return;
  participant.loaded = true;
  participant.connected = true;
  race.participants.set(session.sessionId, participant);

  const everyoneLoaded = Array.from(race.participants.values()).every((entry) => entry.loaded);
  if (everyoneLoaded && race.status === 'loading') {
    race.status = 'countdown';
    race.countdownStartAt = Date.now() + MULTIPLAYER_START_WAIT_BEFORE_COUNTDOWN_MS;
    if (race.countdownTimer) {
      clearTimeout(race.countdownTimer);
    }
    race.countdownTimer = setTimeout(() => {
      const refreshedRace = racesById.get(race.raceId);
      if (!refreshedRace) return;
      refreshedRace.status = 'running';
      refreshedRace.startedAt = Date.now();
      refreshedRace.countdownStartAt = null;
      refreshedRace.countdownTimer = null;
      flushRaceSnapshotBroadcast(refreshedRace);
    }, MULTIPLAYER_START_WAIT_BEFORE_COUNTDOWN_MS + MULTIPLAYER_START_COUNTDOWN_MS);
  }

  flushRaceSnapshotBroadcast(race);
}

function handleRaceResultAcknowledgement(session: SessionState, raceId: string) {
  const race = racesById.get(raceId);
  if (!race || race.status !== 'finished') return;
  if (race.courseIndex + 1 >= race.totalCourses) return;

  const participant = race.participants.get(session.sessionId);
  if (!participant || isBotSessionId(participant.sessionId) || !participant.connected) return;

  race.resultAckSessionIds.add(session.sessionId);
  if (maybeAdvanceRaceAfterResultAcknowledgements(race)) return;

  flushRaceSnapshotBroadcast(race);
}

function handleRaceHostCommand(
  socket: WebSocket,
  session: SessionState,
  raceId: string,
  command: 'gmp',
) {
  const race = racesById.get(raceId);
  if (!race) return;

  const lobby = lobbiesById.get(race.lobbyId);
  if (!lobby) return;
  if (lobby.hostSessionId !== session.sessionId) {
    sendError(socket, 'Seul le host peut utiliser cette commande.');
    return;
  }

  if (command !== 'gmp') return;
  if (race.courseIndex + 1 >= race.totalCourses) {
    sendError(socket, 'Aucune course suivante disponible pour ce Grand Prix.');
    return;
  }

  if (race.status !== 'running' && race.status !== 'countdown' && race.status !== 'finished') {
    sendError(socket, 'La commande gmp est disponible uniquement pendant la course.');
    return;
  }

  if (race.countdownTimer) {
    clearTimeout(race.countdownTimer);
    race.countdownTimer = null;
  }

  race.status = 'finished';
  race.countdownStartAt = null;
  race.startedAt ??= Date.now();
  race.resultAckSessionIds.clear();

  lobby.status = 'racing';
  lobby.autoStartAt = null;
  lobby.updatedAt = Date.now();

  scheduleRaceAdvanceAfterDelay(race, MULTIPLAYER_HOST_COMMAND_GMP_ADVANCE_DELAY_MS);

  flushRaceSnapshotBroadcast(race);
}

function scheduleObjectCrateRespawn(race: RaceStateInternal, crateId: string) {
  const existingTimer = race.objectCrateRespawnTimers.get(crateId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  race.objectCrateRespawnTimers.set(
    crateId,
    setTimeout(() => {
      const refreshedRace = racesById.get(race.raceId);
      if (!refreshedRace) return;
      refreshedRace.objectCrateRespawnTimers.delete(crateId);

      const activeCrates = refreshedRace.sharedState.activeObjectCrateIds ?? [];
      if (!activeCrates.includes(crateId)) {
        refreshedRace.sharedState.activeObjectCrateIds = [...activeCrates, crateId];
        scheduleRaceSnapshotBroadcast(refreshedRace, 0);
      }
    }, MULTIPLAYER_OBJECT_CRATE_RESPAWN_MS),
  );
}

function scheduleTrackCoinRespawn(race: RaceStateInternal, coinId: string) {
  const existingTimer = race.trackCoinRespawnTimers.get(coinId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  race.trackCoinRespawnTimers.set(
    coinId,
    setTimeout(() => {
      const refreshedRace = racesById.get(race.raceId);
      if (!refreshedRace) return;
      refreshedRace.trackCoinRespawnTimers.delete(coinId);

      const activeCoins = refreshedRace.sharedState.activeTrackCoinIds ?? [];
      if (!activeCoins.includes(coinId)) {
        refreshedRace.sharedState.activeTrackCoinIds = [...activeCoins, coinId];
        scheduleRaceSnapshotBroadcast(refreshedRace, 0);
      }
    }, MULTIPLAYER_TRACK_COIN_RESPAWN_MS),
  );
}

function clearThrowableTimer(race: RaceStateInternal, throwableId: string) {
  const existingTimer = race.throwableTimers.get(throwableId);
  if (!existingTimer) return;
  clearTimeout(existingTimer);
  race.throwableTimers.delete(throwableId);
}

function removeThrowableFromRace(race: RaceStateInternal, throwableId: string) {
  const nextThrowableObjects = race.sharedState.throwableObjects.filter(
    (entry) => entry.throwableId !== throwableId,
  );
  const removed = nextThrowableObjects.length !== race.sharedState.throwableObjects.length;
  race.sharedState.throwableObjects = nextThrowableObjects;
  clearThrowableTimer(race, throwableId);
  return removed;
}

function removeThrowableAfterTtl(race: RaceStateInternal, throwableId: string, ttlMs: number) {
  clearThrowableTimer(race, throwableId);
  race.throwableTimers.set(
    throwableId,
    setTimeout(() => {
      const refreshedRace = racesById.get(race.raceId);
      if (!refreshedRace) return;
      if (!removeThrowableFromRace(refreshedRace, throwableId)) return;
      scheduleRaceSnapshotBroadcast(refreshedRace, 0);
    }, Math.max(MULTIPLAYER_THROWABLE_MIN_TTL_MS, ttlMs)),
  );
}

function handleRaceEvent(session: SessionState, raceId: string, event: MultiplayerRaceEvent) {
  const race = racesById.get(raceId);
  if (!race) return;
  const participant = resolveAuthorizedRaceParticipant(session, race, getRaceEventParticipantId(event));
  if (!participant) return;

  switch (event.type) {
    case 'object-crate-collected':
      if (race.sharedState.activeObjectCrateIds) {
        const crateWasActive = race.sharedState.activeObjectCrateIds.includes(event.crateId);
        if (crateWasActive) {
          race.sharedState.activeObjectCrateIds = race.sharedState.activeObjectCrateIds.filter(
            (crateId) => crateId !== event.crateId,
          );
          scheduleObjectCrateRespawn(race, event.crateId);
        }
      }
      break;
    case 'track-coin-collected':
      if (race.sharedState.activeTrackCoinIds) {
        const coinWasActive = race.sharedState.activeTrackCoinIds.includes(event.coinId);
        if (coinWasActive) {
          race.sharedState.activeTrackCoinIds = race.sharedState.activeTrackCoinIds.filter(
            (coinId) => coinId !== event.coinId,
          );
          scheduleTrackCoinRespawn(race, event.coinId);
          participant.itemState.coins = Math.min(10, participant.itemState.coins + 1);
          race.participants.set(participant.sessionId, participant);
        }
      }
      break;
    case 'lap-trigger':
      if (event.triggerType === 'lap-checkpoint') {
        participant.lapProgress.checkpoint = true;
      } else if (participant.lapProgress.checkpoint && !participant.lapProgress.finished) {
        participant.lapProgress.lap += 1;
        participant.lapProgress.checkpoint = false;
        participant.lapProgress.finished = participant.lapProgress.lap >= 4;
        participant.lapProgress.finishTimestamp =
          participant.lapProgress.finished ? Date.now() : null;
      }
      race.participants.set(participant.sessionId, participant);
      break;
    case 'object-used':
      if (event.usedObject === 13) {
        participant.itemState.coins = Math.min(10, participant.itemState.coins + 2);
        race.participants.set(participant.sessionId, participant);
      }
      break;
    case 'object-consumed':
      if (participant.itemState.heldObject !== event.consumedObject) {
        participant.itemState.heldObject = 0;
        participant.itemState.objectCharges = 0;
      } else {
        participant.itemState.objectCharges = Math.max(
          0,
          participant.itemState.objectCharges - Math.max(1, event.consumedUnits),
        );
        if (participant.itemState.objectCharges <= 0) {
          participant.itemState.heldObject = 0;
        }
      }
      race.participants.set(participant.sessionId, participant);
      break;
    case 'throwable-spawned':
      race.sharedState.throwableObjects = [
        ...race.sharedState.throwableObjects.filter(
          (throwable) => throwable.throwableId !== event.throwable.throwableId,
        ),
        cloneThrowableObject(event.throwable),
      ];
      removeThrowableAfterTtl(race, event.throwable.throwableId, event.throwable.ttlMs);
      break;
    case 'throwable-removed':
      removeThrowableFromRace(race, event.throwableId);
      break;
  }

  race.participants.set(participant.sessionId, participant);
  const raceFinished = maybeMarkRaceFinished(race);
  if (raceFinished) {
    flushRaceSnapshotBroadcast(race);
    return;
  }

  scheduleRaceSnapshotBroadcast(race);
}

function handleSocketMessage(socket: WebSocket, rawMessage: RawData) {
  let parsedMessage: MultiplayerClientMessage | null = null;
  try {
    parsedMessage = JSON.parse(rawMessage.toString()) as MultiplayerClientMessage;
  } catch {
    sendError(socket, 'Message JSON invalide.');
    return;
  }

  if (!parsedMessage || typeof parsedMessage !== 'object' || !('type' in parsedMessage)) {
    sendError(socket, 'Message invalide.');
    return;
  }

  if (parsedMessage.type === 'session:hello') {
    const session = resolveSession(parsedMessage.resumeToken);
    attachSocketToSession(session, socket);
    sendMessage(socket, {
      type: 'session:ack',
      sessionId: session.sessionId,
      resumeToken: session.resumeToken,
      serverTime: Date.now(),
    });
    broadcastSnapshots();
    return;
  }

  const session = getSessionFromSocket(socket);
  if (!session) {
    sendError(socket, 'Session non initialisee.');
    return;
  }

  switch (parsedMessage.type) {
    case 'lobby:create': {
      leaveCurrentLobby(session);
      const now = Date.now();
      const lobby: LobbyStateInternal = {
        id: crypto.randomUUID(),
        code: generateLobbyCode(),
        hostSessionId: session.sessionId,
        createdAt: now,
        updatedAt: now,
        status: 'waiting',
        autoStartAt: null,
        maxPlayers: MULTIPLAYER_MAX_PLAYERS,
        players: new Map(),
        raceId: null,
      };
      upsertLobbyPlayer(lobby, session.sessionId, parsedMessage.displayName, parsedMessage.loadout);
      lobbiesById.set(lobby.id, lobby);
      session.currentLobbyId = lobby.id;
      syncLobbyState(lobby);
      broadcastSnapshots();
      return;
    }
    case 'lobby:join': {
      const normalizedJoinCode = parsedMessage.code?.trim().toUpperCase();
      const targetLobby =
        parsedMessage.lobbyId ? lobbiesById.get(parsedMessage.lobbyId) ?? null
        : normalizedJoinCode ?
          Array.from(lobbiesById.values()).find((lobby) => lobby.code === normalizedJoinCode) ?? null
        : null;
      if (!targetLobby) {
        sendError(socket, 'Lobby introuvable.');
        return;
      }
      if (targetLobby.raceId) {
        sendError(socket, 'Ce lobby est deja en course.');
        return;
      }
      if (
        targetLobby.players.size >= targetLobby.maxPlayers &&
        !targetLobby.players.has(session.sessionId)
      ) {
        sendError(socket, 'Ce lobby est complet.');
        return;
      }
      leaveCurrentLobby(session);
      upsertLobbyPlayer(targetLobby, session.sessionId, parsedMessage.displayName, parsedMessage.loadout);
      session.currentLobbyId = targetLobby.id;
      syncLobbyState(targetLobby);
      broadcastSnapshots();
      return;
    }
    case 'lobby:update-profile': {
      const lobby = session.currentLobbyId ? lobbiesById.get(session.currentLobbyId) ?? null : null;
      if (!lobby) return;
      upsertLobbyPlayer(lobby, session.sessionId, parsedMessage.displayName, parsedMessage.loadout);
      if (lobby.raceId) {
        const race = racesById.get(lobby.raceId);
        const participant = race?.participants.get(session.sessionId);
        if (race && participant && race.status === 'loading') {
          participant.displayName = sanitizeDisplayName(parsedMessage.displayName);
          participant.loadout = sanitizeLoadout(parsedMessage.loadout);
          race.participants.set(session.sessionId, participant);
        }
      }
      syncLobbyState(lobby);
      broadcastSnapshots();
      return;
    }
    case 'lobby:leave':
      leaveCurrentLobby(session);
      broadcastSnapshots();
      return;
    case 'lobby:start-race': {
      const lobby = session.currentLobbyId ? lobbiesById.get(session.currentLobbyId) ?? null : null;
      if (!lobby) {
        sendError(socket, 'Aucun lobby courant.');
        return;
      }
      if (lobby.hostSessionId !== session.sessionId) {
        sendError(socket, 'Seul le host peut lancer la course.');
        return;
      }
      startRaceForLobby(lobby, parsedMessage.grandPrixId, parsedMessage.cc);
      return;
    }
    case 'race:loaded':
      handleRaceLoaded(session, parsedMessage.raceId);
      return;
    case 'race:ack-result':
      handleRaceResultAcknowledgement(session, parsedMessage.raceId);
      return;
    case 'race:pose': {
      const race = racesById.get(parsedMessage.raceId);
      const participant =
        race ? resolveAuthorizedRaceParticipant(session, race, parsedMessage.participantId) : null;
      if (!race || !participant) return;
      participant.pose = { ...parsedMessage.pose };
      if (parsedMessage.lapProgress) {
        participant.lapProgress = { ...parsedMessage.lapProgress };
      }
      if (parsedMessage.itemState) {
        participant.itemState = { ...parsedMessage.itemState };
      }
      race.participants.set(participant.sessionId, participant);
      const raceFinished = maybeMarkRaceFinished(race);
      if (raceFinished) {
        flushRaceSnapshotBroadcast(race);
        return;
      }

      scheduleRaceSnapshotBroadcast(race);
      return;
    }
    case 'race:event':
      handleRaceEvent(session, parsedMessage.raceId, parsedMessage.event);
      return;
    case 'race:host-command':
      handleRaceHostCommand(socket, session, parsedMessage.raceId, parsedMessage.command);
      return;
    default:
      return;
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, lobbies: lobbiesById.size, races: racesById.size }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Mario Kart multiplayer server is running.\n');
});

const websocketServer = new WebSocketServer({
  server: httpServer,
  path: WS_PATH,
  maxPayload: MAX_WS_PAYLOAD_BYTES,
});

websocketServer.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  const originHeader = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (!isOriginAllowed(originHeader)) {
    socket.close(1008, 'Origin refusee.');
    return;
  }

  socket.on('message', (message: RawData) => {
    handleSocketMessage(socket, message);
  });

  socket.on('close', () => {
    const session = getSessionFromSocket(socket);
    if (!session) return;
    sessionIdBySocket.delete(socket);
    if (session.socket === socket) {
      session.socket = null;
      scheduleDisconnectCleanup(session);
    }
  });

  socket.on('error', () => {
    // The close handler performs cleanup.
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[multiplayer-server] listening on http://${HOST}:${PORT}`);
  console.log(`[multiplayer-server] websocket path ${WS_PATH}`);
});
