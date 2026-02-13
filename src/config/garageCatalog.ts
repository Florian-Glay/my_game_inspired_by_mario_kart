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

const DEFAULT_THUMBNAIL = '/ui/home-hero.png';
const DEFAULT_CHARACTER_MODEL = '/models/exemple.glb';
const DEFAULT_VEHICLE_MODEL = '/models/exemple.glb';
const DEFAULT_WHEEL_MODEL = '/models/exemple.glb';

const CHARACTER_SCALE: Vec3 = [0.0075, 0.0075, 0.0075];
const VEHICLE_SCALE: Vec3 = [0.03, 0.03, 0.03];
const WHEEL_SCALE: Vec3 = [0.0052, 0.0052, 0.0052];

const DEFAULT_CHARACTER_MOUNT: Vec3 = [0, 0.62, -0.04];
const DEFAULT_WHEEL_MOUNTS: WheelMounts = [
  [-0.92, 0.04, 1.14],
  [0.92, 0.04, 1.14],
  [-0.92, 0.04, -1.14],
  [0.92, 0.04, -1.14],
];

const asTwoDigits = (value: number) => String(value).padStart(2, '0');

const createCharacter = (index: number): CharacterCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `char-${number}`,
    label: `Personnage ${number}`,
    thumbnail: DEFAULT_THUMBNAIL,
    model: DEFAULT_CHARACTER_MODEL,
    scale: CHARACTER_SCALE,
  };
};

const createVehicle = (index: number): VehicleCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `veh-${number}`,
    label: `Vehicule ${number}`,
    thumbnail: DEFAULT_THUMBNAIL,
    model: DEFAULT_VEHICLE_MODEL,
    scale: VEHICLE_SCALE,
    characterMount: DEFAULT_CHARACTER_MOUNT,
    wheelMounts: DEFAULT_WHEEL_MOUNTS,
  };
};

const createWheel = (index: number, size: WheelSize): WheelCatalogItem => {
  const number = asTwoDigits(index + 1);
  return {
    id: `wheel-${size}-${number}`,
    label: `Roue ${size} ${number}`,
    thumbnail: DEFAULT_THUMBNAIL,
    model: DEFAULT_WHEEL_MODEL,
    scale: WHEEL_SCALE,
    size,
  };
};

export const CHARACTERS: CharacterCatalogItem[] = Array.from({ length: 9 }, (_, index) =>
  createCharacter(index),
);

export const VEHICLES: VehicleCatalogItem[] = Array.from({ length: 9 }, (_, index) =>
  createVehicle(index),
);

export const WHEELS: WheelCatalogItem[] = [
  createWheel(0, 'small'),
  createWheel(1, 'small'),
  createWheel(2, 'small'),
  createWheel(0, 'normal'),
  createWheel(1, 'normal'),
  createWheel(2, 'normal'),
  createWheel(0, 'large'),
  createWheel(1, 'large'),
  createWheel(2, 'large'),
];

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

