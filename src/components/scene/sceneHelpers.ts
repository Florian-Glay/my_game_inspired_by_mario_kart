import type { MutableRefObject } from 'react';
import type { BotWaypoint } from '../../ai/botAutopilot';
import type { CarPose, RaceConfig, RaceParticipantId, Vec3 } from '../../types/game';
import {
  BOT_OVERTAKE_DIRECTION_LOOKAHEAD,
  BOT_OVERTAKE_FUTURE_TURN_LOOKAHEAD,
  COURSE_POINTS_BY_POSITION,
  FALLBACK_PROGRESS,
} from './sceneConstants';
import type {
  LiveScoreboardEntry,
  ObjectCrateSpawnEntry,
  PlayerLapProgress,
  TrackCoinSpawnEntry,
} from './sceneTypes';

type LiveScoreboardSortEntry = {
  participantId: RaceParticipantId;
  displayName: string;
  completedLaps: number;
  checkpoint: boolean;
  finished: boolean;
  finishTimestamp: number;
  waypointsRemainingToFinish: number;
};

export const resolveUiAssetSrc = (assetPath: string) => {
  if (
    assetPath.startsWith('http://') ||
    assetPath.startsWith('https://') ||
    assetPath.startsWith('data:') ||
    assetPath.startsWith('blob:')
  ) {
    return assetPath;
  }
  if (assetPath.startsWith('/')) return assetPath;
  return `${import.meta.env.BASE_URL}${assetPath}`;
};

export const getCoursePointsForPosition = (position: number) => {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return COURSE_POINTS_BY_POSITION[position - 1] ?? 0;
};

export const resolvePoseForwardVector = (pose: CarPose) => {
  const fallbackForwardX = Number.isFinite(pose.yaw) ? Math.sin(pose.yaw) : 0;
  const fallbackForwardZ = Number.isFinite(pose.yaw) ? Math.cos(pose.yaw) : 1;
  const rawForwardXCandidate = pose.forwardX ?? fallbackForwardX;
  const rawForwardZCandidate = pose.forwardZ ?? fallbackForwardZ;
  const rawForwardX = Number.isFinite(rawForwardXCandidate) ? rawForwardXCandidate : fallbackForwardX;
  const rawForwardZ = Number.isFinite(rawForwardZCandidate) ? rawForwardZCandidate : fallbackForwardZ;
  const rawLength = Math.hypot(rawForwardX, rawForwardZ);
  return {
    forwardX: rawLength > 0.0001 ? rawForwardX / rawLength : fallbackForwardX,
    forwardZ: rawLength > 0.0001 ? rawForwardZ / rawLength : fallbackForwardZ,
  };
};

export const findNearestWaypointIndex = (
  pose: CarPose | null | undefined,
  waypoints: readonly BotWaypoint[],
) => {
  if (!pose || waypoints.length === 0) return null;

  let nearestWaypointIndex: number | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const waypoint of waypoints) {
    const dx = waypoint.position[0] - pose.x;
    const dy = waypoint.position[1] - pose.y;
    const dz = waypoint.position[2] - pose.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) continue;
    nearestDistanceSq = distanceSq;
    nearestWaypointIndex = waypoint.index;
  }

  return nearestWaypointIndex;
};

export const findNearestWaypointArrayIndex = (
  position: Vec3,
  waypoints: readonly BotWaypoint[],
) => {
  if (waypoints.length === 0) return null;

  let nearestWaypointArrayIndex: number | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index];
    const dx = waypoint.position[0] - position[0];
    const dy = waypoint.position[1] - position[1];
    const dz = waypoint.position[2] - position[2];
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) continue;
    nearestDistanceSq = distanceSq;
    nearestWaypointArrayIndex = index;
  }

  return nearestWaypointArrayIndex;
};

const getWaypointStepsToFinish = (
  currentWaypointOrder: number | null,
  finishWaypointOrder: number | null,
  waypointCount: number,
) => {
  if (currentWaypointOrder === null || finishWaypointOrder === null || waypointCount <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (finishWaypointOrder - currentWaypointOrder + waypointCount) % waypointCount;
};

const getWaypointAtOffset = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
  offset: number,
) => {
  if (currentWaypointOrder === null || waypoints.length === 0) return null;
  const normalizedIndex =
    ((currentWaypointOrder + offset) % waypoints.length + waypoints.length) % waypoints.length;
  return waypoints[normalizedIndex] ?? null;
};

export const getWaypointDirectionXZ = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
  lookaheadOffset: number,
) => {
  const originWaypoint = getWaypointAtOffset(waypoints, currentWaypointOrder, 0);
  if (!originWaypoint) return null;

  const normalizedLookahead = Math.max(1, Math.floor(lookaheadOffset));
  for (let offset = 1; offset <= normalizedLookahead; offset += 1) {
    const nextWaypoint = getWaypointAtOffset(waypoints, currentWaypointOrder, offset);
    if (!nextWaypoint) continue;

    const dx = nextWaypoint.position[0] - originWaypoint.position[0];
    const dz = nextWaypoint.position[2] - originWaypoint.position[2];
    const length = Math.hypot(dx, dz);
    if (length <= 0.0001) continue;

    return {
      x: dx / length,
      z: dz / length,
    };
  }

  return null;
};

export const getUpcomingTurnBias = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
) => {
  const nearDirection = getWaypointDirectionXZ(waypoints, currentWaypointOrder, BOT_OVERTAKE_DIRECTION_LOOKAHEAD);
  const futureDirection = getWaypointDirectionXZ(
    waypoints,
    currentWaypointOrder,
    BOT_OVERTAKE_FUTURE_TURN_LOOKAHEAD,
  );
  if (!nearDirection || !futureDirection) return 0;
  return nearDirection.x * futureDirection.z - nearDirection.z * futureDirection.x;
};

export const buildLiveScoreboardEntries = ({
  participants,
  progressByPlayer,
  poseRefsByParticipant,
  participantOrder,
  circuitWaypoints,
  waypointOrderByIndex,
  finishWaypointOrder,
  waypointCount,
}: {
  participants: RaceConfig['participants'];
  progressByPlayer: Record<RaceParticipantId, PlayerLapProgress>;
  poseRefsByParticipant: Record<RaceParticipantId, MutableRefObject<CarPose>>;
  participantOrder: Map<RaceParticipantId, number>;
  circuitWaypoints: readonly BotWaypoint[];
  waypointOrderByIndex: Map<number, number>;
  finishWaypointOrder: number | null;
  waypointCount: number;
}): LiveScoreboardEntry[] => {
  const ranking: LiveScoreboardSortEntry[] = participants.map((participant) => {
    const progress = progressByPlayer[participant.id] ?? FALLBACK_PROGRESS;
    const completedLaps = Math.min(Math.max(progress.lap - 1, 0), 3);
    const pose = poseRefsByParticipant[participant.id]?.current;
    const currentWaypointIndex = findNearestWaypointIndex(pose, circuitWaypoints);
    const currentWaypointOrder =
      currentWaypointIndex === null ? null : (waypointOrderByIndex.get(currentWaypointIndex) ?? null);
    const waypointsRemainingToFinish = getWaypointStepsToFinish(
      currentWaypointOrder,
      finishWaypointOrder,
      waypointCount,
    );

    return {
      participantId: participant.id,
      displayName: participant.displayName,
      completedLaps,
      checkpoint: progress.checkpoint,
      finished: progress.finished,
      finishTimestamp: progress.finishTimestamp ?? Number.POSITIVE_INFINITY,
      waypointsRemainingToFinish,
    };
  });

  ranking.sort((left, right) => {
    if (left.finished !== right.finished) return left.finished ? -1 : 1;
    if (left.finished && right.finished && left.finishTimestamp !== right.finishTimestamp) {
      return left.finishTimestamp - right.finishTimestamp;
    }
    if (left.completedLaps !== right.completedLaps) {
      return right.completedLaps - left.completedLaps;
    }
    if (left.waypointsRemainingToFinish !== right.waypointsRemainingToFinish) {
      return left.waypointsRemainingToFinish - right.waypointsRemainingToFinish;
    }
    return (
      (participantOrder.get(left.participantId) ?? 0) -
      (participantOrder.get(right.participantId) ?? 0)
    );
  });

  return ranking.map(
    ({ finishTimestamp: _ignoredTime, waypointsRemainingToFinish: _ignoredWaypoints, ...entry }, index) => ({
      ...entry,
      position: index + 1,
    }),
  );
};

export function createInitialLapProgress(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, PlayerLapProgress>>((acc, participant) => {
    acc[participant.id] = { ...FALLBACK_PROGRESS };
    return acc;
  }, {});
}

export function createInitialParticipantObjects(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function createInitialParticipantObjectCharges(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function createInitialParticipantThunderDebuffUntil(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function createInitialParticipantBulletBillUntil(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function createInitialParticipantCoins(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function createObjectCrateActivationMap(spawns: ObjectCrateSpawnEntry[]) {
  return spawns.reduce<Record<string, boolean>>((acc, spawn) => {
    acc[spawn.crateId] = true;
    return acc;
  }, {});
}

export function createInitialParticipantStunUntil(participants: RaceConfig['participants']) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

export function buildParticipantItemStateSnapshot(
  participantId: RaceParticipantId,
  state: {
    objects: Record<RaceParticipantId, number>;
    objectCharges: Record<RaceParticipantId, number>;
    coins: Record<RaceParticipantId, number>;
    thunderDebuffUntil: Record<RaceParticipantId, number>;
    bulletBillUntil: Record<RaceParticipantId, number>;
    stunUntil: Record<RaceParticipantId, number>;
  },
) {
  return {
    heldObject: state.objects[participantId] ?? 0,
    objectCharges: state.objectCharges[participantId] ?? 0,
    coins: state.coins[participantId] ?? 0,
    thunderDebuffUntilTimestampMs: state.thunderDebuffUntil[participantId] ?? 0,
    bulletBillUntilTimestampMs: state.bulletBillUntil[participantId] ?? 0,
    stunUntilTimestampMs: state.stunUntil[participantId] ?? 0,
  };
}

export function createTrackCoinActivationMap(spawns: TrackCoinSpawnEntry[]) {
  return spawns.reduce<Record<string, boolean>>((acc, spawn) => {
    acc[spawn.coinId] = true;
    return acc;
  }, {});
}
