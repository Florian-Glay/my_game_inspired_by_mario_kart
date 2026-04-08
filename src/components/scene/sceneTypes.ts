import type { BotWaypoint } from '../../ai/botAutopilot';
import type {
  CarPose,
  CourseRaceResult,
  GrandPrixStanding,
  RaceConfig,
  RaceParticipantId,
} from '../../types/game';
import type { MultiplayerRaceEvent, MultiplayerRaceState } from '../../../shared/multiplayerProtocol';

export type SceneProps = {
  raceConfig: RaceConfig;
  onRaceBack: () => void;
  onCourseFinished: (result: CourseRaceResult) => void;
  onNextCourse: () => Promise<void> | void;
  hasNextCourse: boolean;
  isAdvancingCourse: boolean;
  grandPrixStandings: GrandPrixStanding[];
  networkRaceState?: MultiplayerRaceState | null;
  networkOwnedParticipantIds?: string[];
  onNetworkSceneReady?: (raceId: string) => void;
  onNetworkLocalPose?: (
    raceId: string,
    participantId: string,
    pose: CarPose,
    options?: {
      lapProgress?: MultiplayerRaceState['participants'][number]['lapProgress'];
      itemState?: MultiplayerRaceState['participants'][number]['itemState'];
    },
  ) => void;
  onNetworkRaceEvent?: (raceId: string, event: MultiplayerRaceEvent) => void;
  onNetworkCourseResultValidated?: (raceId: string) => void;
  onRendererPerformanceSample?: (sample: RendererPerformanceSample) => void;
};

export type RendererPerformanceSample = {
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
};

export type WaypointTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export type LapTriggerType = 'lap-start' | 'lap-checkpoint';

export type PlayerLapProgress = {
  lap: number;
  checkpoint: boolean;
  finished: boolean;
  finishTimestamp: number | null;
};

export type RaceOverlayStep = 'none' | 'course-ranking' | 'grand-prix-result';

export type LiveScoreboardEntry = {
  participantId: RaceParticipantId;
  displayName: string;
  position: number;
  completedLaps: number;
  checkpoint: boolean;
  finished: boolean;
};

export type ObjectCrateSpawnEntry = {
  crateId: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type TrackCoinSpawnEntry = {
  coinId: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

export type ThrowableObjectEntry = {
  throwableId: string;
  sourceObjectValue: number;
  ownerParticipantId: RaceParticipantId;
  behavior: 'banana' | 'green-shell' | 'red-shell' | 'blue-shell' | 'bomb';
  modelPath: string;
  spawnPosition: [number, number, number];
  launchVelocity: [number, number, number];
  ttlMs: number;
};

export type CircuitWaypointLoaderProps = {
  model: string;
  transform: WaypointTransform;
  onReady: (waypoints: BotWaypoint[]) => void;
};
