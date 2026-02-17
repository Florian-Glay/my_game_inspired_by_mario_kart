export type GameScreen = 'home' | 'config' | 'cc' | 'characters' | 'circuit' | 'race';

export type RaceMode = 'solo' | 'multi';

export type CcLevel = '50cc' | '100cc' | '150cc' | '200cc';

export type CircuitId = 'ds_mario_circuit' | 'stadium' | 'super_bell_subway' | 'toad_harbor';

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

export type PlayerId = 'p1' | 'p2';

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
};

export type CarPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
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

export type RacePlayerConfig = {
  id: PlayerId;
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
  keyBindings: KeyBindings;
};

export type RaceConfig = {
  mode: RaceMode;
  cc: CcLevel;
  circuit: CircuitId;
  players: RacePlayerConfig[];
};
