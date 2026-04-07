import {
  CHARACTERS,
  VEHICLES,
  WHEELS,
  WHEEL_SIZE_HEIGHT_PROFILES,
  getCatalogItemById,
} from '../config/garageCatalog';
import { MAX_LOCAL_HUMANS } from '../config/raceCatalog';
import {
  GRAND_PRIX_POINTS_BY_POSITION,
  HUMAN_SLOT_ORDER,
  ONLINE_PLAYER_NAME_STORAGE_KEY,
} from './appConstants';
import type { HumanPlayerSlotId, PlayerLoadoutSelection, RaceParticipantConfig } from '../types/game';

export function getGrandPrixPointsForPosition(position: number) {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return GRAND_PRIX_POINTS_BY_POSITION[position - 1] ?? 0;
}

async function checkAssetAvailability(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
  } catch {
    // fallback GET handled below
  }

  try {
    const get = await fetch(url, { method: 'GET' });
    return get.ok;
  } catch {
    return false;
  }
}

export async function getMissingAssetUrls(urls: string[]) {
  const deduplicated = Array.from(new Set(urls));
  const checks = await Promise.all(
    deduplicated.map(async (modelPath) => ({
      modelPath,
      exists: await checkAssetAvailability(modelPath),
    })),
  );

  return checks.filter((entry) => !entry.exists).map((entry) => entry.modelPath);
}

export function getHumanSlots(humanCount: number) {
  return HUMAN_SLOT_ORDER.slice(0, Math.min(Math.max(humanCount, 1), MAX_LOCAL_HUMANS));
}

export function getHumanDisplayName(slot: HumanPlayerSlotId) {
  return `Joueur ${HUMAN_SLOT_ORDER.indexOf(slot) + 1}`;
}

export function createRandomLoadoutSelection(): PlayerLoadoutSelection {
  const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] ?? CHARACTERS[0];
  const vehicle = VEHICLES[Math.floor(Math.random() * VEHICLES.length)] ?? VEHICLES[0];
  const wheel = WHEELS[Math.floor(Math.random() * WHEELS.length)] ?? WHEELS[0];

  return {
    characterId: character?.id ?? '',
    vehicleId: vehicle?.id ?? '',
    wheelId: wheel?.id ?? '',
  };
}

export function getStoredOnlinePlayerName() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ONLINE_PLAYER_NAME_STORAGE_KEY) ?? '';
}

type CreateResolvedParticipantConfigInput = {
  id: string;
  displayName: string;
  kind: RaceParticipantConfig['kind'];
  controlMode: RaceParticipantConfig['controlMode'];
  loadout: PlayerLoadoutSelection;
  humanSlotId?: HumanPlayerSlotId;
  keyBindings?: RaceParticipantConfig['keyBindings'];
};

export function createResolvedParticipantConfig({
  id,
  displayName,
  kind,
  controlMode,
  loadout,
  humanSlotId,
  keyBindings,
}: CreateResolvedParticipantConfigInput): RaceParticipantConfig {
  const character = getCatalogItemById(CHARACTERS, loadout.characterId);
  const vehicle = getCatalogItemById(VEHICLES, loadout.vehicleId);
  const wheel = getCatalogItemById(WHEELS, loadout.wheelId);
  const wheelProfile = WHEEL_SIZE_HEIGHT_PROFILES[wheel.size];

  return {
    id,
    displayName,
    kind,
    humanSlotId,
    controlMode,
    loadout,
    vehicleModel: vehicle.model,
    vehicleScale: vehicle.scale,
    characterModel: character.model,
    characterScale: character.scale,
    wheelModel: wheel.model,
    wheelScale: wheel.scale,
    characterMount: vehicle.characterMount,
    wheelMounts: vehicle.wheelMounts,
    chassisLift: wheelProfile.chassisLift,
    driverLift: wheelProfile.driverLift,
    spawn: [0, 0, 0],
    spawnRotation: [0, 0, 0],
    keyBindings,
  };
}

export function shuffleParticipants(participants: RaceParticipantConfig[]) {
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}
