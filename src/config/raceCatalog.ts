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
  road: SurfaceConfig;
  ext: SurfaceConfig;
  antiGravIn?: SurfaceTriggerConfig;
  antiGravOut?: SurfaceTriggerConfig;
  booster?: BoosterTriggerConfig;
  lapStart?: SurfaceTriggerConfig;
  lapCheckpoint?: SurfaceTriggerConfig;
  performance: CircuitPerformanceConfig;
  vehicleAttachment: VehicleAttachmentConfig;
};

export type SpawnSlot = {
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

export const CIRCUIT_ORDER: CircuitId[] = ['ds_mario_circuit', 'stadium', 'super_bell_subway'];

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
  },
  p2: {
    forward: ['arrowup'],
    back: ['arrowdown'],
    left: ['arrowleft'],
    right: ['arrowright'],
  },
  p3: {
    forward: ['i'],
    back: ['k'],
    left: ['j'],
    right: ['l'],
  },
  p4: {
    forward: ['numpad8', '8'],
    back: ['numpad5', '5'],
    left: ['numpad4', '4'],
    right: ['numpad6', '6'],
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

const toadHarborTransform = {
  position: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0] as Vec3,
  scale: [0.1, 0.1, 0.1] as Vec3,
};

const DS_MARIO_CIRCUIT_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [130.442, -45.402, -94.665], rotation: [0, 1.348, 0] },
  { position: [128.242, -45.402, -94.665], rotation: [0, 1.348, 0] },
  { position: [132.642, -45.402, -94.665], rotation: [0, 1.348, 0] },
  { position: [126.042, -45.402, -94.665], rotation: [0, 1.348, 0] },
  { position: [130.442, -45.402, -97.665], rotation: [0, 1.348, 0] },
  { position: [128.242, -45.402, -97.665], rotation: [0, 1.348, 0] },
  { position: [132.642, -45.402, -97.665], rotation: [0, 1.348, 0] },
  { position: [126.042, -45.402, -97.665], rotation: [0, 1.348, 0] },
  { position: [130.442, -45.402, -100.665], rotation: [0, 1.348, 0] },
  { position: [128.242, -45.402, -100.665], rotation: [0, 1.348, 0] },
  { position: [132.642, -45.402, -100.665], rotation: [0, 1.348, 0] },
  { position: [126.042, -45.402, -100.665], rotation: [0, 1.348, 0] },
];

const STADIUM_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [20.246, 80, 240.126], rotation: [0, Math.PI, 0] },
  { position: [18.046, 80, 240.126], rotation: [0, Math.PI, 0] },
  { position: [22.446, 80, 240.126], rotation: [0, Math.PI, 0] },
  { position: [15.846, 80, 240.126], rotation: [0, Math.PI, 0] },
  { position: [20.246, 80, 243.126], rotation: [0, Math.PI, 0] },
  { position: [18.046, 80, 243.126], rotation: [0, Math.PI, 0] },
  { position: [22.446, 80, 243.126], rotation: [0, Math.PI, 0] },
  { position: [15.846, 80, 243.126], rotation: [0, Math.PI, 0] },
  { position: [20.246, 80, 246.126], rotation: [0, Math.PI, 0] },
  { position: [18.046, 80, 246.126], rotation: [0, Math.PI, 0] },
  { position: [22.446, 80, 246.126], rotation: [0, Math.PI, 0] },
  { position: [15.846, 80, 246.126], rotation: [0, Math.PI, 0] },
];

const SUBWAY_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [-75, 73, 100], rotation: [0, 1.564, 0] },
  { position: [-77.2, 73, 100], rotation: [0, 1.564, 0] },
  { position: [-72.8, 73, 100], rotation: [0, 1.564, 0] },
  { position: [-79.4, 73, 100], rotation: [0, 1.564, 0] },
  { position: [-75, 73, 103], rotation: [0, 1.564, 0] },
  { position: [-77.2, 73, 103], rotation: [0, 1.564, 0] },
  { position: [-72.8, 73, 103], rotation: [0, 1.564, 0] },
  { position: [-79.4, 73, 103], rotation: [0, 1.564, 0] },
  { position: [-75, 73, 106], rotation: [0, 1.564, 0] },
  { position: [-77.2, 73, 106], rotation: [0, 1.564, 0] },
  { position: [-72.8, 73, 106], rotation: [0, 1.564, 0] },
  { position: [-79.4, 73, 106], rotation: [0, 1.564, 0] },
];

const TOAD_HARBOR_SPAWN_SLOTS: SpawnSlot[] = [
  { position: [-75, 100, 100], rotation: [0, 1.564, 0] },
  { position: [-77.2, 100, 100], rotation: [0, 1.564, 0] },
  { position: [-72.8, 100, 100], rotation: [0, 1.564, 0] },
  { position: [-79.4, 100, 100], rotation: [0, 1.564, 0] },
  { position: [-75, 100, 103], rotation: [0, 1.564, 0] },
  { position: [-77.2, 100, 103], rotation: [0, 1.564, 0] },
  { position: [-72.8, 100, 103], rotation: [0, 1.564, 0] },
  { position: [-79.4, 100, 103], rotation: [0, 1.564, 0] },
  { position: [-75, 100, 106], rotation: [0, 1.564, 0] },
  { position: [-77.2, 100, 106], rotation: [0, 1.564, 0] },
  { position: [-72.8, 100, 106], rotation: [0, 1.564, 0] },
  { position: [-79.4, 100, 106], rotation: [0, 1.564, 0] },
];

export const CIRCUITS: Record<CircuitId, CircuitConfig> = {
  ds_mario_circuit: {
    id: 'ds_mario_circuit',
    label: 'DS Mario Circuit',
    transform: marioTransform,
    spawnSlots: DS_MARIO_CIRCUIT_SPAWN_SLOTS,
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
    performance: {
      maxVisibleDistance: 320,
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
    performance: {
      maxVisibleDistance: 300,
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
    performance: {
      maxVisibleDistance: 100,
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
  toad_harbor: {
    id: 'toad_harbor',
    label: 'DS Toad Harbor',
    transform: toadHarborTransform,
    spawnSlots: TOAD_HARBOR_SPAWN_SLOTS,
    road: {
      model: 'models/toad_harbor_road.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
    },
    ext: {
      model: 'models/toad_harbor_ext.glb',
      drag: 2,
      friction: 0,
      restitution: 0,
    },
    booster: {
      model: 'models/toad_harbor_boost.glb',
      duration: 1,
      strength: 1.5,
      transform: toadHarborTransform,
    },
    lapStart: {
      model: 'models/toad_harbor_start.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: toadHarborTransform,
    },
    lapCheckpoint: {
      model: 'models/toad_harbor_checkpoint.glb',
      drag: 0,
      friction: 0,
      restitution: 0,
      transform: toadHarborTransform,
    },
    performance: {
      maxVisibleDistance: 100,
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
};

export const GRAND_PRIXS: Record<GrandPrixId, GrandPrixConfig> = {
  mushroom_cup: createGrandPrix('mushroom_cup', 'Coupe Champignon', 'Coupe Champignon', [
    { origin: 'SNES', label: 'Circuit Mario 1', previewIndex: 2, circuitId: 'ds_mario_circuit' },
    { origin: 'GBA', label: 'Stadium', previewIndex: 1, circuitId: 'stadium' },
    { origin: 'N64', label: 'Super Bell Subway', previewIndex: 3, circuitId: 'super_bell_subway' },
    { origin: '3DS', label: 'Circuit Mario 1', previewIndex: 2, circuitId: 'ds_mario_circuit' },
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
    { origin: 'SNES', label: 'Toad Harbor', previewIndex: 5, circuitId: 'toad_harbor' },
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
