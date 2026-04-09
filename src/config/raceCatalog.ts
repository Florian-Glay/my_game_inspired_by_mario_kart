import type {
  CcLevel,
  CircuitId,
  GrandPrixId,
  HumanPlayerSlotId,
  KeyBindings,
  Vec3,
} from '../types/game';

type SurfaceConfig = {
  model: string;
  drag: number;
  friction: number;
  restitution: number;
};

type TransformConfig = {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

type SurfaceTriggerConfig = SurfaceConfig & {
  transform: TransformConfig;
};

type BoosterTriggerConfig = {
  model: string;
  duration: number;
  strength: number;
  transform: TransformConfig;
};

type WaypointPathConfig = {
  model: string;
  transform?: TransformConfig;
};

export type CircuitPerformanceConfig = {
  maxVisibleDistance: number;
  cullConeDot: number;
  cullNearDistance: number;
};

export type VehicleAttachmentConfig = {
  enabled: boolean;
  maxAttachAngleDeg: number;
  probeDistance: number;
  stickForce: number;
  maxSlopeClimbAngleDeg: number;
  detachGraceMs: number;
  allowedSurfaces: 'road-ext' | 'all' | 'by-circuit';
  loopSlopeClimbAngleDeg: number;
  loopSlopeSlideAngleDeg: number;
};

export type CircuitConfig = {
  id: CircuitId;
  label: string;
  transform: TransformConfig;
  spawnSlots: SpawnSlot[];
  objectCrateSpawns: ObjectCrateSpawn[];
  coinSpawns: TrackCoinSpawn[];
  road: SurfaceConfig;
  ext: SurfaceConfig;
  antiGravIn?: SurfaceTriggerConfig;
  antiGravOut?: SurfaceTriggerConfig;
  booster?: BoosterTriggerConfig;
  gliderOn?: SurfaceTriggerConfig;
  lapStart?: SurfaceTriggerConfig;
  lapCheckpoint?: SurfaceTriggerConfig;
  waypoints?: WaypointPathConfig;
  performance: CircuitPerformanceConfig;
  vehicleAttachment: VehicleAttachmentConfig;
};

export type SpawnSlot = {
  position: Vec3;
  rotation: Vec3;
};

export type ObjectCrateSpawn = {
  position: Vec3;
  rotation: Vec3;
};

export type TrackCoinSpawn = {
  position: Vec3;
  rotation: Vec3;
};

export type GrandPrixCoursePreview = {
  id: string;
  origin: string;
  label: string;
  previewImage: string;
  circuitId: CircuitId;
};

type GrandPrixCourseSeed = {
  origin: string;
  label: string;
  previewIndex: number;
  circuitId: CircuitId;
};

type GrandPrixCourseSeedSet = [
  GrandPrixCourseSeed,
  GrandPrixCourseSeed,
  GrandPrixCourseSeed,
  GrandPrixCourseSeed,
];

type GrandPrixCourseSet = [
  GrandPrixCoursePreview,
  GrandPrixCoursePreview,
  GrandPrixCoursePreview,
  GrandPrixCoursePreview,
];

export type GrandPrixConfig = {
  id: GrandPrixId;
  label: string;
  badgeImage: string;
  badgeAlt: string;
  courses: GrandPrixCourseSet;
};

export const HERO_IMAGE_PATH = 'ui/home-hero.png';

export const CIRCUIT_ORDER: CircuitId[] = [
  'ds_mario_circuit',
  'stadium',
  'super_bell_subway',
  'kalimari_desert',
];

export const CC_ORDER: CcLevel[] = ['50cc', '100cc', '150cc', '200cc'];
export const TOTAL_RACE_PARTICIPANTS = 12;
export const MAX_LOCAL_HUMANS = 4;

const GRAND_PRIX_BADGE_BASE_PATH = 'ui/grand-prix/badges';
const GRAND_PRIX_COURSE_PREVIEW_BASE_PATH = 'ui/grand-prix/courses';

function getGrandPrixCoursePreviewPath(previewIndex: number) {
  return `${GRAND_PRIX_COURSE_PREVIEW_BASE_PATH}/preview-${String(previewIndex).padStart(2, '0')}.png`;
}

function createGrandPrix(
  id: GrandPrixId,
  label: string,
  badgeAlt: string,
  courseSeeds: GrandPrixCourseSeedSet,
): GrandPrixConfig {
  const courses = courseSeeds.map((courseSeed, index) => ({
    id: `${id}-course-${index + 1}`,
    origin: courseSeed.origin,
    label: courseSeed.label,
    previewImage: getGrandPrixCoursePreviewPath(courseSeed.previewIndex),
    circuitId: courseSeed.circuitId,
  })) as GrandPrixCourseSet;

  return {
    id,
    label,
    badgeImage: `${GRAND_PRIX_BADGE_BASE_PATH}/${id}.png` ? `${GRAND_PRIX_BADGE_BASE_PATH}/${id}.png` : `${GRAND_PRIX_BADGE_BASE_PATH}/${id}.svg`,
    badgeAlt,
    courses,
  };
}

export const GRAND_PRIX_ORDER: GrandPrixId[] = [
  'mushroom_cup',
  'flower_cup',
  'star_cup',
  'special_cup',
  'egg_cup',
  'crossing_cup',
  'shell_cup',
  'banana_cup',
  'leaf_cup',
  'lightning_cup',
  'triforce_cup',
  'bell_cup',
];

export const PLAYER_KEY_BINDINGS: Record<HumanPlayerSlotId, KeyBindings> = {
  p1: {
    forward: ['z', 'w', 'arrowup'],
    back: ['s', 'arrowdown'],
    left: ['q', 'a', 'arrowleft'],
    right: ['d', 'arrowright'],
    useObject: ['e'],
  },
  p2: {
    forward: ['arrowup'],
    back: ['arrowdown'],
    left: ['arrowleft'],
    right: ['arrowright'],
    useObject: ['shift'],
  },
  p3: {
    forward: ['i'],
    back: ['k'],
    left: ['j'],
    right: ['l'],
    useObject: ['o'],
  },
  p4: {
    forward: ['numpad8', '8'],
    back: ['numpad5', '5'],
    left: ['numpad4', '4'],
    right: ['numpad6', '6'],
    useObject: ['numpad7', '7'],
  },
};

export const CC_SPEEDS: Record<
  CcLevel,
  { maxForward: number; maxBackward: number; maxYawRate: number }
> = {
  '50cc': { maxForward: 25, maxBackward: 16, maxYawRate: 1.75 },
  '100cc': { maxForward: 40, maxBackward: 25, maxYawRate: 1.75 },
  '150cc': { maxForward: 55, maxBackward: 34, maxYawRate: 1.8 },
  '200cc': { maxForward: 70, maxBackward: 44, maxYawRate: 2.0 },
};

const CULL_CONE_DOT_120 = Math.cos((60 * Math.PI) / 180);

const marioTransform = {
  position: [0, -60, 0] as Vec3,
  rotation: [0, 0, 0] as Vec3,
  scale: [1, 1, 1] as Vec3,
};

const stadiumTransformGravIn: TransformConfig = {
  position: [0, 0, 200],
  rotation: [0, 0, 0],
  scale: [3, 3, 3],
};

const stadiumTransformGravOut: TransformConfig = {
  position: [0, 0, 200],
  rotation: [0, 0, 0],
  scale: [3, 3, 3],
};

const stadiumTransformBooster: TransformConfig = {
  position: [0, 0, 200],
  rotation: [0, 0, 0],
  scale: [3, 3, 3],
};

const stadiumTransformGliderOn: TransformConfig = {
  position: [0, 0, 200],
  rotation: [0, 0, 0],
  scale: [3, 3, 3],
};

const stadiumTransform = {
  position: [0, 0, 200] as Vec3,
  rotation: [0, 0, 0] as Vec3,
  scale: [3, 3, 3] as Vec3,
};

const subwayTransform = {
  position: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0] as Vec3,
  scale: [3, 3, 3] as Vec3,
};

const kalimariDesertTransform = {
  position: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0] as Vec3,
  scale: [1, 1, 1] as Vec3,
};

const DS_MARIO_CIRCUIT_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [177.177, -45, -99.63], rotation: [0, 1.348, 0] },
  { position: [172.649, -45, -97.715], rotation: [0, 1.348, 0] },
  { position: [168.119, -45, -95.969], rotation: [0, 1.348, 0] },
  { position: [163.468, -45, -94.048], rotation: [0, 1.348, 0] },
  { position: [158.878, -45, -92.244], rotation: [0, 1.348, 0] },
  { position: [154.306, -45, -90.662], rotation: [0, 1.348, 0] },
  { position: [153.825, -45, -103.591], rotation: [0, 1.348, 0] },
  { position: [149.162, -45, -101.635], rotation: [0, 1.348, 0] },
  { position: [144.105, -45, -100.119], rotation: [0, 1.348, 0] },
  { position: [139.981, -45, -98.419], rotation: [0, 1.348, 0] },
  { position: [135.509, -45, -96.375], rotation: [0, 1.348, 0] },
  { position: [130.442, -45, -94.665], rotation: [0, 1.348, 0] },
];

const STADIUM_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [8.291, 89, 205.821], rotation: [0, Math.PI, 0] },
  { position: [10.355, 89, 209.232], rotation: [0, Math.PI, 0] },
  { position: [12.629, 89, 212.022], rotation: [0, Math.PI, 0] },
  { position: [14.598, 89, 215.371], rotation: [0, Math.PI, 0] },
  { position: [16.775, 89, 218.465], rotation: [0, Math.PI, 0] },
  { position: [18.905, 89, 221.083], rotation: [0, Math.PI, 0] },
  { position: [9.247, 89, 224.285], rotation: [0, Math.PI, 0] },
  { position: [11.437, 89, 227.23], rotation: [0, Math.PI, 0] },
  { position: [13.497, 89, 229.938], rotation: [0, Math.PI, 0] },
  { position: [15.675, 89, 233.718], rotation: [0, Math.PI, 0] },
  { position: [17.817, 89, 236.555], rotation: [0, Math.PI, 0] },
  { position: [20.113, 89, 240.328], rotation: [0, Math.PI, 0] },
];

const SUBWAY_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [-41.282, 72, 111.308], rotation: [0, 1.59, 0] },
  { position: [-44.147, 72, 109.015], rotation: [0, 1.589, 0] },
  { position: [-47.083, 72, 107.004], rotation: [0, 1.589, 0] },
  { position: [-50.299, 72, 104.792], rotation: [0, 1.575, 0] },
  { position: [-49.84, 72, 104.792], rotation: [0, 1.575, 0] },
  { position: [-53.377, 72, 102.748], rotation: [0, 1.575, 0] },
  { position: [-56.971, 72, 100.482], rotation: [0, 1.575, 0] },
  { position: [-59.094, 72, 110.273], rotation: [0, 1.588, 0] },
  { position: [-62.268, 72, 107.957], rotation: [0, 1.602, 0] },
  { position: [-65.321, 72, 105.951], rotation: [0, 1.595, 0] },
  { position: [-68.568, 72, 103.768], rotation: [0, 1.568, 0] },
  { position: [-71.888, 72, 101.754], rotation: [0, 1.605, 0] },
  { position: [-75.59, 72, 99.475], rotation: [0, 1.605, 0] },
];

const KALIMARI_DESERT_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [234.75, 9.84, -201.705], rotation: [0,-3.117, 0] },
  { position: [232.211, 9.84, -197.296], rotation: [0, -3.117, 0] },
  { position: [229.264, 9.84, -193.949], rotation: [0, -3.117, 0] },
  { position: [226.251, 9.84, -189.697], rotation: [0, -3.117, 0] },
  { position: [223.664, 9.84, -185.461], rotation: [0, -3.117, 0] },
  { position: [220.837, 9.84, -181.752], rotation: [0, -3.117, 0] },
  { position: [233.686, 9.84, -178.003], rotation: [0, -3.117, 0] },
  { position: [230.682, 9.84, -173.199], rotation: [0, -3.117, 0] },
  { position: [227.979, 9.84, -169.22], rotation: [0, -3.117, 0] },
  { position: [225.021, 9.84, -165.401], rotation: [0, -3.117, 0] },
  { position: [222.1, 9.84, -161.36], rotation: [0, -3.117, 0] },
  { position: [219.668, 9.84, -157.23], rotation: [0, -3.117, 0] },
];

const DS_MARIO_CIRCUIT_OBJECT_CRATE_SPAWNS: ObjectCrateSpawn[] = [
  { position: [290.202, -48.573, 12.971], rotation: [0, 0, 0] },
  { position: [284.901, -48.719, 11.579], rotation: [0, 0, 0] },
  { position: [296.331, -48.406, 14.582], rotation: [0, 0, 0] },
  { position: [299.953, -48.31, 15.544], rotation: [0, 0, 0] },
  { position: [305.398, -48.165, 16.98], rotation: [0, 0, 0] },
  { position: [290.202, -48.573, 42.971], rotation: [0, 0, 0] },
  { position: [284.901, -48.719, 41.579], rotation: [0, 0, 0] },
  { position: [296.331, -48.406, 44.582], rotation: [0, 0, 0] },
  { position: [299.953, -48.31, 45.544], rotation: [0, 0, 0] },
  { position: [305.398, -48.165, 46.98], rotation: [0, 0, 0] },
];

const STADIUM_OBJECT_CRATE_SPAWNS: ObjectCrateSpawn[] = [
  { position: [9.8, 90.6, 207.6], rotation: [0, 0, 0] },
  { position: [13.4, 90.6, 213.5], rotation: [0, 0, 0] },
  { position: [18.1, 90.6, 220.9], rotation: [0, 0, 0] },
  { position: [11.2, 90.6, 226.8], rotation: [0, 0, 0] },
  { position: [18.4, 90.6, 238.8], rotation: [0, 0, 0] },
];

const SUBWAY_OBJECT_CRATE_SPAWNS: ObjectCrateSpawn[] = [
  { position: [-42.8, 73.6, 110.2], rotation: [0, 0, 0] },
  { position: [-48.7, 73.6, 106.4], rotation: [0, 0, 0] },
  { position: [-55.4, 73.6, 102.1], rotation: [0, 0, 0] },
  { position: [-60.6, 73.6, 109.1], rotation: [0, 0, 0] },
  { position: [-69.3, 73.6, 102.6], rotation: [0, 0, 0] },
];

const KALIMARI_DESERT_OBJECT_CRATE_SPAWNS: ObjectCrateSpawn[] = [
  { position: [233.7, 11.2, -199.4], rotation: [0, 0, 0] },
  { position: [228.6, 11.2, -192.2], rotation: [0, 0, 0] },
  { position: [222.5, 11.2, -183.9], rotation: [0, 0, 0] },
  { position: [231.3, 11.2, -175.6], rotation: [0, 0, 0] },
  { position: [223.6, 11.2, -163.2], rotation: [0, 0, 0] },
];

const DS_MARIO_CIRCUIT_COIN_SPAWNS: TrackCoinSpawn[] = [
  { position: [78.351, -43.817, 132.244], rotation: [0, 0, 0] },
  { position: [80.647, -43.654, 126.738], rotation: [0, 0, 0] },
  { position: [83.368, -43.443, 120.358], rotation: [0, 0, 0] },
  { position: [85.58, -43.279, 115.212], rotation: [0, 0, 0] },
  { position: [87.774, -43.143, 110.112], rotation: [0, 0, 0] },
];

const STADIUM_COIN_SPAWNS: TrackCoinSpawn[] = [
  { position: [9.8, 90.6, 207.6], rotation: [0, 0, 0] },
  { position: [13.4, 90.6, 213.5], rotation: [0, 0, 0] },
  { position: [18.1, 90.6, 220.9], rotation: [0, 0, 0] },
  { position: [11.2, 90.6, 226.8], rotation: [0, 0, 0] },
  { position: [18.4, 90.6, 238.8], rotation: [0, 0, 0] },
];

const SUBWAY_COIN_SPAWNS: TrackCoinSpawn[] = [
  { position: [-42.8, 73.6, 110.2], rotation: [0, 0, 0] },
  { position: [-48.7, 73.6, 106.4], rotation: [0, 0, 0] },
  { position: [-55.4, 73.6, 102.1], rotation: [0, 0, 0] },
  { position: [-60.6, 73.6, 109.1], rotation: [0, 0, 0] },
  { position: [-69.3, 73.6, 102.6], rotation: [0, 0, 0] },
];

const KALIMARI_DESERT_COIN_SPAWNS: TrackCoinSpawn[] = [
  { position: [233.7, 11.2, -199.4], rotation: [0, 0, 0] },
  { position: [228.6, 11.2, -192.2], rotation: [0, 0, 0] },
  { position: [222.5, 11.2, -183.9], rotation: [0, 0, 0] },
  { position: [231.3, 11.2, -175.6], rotation: [0, 0, 0] },
  { position: [223.6, 11.2, -163.2], rotation: [0, 0, 0] },
];

export const CIRCUITS: Record<CircuitId, CircuitConfig> = {
  ds_mario_circuit: {
    id: 'ds_mario_circuit',
    label: 'DS Mario Circuit',
    transform: marioTransform,
    spawnSlots: DS_MARIO_CIRCUIT_SPAWN_SLOTS,
    objectCrateSpawns: DS_MARIO_CIRCUIT_OBJECT_CRATE_SPAWNS,
    coinSpawns: DS_MARIO_CIRCUIT_COIN_SPAWNS,
    road: {
      model: 'models/ds_mario_circuit_road.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
    },
    ext: {
      model: 'models/ds_mario_circuit_ext.glb',
      drag: 2,
      friction: 0,
      restitution: 0,
    },
    lapStart: {
      model: 'models/ds_mario_circuit_start.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: marioTransform,
    },
    lapCheckpoint: {
      model: 'models/ds_mario_circuit_checkpoint.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: marioTransform,
    },
    waypoints: {
      model: 'models/ds_mario_circuit_waypoints.glb',
      transform: marioTransform,
    },
    performance: {
      maxVisibleDistance: 250,
      cullConeDot: CULL_CONE_DOT_120,
      cullNearDistance: 45,
    },
    vehicleAttachment: {
      enabled: false,
      maxAttachAngleDeg: 85,
      probeDistance: 6,
      stickForce: 24,
      maxSlopeClimbAngleDeg: 60,
      detachGraceMs: 120,
      allowedSurfaces: 'road-ext',
      loopSlopeClimbAngleDeg: 160,
      loopSlopeSlideAngleDeg: 170,
    },
  },
  stadium: {
    id: 'stadium',
    label: 'stadium',
    transform: stadiumTransform,
    spawnSlots: STADIUM_SPAWN_SLOTS,
    objectCrateSpawns: STADIUM_OBJECT_CRATE_SPAWNS,
    coinSpawns: STADIUM_COIN_SPAWNS,
    road: {
      model: 'models/stadium_road.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
    },
    ext: {
      model: 'models/stadium_ext.glb',
      drag: 2,
      friction: 0,
      restitution: 0,
    },
    antiGravIn: {
      model: 'models/stadium_antiGravIn.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: stadiumTransformGravIn,
    },
    antiGravOut: {
      model: 'models/stadium_antiGravOut.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: stadiumTransformGravOut,
    },
    booster: {
      model: 'models/stadium_boosters.glb',
      duration: 1,
      strength: 1.5,
      transform: stadiumTransformBooster,
    },
    gliderOn: {
      model: 'models/stadium_gliderOn.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: stadiumTransformGliderOn,
    },
    lapStart: {
      model: 'models/stadium_start.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: stadiumTransform,
    },
    lapCheckpoint: {
      model: 'models/stadium_checkpoint.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: stadiumTransform,
    },
    waypoints: {
      model: 'models/stadium_waypoints.glb',
      transform: stadiumTransform,
    },
    performance: {
      maxVisibleDistance: 230,
      cullConeDot: CULL_CONE_DOT_120,
      cullNearDistance: 35,
    },
    vehicleAttachment: {
      enabled: false,
      maxAttachAngleDeg: 88,
      probeDistance: 7.5,
      stickForce: 32,
      maxSlopeClimbAngleDeg: 60,
      detachGraceMs: 120,
      allowedSurfaces: 'road-ext',
      loopSlopeClimbAngleDeg: 165,
      loopSlopeSlideAngleDeg: 172,
    },
  },
  super_bell_subway: {
    id: 'super_bell_subway',
    label: 'DS super_bell_subway Ridge',
    transform: subwayTransform,
    spawnSlots: SUBWAY_SPAWN_SLOTS,
    objectCrateSpawns: SUBWAY_OBJECT_CRATE_SPAWNS,
    coinSpawns: SUBWAY_COIN_SPAWNS,
    road: {
      model: 'models/super_bell_subway_road.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
    },
    ext: {
      model: 'models/super_bell_subway_ext.glb',
      drag: 2,
      friction: 0,
      restitution: 0,
    },
    booster: {
      model: 'models/super_bell_subway_boosters.glb',
      duration: 1,
      strength: 1.5,
      transform: subwayTransform,
    },
    lapStart: {
      model: 'models/super_bell_subway_start.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: subwayTransform,
    },
    lapCheckpoint: {
      model: 'models/super_bell_subway_checkpoint.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: subwayTransform,
    },
    waypoints: {
      model: 'models/super_bell_subway_waypoints.glb',
      transform: subwayTransform,
    },
    performance: {
      maxVisibleDistance: 90,
      cullConeDot: CULL_CONE_DOT_120,
      cullNearDistance: 35,
    },
    vehicleAttachment: {
      enabled: false,
      maxAttachAngleDeg: 88,
      probeDistance: 8,
      stickForce: 34,
      maxSlopeClimbAngleDeg: 60,
      detachGraceMs: 120,
      allowedSurfaces: 'road-ext',
      loopSlopeClimbAngleDeg: 165,
      loopSlopeSlideAngleDeg: 172,
    },
  },
  kalimari_desert: {
    id: 'kalimari_desert',
    label: 'N64 Kalimari Desert',
    transform: kalimariDesertTransform,
    spawnSlots: KALIMARI_DESERT_SPAWN_SLOTS,
    objectCrateSpawns: KALIMARI_DESERT_OBJECT_CRATE_SPAWNS,
    coinSpawns: KALIMARI_DESERT_COIN_SPAWNS,
    road: {
      model: 'models/kalimari_desert_road.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
    },
    ext: {
      model: 'models/kalimari_desert_ext.glb',
      drag: 2,
      friction: 0,
      restitution: 0,
    },
    booster: {
      model: 'models/kalimari_desert_boost.glb',
      duration: 1,
      strength: 1.5,
      transform: kalimariDesertTransform,
    },
    lapStart: {
      model: 'models/kalimari_desert_start.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: kalimariDesertTransform,
    },
    lapCheckpoint: {
      model: 'models/kalimari_desert_checkpoint.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: kalimariDesertTransform,
    },
    waypoints: {
      model: 'models/kalimari_desert_waypoints.glb',
      transform: kalimariDesertTransform,
    },
    performance: {
      maxVisibleDistance: 320,
      cullConeDot: CULL_CONE_DOT_120,
      cullNearDistance: 45,
    },
    vehicleAttachment: {
      enabled: false,
      maxAttachAngleDeg: 88,
      probeDistance: 8,
      stickForce: 34,
      maxSlopeClimbAngleDeg: 60,
      detachGraceMs: 120,
      allowedSurfaces: 'road-ext',
      loopSlopeClimbAngleDeg: 165,
      loopSlopeSlideAngleDeg: 172,
    },
  },
};

export const GRAND_PRIXS: Record<GrandPrixId, GrandPrixConfig> = {
  mushroom_cup: createGrandPrix('mushroom_cup', 'Coupe Champignon', 'Coupe Champignon', [
    { origin: 'SNES', label: 'Circuit Mario 1', previewIndex: 2, circuitId: 'ds_mario_circuit' },
    { origin: 'GBA', label: 'Stadium', previewIndex: 1, circuitId: 'stadium' },
    { origin: 'N64', label: 'Super Bell Subway', previewIndex: 3, circuitId: 'super_bell_subway' },
    { origin: 'N64', label: 'Desert Kalimari', previewIndex: 4, circuitId: 'kalimari_desert' },
  ]),
  flower_cup: createGrandPrix('flower_cup', 'Coupe Fleur', 'Coupe Fleur', [
    { origin: 'Wii', label: 'Stadium', previewIndex: 5, circuitId: 'stadium' },
    { origin: 'DS', label: 'Cascades Cheep Cheep', previewIndex: 6, circuitId: 'super_bell_subway' },
    { origin: 'GCN', label: 'Portail Peach', previewIndex: 7, circuitId: 'ds_mario_circuit' },
    { origin: 'N64', label: 'Desert Kalimari', previewIndex: 8, circuitId: 'stadium' },
  ]),
  star_cup: createGrandPrix('star_cup', 'Coupe Etoile', 'Coupe Etoile', [
    { origin: 'Wii', label: 'Super Bell Subway', previewIndex: 9, circuitId: 'super_bell_subway' },
    { origin: 'N64', label: 'Route Arc-en-ciel', previewIndex: 10, circuitId: 'ds_mario_circuit' },
    { origin: 'GBA', label: 'Chateau Bowser', previewIndex: 11, circuitId: 'stadium' },
    { origin: '3DS', label: 'Music Park', previewIndex: 12, circuitId: 'super_bell_subway' },
  ]),
  special_cup: createGrandPrix('special_cup', 'Coupe Speciale', 'Coupe Speciale', [
    { origin: 'N64', label: 'Royaume Glace', previewIndex: 1, circuitId: 'stadium' },
    { origin: 'GCN', label: 'Jungle DK', previewIndex: 2, circuitId: 'ds_mario_circuit' },
    { origin: 'Wii', label: 'Usine Toad', previewIndex: 3, circuitId: 'super_bell_subway' },
    { origin: 'DS', label: 'Horloge Tic-Tac', previewIndex: 4, circuitId: 'stadium' },
  ]),
  shell_cup: createGrandPrix('shell_cup', 'Coupe Carapace', 'Coupe Carapace', [
    { origin: 'SNES', label: 'Toad Harbor', previewIndex: 5, circuitId: 'stadium' },
    { origin: 'GBA', label: 'Rivage Koopa', previewIndex: 6, circuitId: 'stadium' },
    { origin: 'N64', label: 'Circuit Luigi', previewIndex: 7, circuitId: 'super_bell_subway' },
    { origin: '3DS', label: 'Vague Wuhu', previewIndex: 8, circuitId: 'ds_mario_circuit' },
  ]),
  banana_cup: createGrandPrix('banana_cup', 'Coupe Banane', 'Coupe Banane', [
    { origin: 'GCN', label: 'Dry Dry Desert', previewIndex: 9, circuitId: 'stadium' },
    { origin: 'SNES', label: 'Donut Plains 3', previewIndex: 10, circuitId: 'ds_mario_circuit' },
    { origin: 'N64', label: 'Royal Raceway', previewIndex: 11, circuitId: 'super_bell_subway' },
    { origin: '3DS', label: 'DK Jungle', previewIndex: 12, circuitId: 'stadium' },
  ]),
  leaf_cup: createGrandPrix('leaf_cup', 'Coupe Feuille', 'Coupe Feuille', [
    { origin: 'DS', label: 'Place Delfino', previewIndex: 1, circuitId: 'super_bell_subway' },
    { origin: 'Wii', label: 'Gorge Champi', previewIndex: 2, circuitId: 'ds_mario_circuit' },
    { origin: 'GCN', label: 'Montagne Dino', previewIndex: 3, circuitId: 'stadium' },
    { origin: 'SNES', label: 'Vallee Fantome 2', previewIndex: 4, circuitId: 'super_bell_subway' },
  ]),
  lightning_cup: createGrandPrix('lightning_cup', 'Coupe Eclair', 'Coupe Eclair', [
    { origin: 'N64', label: 'Chateau Bowser', previewIndex: 5, circuitId: 'ds_mario_circuit' },
    { origin: '3DS', label: 'Route Arc-en-ciel', previewIndex: 6, circuitId: 'stadium' },
    { origin: 'GBA', label: 'Sky Garden', previewIndex: 7, circuitId: 'super_bell_subway' },
    { origin: 'Wii', label: 'Koopa Cape', previewIndex: 8, circuitId: 'ds_mario_circuit' },
  ]),
  egg_cup: createGrandPrix('egg_cup', 'Coupe Oeuf', 'Coupe Oeuf', [
    { origin: 'GCN', label: 'Circuit Yoshi', previewIndex: 9, circuitId: 'ds_mario_circuit' },
    { origin: 'DS', label: 'Jardin Peach', previewIndex: 10, circuitId: 'stadium' },
    { origin: 'Wii', label: 'Ruines Sec Sec', previewIndex: 11, circuitId: 'super_bell_subway' },
    { origin: 'N64', label: 'Ferme Moo Moo', previewIndex: 12, circuitId: 'ds_mario_circuit' },
  ]),
  triforce_cup: createGrandPrix('triforce_cup', 'Coupe Triforce', 'Coupe Triforce', [
    { origin: 'ZELDA', label: 'Hyrule Castle', previewIndex: 1, circuitId: 'stadium' },
    { origin: 'SNES', label: 'Route Arc-en-ciel', previewIndex: 2, circuitId: 'super_bell_subway' },
    { origin: '3DS', label: 'Ice Ice Outpost', previewIndex: 3, circuitId: 'ds_mario_circuit' },
    { origin: 'F-ZERO', label: 'Mute City', previewIndex: 4, circuitId: 'stadium' },
  ]),
  crossing_cup: createGrandPrix('crossing_cup', 'Coupe Crossing', 'Coupe Crossing', [
    { origin: 'AC', label: 'Animal Crossing', previewIndex: 5, circuitId: 'ds_mario_circuit' },
    { origin: 'N64', label: 'Baby Park', previewIndex: 6, circuitId: 'stadium' },
    { origin: 'GBA', label: 'Cheese Land', previewIndex: 7, circuitId: 'super_bell_subway' },
    { origin: 'DS', label: 'Waluigi Pinball', previewIndex: 8, circuitId: 'ds_mario_circuit' },
  ]),
  bell_cup: createGrandPrix('bell_cup', 'Coupe Clochette', 'Coupe Clochette', [
    { origin: '3DS', label: 'Neo Bowser City', previewIndex: 9, circuitId: 'stadium' },
    { origin: 'GCN', label: 'Sherbet Land', previewIndex: 10, circuitId: 'ds_mario_circuit' },
    { origin: 'Wii', label: 'Grumble Volcano', previewIndex: 11, circuitId: 'super_bell_subway' },
    { origin: 'F-ZERO', label: 'Big Blue', previewIndex: 12, circuitId: 'stadium' },
  ]),
};
