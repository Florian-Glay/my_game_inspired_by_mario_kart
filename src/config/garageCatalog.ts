import type {
  PlayerLoadoutSelection,
  Vec3,
  WheelMounts,
  WheelSize,
} from '../types/game';

export type CharacterCatalogItem = {
  id: string;
  label: string;
  thumbnail: string;
  model: string;
  scale: Vec3;
};

export type VehicleCatalogItem = {
  id: string;
  label: string;
  thumbnail: string;
  model: string;
  scale: Vec3;
  characterMount: Vec3;
  wheelMounts: WheelMounts;
};

export type WheelCatalogItem = {
  id: string;
  label: string;
  thumbnail: string;
  model: string;
  scale: Vec3;
  size: WheelSize;
};

export type WheelSizeHeightProfile = {
  chassisLift: number;
  driverLift: number;
};

export const WHEEL_SIZE_HEIGHT_PROFILES: Record<WheelSize, WheelSizeHeightProfile> = {
  small: {
    chassisLift: -0.12,
    driverLift: -0.12,
  },
  normal: {
    chassisLift: 0,
    driverLift: 0,
  },
  large: {
    chassisLift: 0.12,
    driverLift: 0.12,
  },
};

const DEFAULT_THUMBNAIL = 'ui/home-hero.png';
const DEFAULT_CHARACTER_MODEL = 'models/mario.glb';
const DEFAULT_VEHICLE_MODEL = 'models/exemple.glb';
const DEFAULT_WHEEL_MODEL = 'models/exemple_wheel.glb';

// Listes de modeles 3D utilises par le garage.
// Le changement d'index dans le menu pointe vers l'element correspondant de ces listes.
export const CHARACTER_MODEL_LIST = [
  'models/mario.glb',
] as const;

export const VEHICLE_MODEL_LIST = [
  'models/exemple.glb',
  'models/standard_kart.glb',
] as const;

export const WHEEL_MODEL_LIST = [
  'models/exemple_wheel.glb',
  'models/standard_tire.glb',
] as const;

// Listes de miniatures (images UI) utilises par le menu de selection.
// Chaque index correspond a l'index de l'element dans sa liste.
export const CHARACTER_THUMBNAIL_LIST = [
  'ui/select/character/mario.png',
  'ui/100cc.png',
  'ui/150cc.png',
  'ui/200cc.png',
] as const;

export const VEHICLE_THUMBNAIL_LIST = [
  'ui/50cc.png',
  'ui/100cc.png',
  'ui/150cc.png',
  'ui/200cc.png',
] as const;

export const WHEEL_THUMBNAIL_LIST = [
  'ui/grand-prix/badges/mushroom_cup.png',
  'ui/grand-prix/badges/flower_cup.png',
  'ui/grand-prix/badges/star_cup.png',
  'ui/grand-prix/badges/special_cup.png',
] as const;

const CHARACTER_SCALE: Vec3 = [2, 2, 2];
const VEHICLE_SCALE: Vec3 = [1, 1, 1];
const WHEEL_SCALE: Vec3 = [1, 1, 1];

const DEFAULT_CHARACTER_MOUNT: Vec3 = [0, -0.3, -0.6];
const DEFAULT_WHEEL_MOUNTS: WheelMounts = [
  [-0.92, 0.3, 0.55],
  [0.92, 0.3, 0.55],
  [-0.92, 0.3, -1.25],
  [0.92, 0.3, -1.25],
];

const asTwoDigits = (value: number) => String(value).padStart(2, '0');

const getModelByIndex = (models: readonly string[], index: number, fallback: string) => {
  if (models.length === 0) return fallback;
  return models[index] ?? models[index % models.length] ?? fallback;
};

const getThumbnailByIndex = (thumbnails: readonly string[], index: number, fallback: string) => {
  if (thumbnails.length === 0) return fallback;
  return thumbnails[index] ?? thumbnails[index % thumbnails.length] ?? fallback;
};

const createCharacter = (index: number, model: string, thumbnail: string): CharacterCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `char-${number}`,
    label: `Personnage ${number}`,
    thumbnail,
    model,
    scale: CHARACTER_SCALE,
  };
};

const createVehicle = (index: number, model: string, thumbnail: string): VehicleCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `veh-${number}`,
    label: `Vehicule ${number}`,
    thumbnail,
    model,
    scale: VEHICLE_SCALE,
    characterMount: DEFAULT_CHARACTER_MOUNT,
    wheelMounts: DEFAULT_WHEEL_MOUNTS,
  };
};

const createWheel = (
  index: number,
  size: WheelSize,
  model: string,
  thumbnail: string,
): WheelCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `wheel-${size}-${number}`,
    label: `Roue ${size} ${number}`,
    thumbnail,
    model,
    scale: WHEEL_SCALE,
    size,
  };
};

const characterCount = Math.max(1, CHARACTER_MODEL_LIST.length);
const vehicleCount = Math.max(1, VEHICLE_MODEL_LIST.length);
const wheelVariantCount = Math.max(1, WHEEL_MODEL_LIST.length);

export const CHARACTERS: CharacterCatalogItem[] = Array.from({ length: characterCount }, (_, index) =>
  createCharacter(
    index,
    getModelByIndex(CHARACTER_MODEL_LIST, index, DEFAULT_CHARACTER_MODEL),
    getThumbnailByIndex(CHARACTER_THUMBNAIL_LIST, index, DEFAULT_THUMBNAIL),
  ),
);

export const VEHICLES: VehicleCatalogItem[] = Array.from({ length: vehicleCount }, (_, index) =>
  createVehicle(
    index,
    getModelByIndex(VEHICLE_MODEL_LIST, index, DEFAULT_VEHICLE_MODEL),
    getThumbnailByIndex(VEHICLE_THUMBNAIL_LIST, index, DEFAULT_THUMBNAIL),
  ),
);

const WHEEL_SIZE_ORDER: readonly WheelSize[] = ['small', 'normal', 'large'];

export const WHEELS: WheelCatalogItem[] = WHEEL_SIZE_ORDER.flatMap((size) =>
  Array.from({ length: wheelVariantCount }, (_, index) =>
    createWheel(
      index,
      size,
      getModelByIndex(WHEEL_MODEL_LIST, index, DEFAULT_WHEEL_MODEL),
      getThumbnailByIndex(WHEEL_THUMBNAIL_LIST, index, DEFAULT_THUMBNAIL),
    ),
  ),
);

export function getDefaultLoadoutSelection(): PlayerLoadoutSelection {
  return {
    characterId: CHARACTERS[0]?.id ?? '',
    vehicleId: VEHICLES[0]?.id ?? '',
    wheelId: WHEELS[0]?.id ?? '',
  };
}

export function getCatalogItemById<T extends { id: string }>(
  items: readonly T[],
  id: string,
): T {
  return items.find((item) => item.id === id) ?? items[0];
}

export function cycleIndex<T extends { id: string }>(
  currentId: string,
  direction: -1 | 1,
  items: readonly T[],
): number {
  if (items.length === 0) return -1;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  return (safeCurrentIndex + direction + items.length) % items.length;
}
