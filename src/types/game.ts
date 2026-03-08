export type GameScreen =
  | 'home'
  | 'config'
  | 'cc'
  | 'playercount'
  | 'characters'
  | 'circuit'
  | 'online-name'
  | 'online-lobby-menu'
  | 'online-lobby-browser'
  | 'online-lobby'
  | 'race';

export type RaceMode = 'solo' | 'multi' | 'online';

export type CcLevel = '50cc' | '100cc' | '150cc' | '200cc';

export type CircuitId =
  | 'ds_mario_circuit'
  | 'stadium'
  | 'super_bell_subway'
  | 'kalimari_desert';

export type GrandPrixId =
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

export type HumanPlayerSlotId = 'p1' | 'p2' | 'p3' | 'p4';
export type RaceParticipantId = string;
export type RaceParticipantKind = 'human' | 'remote' | 'bot';
export type ParticipantControlMode = 'human' | 'autopilot' | 'remote';

export type Vec3 = [number, number, number];

export type WheelSize = 'small' | 'normal' | 'large';

export type PlayerLoadoutSelection = {
  characterId: string;
  vehicleId: string;
  wheelId: string;
};

export type WheelMounts = [Vec3, Vec3, Vec3, Vec3];

export type KeyBindings = {
  forward: string[];
  back: string[];
  left: string[];
  right: string[];
  useObject?: string[];
};

export type CarPose = {
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

export type BotItemTacticalState = {
  currentPosition: number | null;
  leaderDistance: number | null;
  nearestOpponentAheadDistance: number | null;
  nearestOpponentBehindDistance: number | null;
  straightAheadTargetDistance: number | null;
  straightBehindTargetDistance: number | null;
};

export type RaceParticipantConfig = {
  id: RaceParticipantId;
  displayName: string;
  kind: RaceParticipantKind;
  humanSlotId?: HumanPlayerSlotId;
  controlMode: ParticipantControlMode;
  loadout: PlayerLoadoutSelection;
  vehicleModel: string;
  vehicleScale: Vec3;
  characterModel: string;
  characterScale: Vec3;
  wheelModel: string;
  wheelScale: Vec3;
  characterMount: Vec3;
  wheelMounts: WheelMounts;
  chassisLift: number;
  driverLift: number;
  spawn: Vec3;
  spawnRotation: Vec3;
  keyBindings?: KeyBindings;
};

export type RaceConfig = {
  mode: RaceMode;
  humanCount: number;
  cc: CcLevel;
  circuit: CircuitId;
  grandPrixId: GrandPrixId;
  courseId: string;
  courseLabel: string;
  courseIndex: number;
  totalCourses: number;
  participants: RaceParticipantConfig[];
};

export type CourseRankingEntry = {
  participantId: RaceParticipantId;
  displayName: string;
  position: number;
  lap: number;
  checkpointReached: boolean;
  finished: boolean;
};

export type CourseRaceResult = {
  grandPrixId: GrandPrixId;
  courseId: string;
  courseLabel: string;
  courseIndex: number;
  ranking: CourseRankingEntry[];
};

export type GrandPrixStanding = {
  participantId: RaceParticipantId;
  displayName: string;
  totalScore: number;
  courseScores: number[];
};
