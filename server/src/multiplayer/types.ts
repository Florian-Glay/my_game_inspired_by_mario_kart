import type { WebSocket } from 'ws';
import type {
  MultiplayerGrandPrixId,
  MultiplayerLobbyPlayerState,
  MultiplayerLobbyState,
  MultiplayerRaceParticipantState,
  MultiplayerRaceState,
} from '../../../shared/multiplayerProtocol.ts';

export type SessionState = {
  sessionId: string;
  resumeToken: string;
  socket: WebSocket | null;
  currentLobbyId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
};

export type LobbyStateInternal = {
  id: string;
  code: string;
  hostSessionId: string;
  createdAt: number;
  updatedAt: number;
  status: MultiplayerLobbyState['status'];
  autoStartAt: number | null;
  maxPlayers: number;
  players: Map<string, MultiplayerLobbyPlayerState>;
  raceId: string | null;
};

export type RaceStateInternal = {
  raceId: string;
  lobbyId: string;
  status: MultiplayerRaceState['status'];
  grandPrixId: MultiplayerGrandPrixId;
  cc: MultiplayerRaceState['cc'];
  courseId: string;
  courseLabel: string;
  circuitId: string;
  courseIndex: number;
  totalCourses: number;
  countdownStartAt: number | null;
  startedAt: number | null;
  participants: Map<string, MultiplayerRaceParticipantState>;
  sharedState: MultiplayerRaceState['sharedState'];
  countdownTimer: NodeJS.Timeout | null;
  snapshotTimer: NodeJS.Timeout | null;
  throwableTimers: Map<string, NodeJS.Timeout>;
  objectCrateRespawnTimers: Map<string, NodeJS.Timeout>;
  trackCoinRespawnTimers: Map<string, NodeJS.Timeout>;
  resultAckSessionIds: Set<string>;
  hostCommandAdvanceTimer: NodeJS.Timeout | null;
  hostCommandAdvancePending: boolean;
};
