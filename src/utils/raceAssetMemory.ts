import { useGLTF } from '@react-three/drei';
import { CHARACTERS, VEHICLES, WHEELS } from '../config/garageCatalog';
import { CIRCUITS } from '../config/raceCatalog';
import type { RaceConfig } from '../types/game';

const LAKITU_MODEL_URL = 'models/lakitu.glb';
const OBJECT_CRATE_MODEL_URL = 'models/item_box.glb';
const TRACK_COIN_MODEL_URL = 'models/miniObject/itemCoin.glb';
const OBJECT_ATTACHABLE_VOID_MODEL_URL = 'models/void.glb';
const OBJECT_ATTACHABLE_MUSHROOM_MODEL_URL = 'models/miniObject/itemMushroom.glb';
const OBJECT_BANANA_MODEL_URL = 'models/miniObject/itemBanana.glb';
const OBJECT_GREEN_SHELL_MODEL_URL = 'models/miniObject/itemGreenShell.glb';
const OBJECT_RED_SHELL_MODEL_URL = 'models/miniObject/itemRedShell.glb';
const OBJECT_BLUE_SHELL_MODEL_URL = 'models/miniObject/itemBlueShell.glb';
const OBJECT_BOMB_MODEL_URL = 'models/miniObject/itemBomb.glb';
const OBJECT_ATTACHABLE_BULLET_BILL_MODEL_URL = 'models/miniObject/itemBulletBill.glb';
const OBJECT_BULLET_BILL_VEHICLE_MODEL_URL = 'models/BulletBill.glb';
const MINI_OBJECT_MODEL_URL_FALLBACKS = [
  OBJECT_ATTACHABLE_MUSHROOM_MODEL_URL,
  TRACK_COIN_MODEL_URL,
  OBJECT_ATTACHABLE_BULLET_BILL_MODEL_URL,
];
const miniObjectModelModules = import.meta.glob('/models/miniObject/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

type GLTFWithCacheOps = typeof useGLTF & {
  clear?: (path: string | string[]) => void;
  preload?: (path: string | string[]) => void;
};

type CacheClearSchedulerOptions = {
  chunkSize?: number;
  intervalMs?: number;
};

export function normalizeRaceAssetUrl(url: string) {
  const normalized = url.trim().replace(/\\/g, '/');
  if (!normalized) return '';
  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:')
  ) {
    return normalized;
  }

  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\\/g, '/');
  const normalizedBase =
    (baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`).replace(/\/+$/, '') + '/';

  if (normalized.startsWith(normalizedBase)) {
    return normalized.slice(normalizedBase.length);
  }

  return normalized.replace(/^\/+/, '');
}

function dedupeAssetUrls(urls: Iterable<string>) {
  const deduped = new Set<string>();
  for (const url of urls) {
    const normalized = normalizeRaceAssetUrl(url);
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

export const RACE_ATTACHABLE_MODEL_URLS = (() => {
  const discovered = Object.entries(miniObjectModelModules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, path]) => normalizeRaceAssetUrl(path))
    .filter((path): path is string => path.length > 0);

  if (discovered.length > 0) return discovered;
  return MINI_OBJECT_MODEL_URL_FALLBACKS;
})();

function getRaceObjectModelUrls() {
  return dedupeAssetUrls([
    OBJECT_CRATE_MODEL_URL,
    TRACK_COIN_MODEL_URL,
    OBJECT_ATTACHABLE_VOID_MODEL_URL,
    OBJECT_ATTACHABLE_MUSHROOM_MODEL_URL,
    OBJECT_BANANA_MODEL_URL,
    OBJECT_GREEN_SHELL_MODEL_URL,
    OBJECT_RED_SHELL_MODEL_URL,
    OBJECT_BLUE_SHELL_MODEL_URL,
    OBJECT_BOMB_MODEL_URL,
    OBJECT_ATTACHABLE_BULLET_BILL_MODEL_URL,
    OBJECT_BULLET_BILL_VEHICLE_MODEL_URL,
    ...RACE_ATTACHABLE_MODEL_URLS,
  ]);
}

function getCircuitModelUrls() {
  return Object.values(CIRCUITS).flatMap((circuit) => [
    circuit.road.model,
    circuit.ext.model,
    circuit.antiGravIn?.model,
    circuit.antiGravOut?.model,
    circuit.booster?.model,
    circuit.lapStart?.model,
    circuit.lapCheckpoint?.model,
    circuit.waypoints?.model,
  ]);
}

export function getAllKnownModelUrls() {
  return dedupeAssetUrls(
    [
      ...getCircuitModelUrls(),
      ...getRaceObjectModelUrls(),
      ...CHARACTERS.map((entry) => entry.model),
      ...VEHICLES.map((entry) => entry.model),
      ...WHEELS.map((entry) => entry.model),
      LAKITU_MODEL_URL,
    ].filter((url): url is string => Boolean(url)),
  );
}

export function getRaceAssetUrls(raceConfig: RaceConfig) {
  const circuit = CIRCUITS[raceConfig.circuit];
  const urls = [
    circuit.road.model,
    circuit.ext.model,
    circuit.antiGravIn?.model,
    circuit.antiGravOut?.model,
    circuit.booster?.model,
    circuit.lapStart?.model,
    circuit.lapCheckpoint?.model,
    circuit.waypoints?.model,
    LAKITU_MODEL_URL,
    ...getRaceObjectModelUrls(),
    ...raceConfig.participants.flatMap((participant) => [
      participant.characterModel,
      participant.vehicleModel,
      participant.wheelModel,
    ]),
  ];

  return dedupeAssetUrls(urls.filter((url): url is string => Boolean(url)));
}

export function clearGLTFAssetCacheEntries(urls: Iterable<string>) {
  const clear = (useGLTF as GLTFWithCacheOps).clear;
  if (typeof clear !== 'function') return;

  for (const url of dedupeAssetUrls(urls)) {
    clear(url);
  }
}

export function preloadGLTFAssetCacheEntries(urls: Iterable<string>) {
  const preload = (useGLTF as GLTFWithCacheOps).preload;
  if (typeof preload !== 'function') return;

  for (const url of dedupeAssetUrls(urls)) {
    preload(url);
  }
}

export function scheduleGLTFAssetCacheClear(
  urls: Iterable<string>,
  options: CacheClearSchedulerOptions = {},
) {
  const queue = dedupeAssetUrls(urls);
  if (queue.length === 0) {
    return () => undefined;
  }

  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? 1));
  const intervalMs = Math.max(0, Math.floor(options.intervalMs ?? 16));
  const clear = (useGLTF as GLTFWithCacheOps).clear;
  if (typeof clear !== 'function') {
    return () => undefined;
  }

  let cancelled = false;
  let timerId: number | null = null;

  const runChunk = () => {
    if (cancelled) return;

    for (let i = 0; i < chunkSize && queue.length > 0; i += 1) {
      const url = queue.shift();
      if (!url) continue;
      clear(url);
    }

    if (queue.length > 0 && !cancelled) {
      timerId = window.setTimeout(runChunk, intervalMs);
    }
  };

  timerId = window.setTimeout(runChunk, intervalMs);

  return () => {
    cancelled = true;
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };
}

export function scheduleAllKnownModelCacheClear(options: CacheClearSchedulerOptions = {}) {
  return scheduleGLTFAssetCacheClear(getAllKnownModelUrls(), options);
}
