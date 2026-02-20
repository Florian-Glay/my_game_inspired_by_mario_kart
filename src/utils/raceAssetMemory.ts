import { useGLTF } from '@react-three/drei';
import { CHARACTERS, VEHICLES, WHEELS } from '../config/garageCatalog';
import { CIRCUITS } from '../config/raceCatalog';
import type { RaceConfig } from '../types/game';

const LAKITU_MODEL_URL = 'models/lakitu.glb';

type GLTFWithClear = typeof useGLTF & {
  clear?: (path: string | string[]) => void;
};

type CacheClearSchedulerOptions = {
  chunkSize?: number;
  intervalMs?: number;
};

function dedupeAssetUrls(urls: Iterable<string>) {
  const deduped = new Set<string>();
  for (const url of urls) {
    const normalized = url.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped);
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
  ]);
}

export function getAllKnownModelUrls() {
  return dedupeAssetUrls(
    [
      ...getCircuitModelUrls(),
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
    LAKITU_MODEL_URL,
    ...raceConfig.participants.flatMap((participant) => [
      participant.characterModel,
      participant.vehicleModel,
      participant.wheelModel,
    ]),
  ];

  return dedupeAssetUrls(urls.filter((url): url is string => Boolean(url)));
}

export function clearGLTFAssetCacheEntries(urls: Iterable<string>) {
  const clear = (useGLTF as GLTFWithClear).clear;
  if (typeof clear !== 'function') return;

  for (const url of dedupeAssetUrls(urls)) {
    clear(url);
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
  const clear = (useGLTF as GLTFWithClear).clear;
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
