export type MultiplayerCcLevel = '50cc' | '100cc' | '150cc' | '200cc';

export type MultiplayerGrandPrixId =
  | 'mushroom_cup'
  | 'flower_cup'
  | 'star_cup'
  | 'special_cup'
  | 'shell_cup'
  | 'banana_cup'
  | 'leaf_cup'
  | 'lightning_cup'
  | 'egg_cup'
  | 'triforce_cup'
  | 'crossing_cup'
  | 'bell_cup';

export type MultiplayerPlayerLoadout = {
  characterId: string;
  vehicleId: string;
  wheelId: string;
};

export type MultiplayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed?: number;
  boostActive?: boolean;
  forwardX?: number;
  forwardY?: number;
  forwardZ?: number;
  upX?: number;
  upY?: number;
  upZ?: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
};

export type MultiplayerLapProgress = {
  lap: number;
  checkpoint: boolean;
  finished: boolean;
  finishTimestamp: number | null;
};

export type MultiplayerParticipantItemState = {
  heldObject: number;
  objectCharges: number;
  coins: number;
  thunderDebuffUntilTimestampMs: number;
  bulletBillUntilTimestampMs: number;
  stunUntilTimestampMs: number;
};

export type MultiplayerThrowableObjectState = {
  throwableId: string;
  sourceObjectValue: number;
  ownerParticipantId: string;
  behavior: 'banana' | 'green-shell' | 'red-shell' | 'blue-shell' | 'bomb';
  modelPath: string;
  spawnPosition: [number, number, number];
  launchVelocity: [number, number, number];
  ttlMs: number;
};

export type MultiplayerRaceSharedState = {
  activeObjectCrateIds: string[] | null;
  activeTrackCoinIds: string[] | null;
  throwableObjects: MultiplayerThrowableObjectState[];
};

export type MultiplayerThrowableRemovalReason = 'expired' | 'hit' | 'detonated' | 'despawned';

export type MultiplayerLobbyPlayerState = {
  sessionId: string;
  displayName: string;
  loadout: MultiplayerPlayerLoadout;
  connected: boolean;
  joinedAt: number;
};

export type MultiplayerLobbyStatus = 'waiting' | 'countdown' | 'loading' | 'racing';

export type MultiplayerLobbyState = {
  id: string;
  code: string;
  hostSessionId: string;
  createdAt: number;
  updatedAt: number;
  status: MultiplayerLobbyStatus;
  autoStartAt: number | null;
  maxPlayers: number;
  players: MultiplayerLobbyPlayerState[];
  raceId: string | null;
};

export type MultiplayerRaceParticipantState = {
  participantId: string;
  sessionId: string;
  displayName: string;
  loadout: MultiplayerPlayerLoadout;
  connected: boolean;
  loaded: boolean;
  pose: MultiplayerPose | null;
  lapProgress: MultiplayerLapProgress;
  itemState: MultiplayerParticipantItemState;
};

export type MultiplayerRaceStatus = 'loading' | 'countdown' | 'running' | 'finished';

export type MultiplayerRaceState = {
  raceId: string;
  lobbyId: string;
  status: MultiplayerRaceStatus;
  grandPrixId: MultiplayerGrandPrixId;
  cc: MultiplayerCcLevel;
  courseId: string;
  courseLabel: string;
  circuitId: string;
  courseIndex: number;
  totalCourses: number;
  countdownStartAt: number | null;
  startedAt: number | null;
  participants: MultiplayerRaceParticipantState[];
  sharedState: MultiplayerRaceSharedState;
};

export type MultiplayerSnapshot = {
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  sessionId: string | null;
  resumeToken: string | null;
  serverTime: number | null;
  lobbies: MultiplayerLobbyState[];
  currentLobbyId: string | null;
  currentLobby: MultiplayerLobbyState | null;
  currentRace: MultiplayerRaceState | null;
  connectionError: string | null;
};

export type MultiplayerRaceEvent =
  | {
      type: 'object-crate-collected';
      participantId: string;
      crateId: string;
    }
  | {
      type: 'track-coin-collected';
      participantId: string;
      coinId: string;
    }
  | {
      type: 'lap-trigger';
      participantId: string;
      triggerType: 'lap-start' | 'lap-checkpoint';
    }
  | {
      type: 'object-used';
      participantId: string;
      usedObject: number;
    }
  | {
      type: 'object-consumed';
      participantId: string;
      consumedObject: number;
      consumedUnits: number;
    }
  | {
      type: 'throwable-spawned';
      throwable: MultiplayerThrowableObjectState;
    }
  | {
      type: 'throwable-removed';
      participantId: string;
      throwableId: string;
      reason: MultiplayerThrowableRemovalReason;
    };

export type MultiplayerClientMessage =
  | {
      type: 'session:hello';
      resumeToken?: string;
    }
  | {
      type: 'lobby:create';
      displayName: string;
      loadout: MultiplayerPlayerLoadout;
    }
  | {
      type: 'lobby:join';
      lobbyId?: string;
      code?: string;
      displayName: string;
      loadout: MultiplayerPlayerLoadout;
    }
  | {
      type: 'lobby:update-profile';
      displayName: string;
      loadout: MultiplayerPlayerLoadout;
    }
  | {
      type: 'lobby:leave';
    }
  | {
      type: 'lobby:start-race';
      grandPrixId: MultiplayerGrandPrixId;
      cc: MultiplayerCcLevel;
    }
  | {
      type: 'race:loaded';
      raceId: string;
    }
  | {
      type: 'race:ack-result';
      raceId: string;
    }
  | {
      type: 'race:pose';
      raceId: string;
      participantId: string;
      pose: MultiplayerPose;
      lapProgress?: MultiplayerLapProgress;
      itemState?: MultiplayerParticipantItemState;
    }
  | {
      type: 'race:event';
      raceId: string;
      event: MultiplayerRaceEvent;
    };

export type MultiplayerServerMessage =
  | {
      type: 'session:ack';
      sessionId: string;
      resumeToken: string;
      serverTime: number;
    }
  | {
      type: 'state:snapshot';
      snapshot: Omit<MultiplayerSnapshot, 'connectionStatus' | 'connectionError'>;
    }
  | {
      type: 'error';
      message: string;
    };

export const MULTIPLAYER_BOT_SESSION_ID_PREFIX = 'bot-';
export const MULTIPLAYER_MAX_PLAYERS = 12;
export const MULTIPLAYER_LOBBY_AUTO_START_MS = 10_000;
export const MULTIPLAYER_RECONNECT_GRACE_MS = 15_000;
export const MULTIPLAYER_START_WAIT_BEFORE_COUNTDOWN_MS = 5_000;
export const MULTIPLAYER_START_COUNTDOWN_MS = 3_000;
export const MULTIPLAYER_OBJECT_CRATE_RESPAWN_MS = 10_000;
export const MULTIPLAYER_TRACK_COIN_RESPAWN_MS = 10_000;
export const MULTIPLAYER_THROWABLE_MIN_TTL_MS = 250;

export function isMultiplayerBotSessionId(sessionId: string) {
  return sessionId.startsWith(MULTIPLAYER_BOT_SESSION_ID_PREFIX);
}

export function getMultiplayerBotOrdinal(sessionId: string) {
  if (!isMultiplayerBotSessionId(sessionId)) return null;
  const ordinal = Number.parseInt(sessionId.slice(MULTIPLAYER_BOT_SESSION_ID_PREFIX.length), 10);
  if (!Number.isFinite(ordinal) || ordinal <= 0) return null;
  return ordinal;
}

export function getOnlineRaceBotControllerSessionId(
  botSessionId: string,
  participants: Array<{
    sessionId: string;
    connected: boolean;
  }>,
) {
  const botOrdinal = getMultiplayerBotOrdinal(botSessionId);
  if (botOrdinal === null) return null;

  const connectedHumans = participants
    .filter((participant) => !isMultiplayerBotSessionId(participant.sessionId) && participant.connected)
    .map((participant) => participant.sessionId);
  const allHumans = participants
    .filter((participant) => !isMultiplayerBotSessionId(participant.sessionId))
    .map((participant) => participant.sessionId);
  const controllerPool = connectedHumans.length > 0 ? connectedHumans : allHumans;
  if (controllerPool.length === 0) return null;

  return controllerPool[(botOrdinal - 1) % controllerPool.length] ?? null;
}
