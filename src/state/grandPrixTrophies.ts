import type { GrandPrixId } from '../types/game';

export type GrandPrixTrophyRank = 1 | 2 | 3;
export type GrandPrixTrophyProgress = Partial<Record<GrandPrixId, GrandPrixTrophyRank>>;

const GRAND_PRIX_TROPHY_STORAGE_KEY = 'mk-grand-prix-trophy-progress-v1';

const TROPHY_ASSET_PREFIX_BY_CUP: Record<GrandPrixId, string> = {
  mushroom_cup: 'Mushroom',
  flower_cup: 'Flower',
  star_cup: 'Star',
  special_cup: 'Crown',
  shell_cup: 'Shell',
  banana_cup: 'Banana',
  leaf_cup: 'Leaf',
  lightning_cup: 'Lightning',
  egg_cup: 'Egg',
  triforce_cup: 'Triforce',
  crossing_cup: 'Crossing',
  bell_cup: 'Bell',
};

function toValidTrophyRank(value: unknown): GrandPrixTrophyRank | null {
  if (value === 1 || value === 2 || value === 3) return value;
  return null;
}

export function getGrandPrixTrophyRankFromFinalPosition(
  finalPosition: number,
): GrandPrixTrophyRank | null {
  if (finalPosition === 1 || finalPosition === 2 || finalPosition === 3) {
    return finalPosition;
  }
  return null;
}

export function loadGrandPrixTrophyProgress(): GrandPrixTrophyProgress {
  if (typeof window === 'undefined') return {};

  const serialized = window.localStorage.getItem(GRAND_PRIX_TROPHY_STORAGE_KEY);
  if (!serialized) return {};

  try {
    const parsed = JSON.parse(serialized) as Partial<Record<GrandPrixId, unknown>>;
    const sanitized: GrandPrixTrophyProgress = {};

    for (const cupId of Object.keys(TROPHY_ASSET_PREFIX_BY_CUP) as GrandPrixId[]) {
      const trophyRank = toValidTrophyRank(parsed[cupId]);
      if (trophyRank) {
        sanitized[cupId] = trophyRank;
      }
    }

    return sanitized;
  } catch {
    return {};
  }
}

export function persistGrandPrixTrophyProgress(progress: GrandPrixTrophyProgress) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GRAND_PRIX_TROPHY_STORAGE_KEY, JSON.stringify(progress));
}

export function updateGrandPrixTrophyProgress({
  currentProgress,
  cupId,
  finalPosition,
}: {
  currentProgress: GrandPrixTrophyProgress;
  cupId: GrandPrixId;
  finalPosition: number;
}): GrandPrixTrophyProgress {
  const newRank = getGrandPrixTrophyRankFromFinalPosition(finalPosition);
  if (!newRank) return currentProgress;

  const previousRank = currentProgress[cupId];
  if (previousRank && previousRank <= newRank) return currentProgress;

  return {
    ...currentProgress,
    [cupId]: newRank,
  };
}

export function getGrandPrixTrophyAssetPath({
  cupId,
  rank,
}: {
  cupId: GrandPrixId;
  rank: GrandPrixTrophyRank;
}) {
  const prefix = TROPHY_ASSET_PREFIX_BY_CUP[cupId];
  const trophyAssetIndex =
    rank === 1 ? 3
    : rank === 2 ? 2
    : 1;
  return `ui/Cup/MK8_${prefix}_Cup_Trophy_${trophyAssetIndex}.png`;
}
