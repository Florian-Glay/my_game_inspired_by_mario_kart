import type { BotDrivingTacticalState, CarPose } from '../types/game';

type BotSteerDirection = 'left' | 'right';

type BotTargetPoint = {
  x: number;
  y: number;
  z: number;
};

export type BotAutopilotInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  driftChargeDirection?: BotSteerDirection | null;
};

export type BotWaypoint = {
  index: number;
  position: readonly [number, number, number];
};

type ComputeBotAutopilotInputArgs = {
  participantId: string;
  pose: CarPose | null;
  waypoints?: readonly BotWaypoint[];
  controlsLocked?: boolean;
  courseKey?: string;
  startCountdownValue?: number | null;
  sequentialWaypoints?: boolean;
  drivingTacticalState?: BotDrivingTacticalState | null;
};

type BotWaypointRuntimeState = {
  courseKey: string | null;
  wasControlsLocked: boolean;
  pendingNearestWaypointIndex: number | null;
  lastPassedWaypointIndex: number | null;
  targetWaypointIndex: number | null;
  turnDirection: BotSteerDirection | null;
  turnStartMs: number | null;
  driftChargeTriggeredForTurn: boolean;
  startBoostChargeEnabled: boolean;
  startBoostChargeDelayMs: number;
  startBoostChargeWindowStartMs: number | null;
  lastStartCountdownValue: number | null;
  aimSeed: number;
  aimOffsetRadius: number;
  aimBiasX: number;
  aimBiasZ: number;
};

type WaypointDistance = {
  waypoint: BotWaypoint;
  distance: number;
};

type WaypointLookup = {
  byIndex: Map<number, BotWaypoint>;
  arrayIndexByIndex: Map<number, number>;
};

type WaypointAimProfile = Pick<
  BotWaypointRuntimeState,
  'aimSeed' | 'aimOffsetRadius' | 'aimBiasX' | 'aimBiasZ'
>;

const IDLE_INPUT: BotAutopilotInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  driftChargeDirection: null,
};

// Kept from the current tuning in the project.
const WAYPOINT_REACHED_DISTANCE = 10;
const WAYPOINT_REACHED_DISTANCE_SEQUENTIAL = 18;
const WAYPOINT_ADVANCE_STEP = 6;
const RETARGET_DISTANCE_HYSTERESIS = 3;
const STEER_DEADZONE_RAD = 0.1;

const BOT_DRIFT_TRIGGER_MS = 500;
const START_BOOST_CHARGE_FROM_COUNTDOWN = 2;
const START_BOOST_WINDOW_MS = 2000;
const START_BOOST_BOT_ENABLE_CHANCE = 0.9;
const WAYPOINT_AIM_OFFSET_RADIUS_MIN = 0.5;
const WAYPOINT_AIM_OFFSET_RADIUS_MAX = 2.1;
const WAYPOINT_AIM_BIAS_MAX = 0.75;
const OVERTAKE_ACTIVATION_DISTANCE = 26;
const OVERTAKE_COMMIT_DISTANCE = 8;
const OVERTAKE_DIRECTION_LOOKAHEAD = 2;

const botWaypointStateByParticipant = new Map<string, BotWaypointRuntimeState>();
const waypointLookupCache = new WeakMap<readonly BotWaypoint[], WaypointLookup>();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep01(t: number) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function normalizeAngleRad(angle: number) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomBool(chance: number) {
  return Math.random() < chance;
}

function seededNoise01(seed: number, salt: number) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function createWaypointAimProfile(): WaypointAimProfile {
  const aimSeed = randomRange(1, 1_000_000);
  const aimOffsetRadius = randomRange(WAYPOINT_AIM_OFFSET_RADIUS_MIN, WAYPOINT_AIM_OFFSET_RADIUS_MAX);
  const aimBiasAngle = randomRange(0, Math.PI * 2);
  const aimBiasRadius = randomRange(0, WAYPOINT_AIM_BIAS_MAX);

  return {
    aimSeed,
    aimOffsetRadius,
    aimBiasX: Math.cos(aimBiasAngle) * aimBiasRadius,
    aimBiasZ: Math.sin(aimBiasAngle) * aimBiasRadius,
  };
}

function resetStartBoostPlan(state: BotWaypointRuntimeState) {
  state.startBoostChargeEnabled = randomBool(START_BOOST_BOT_ENABLE_CHANCE);
  state.startBoostChargeDelayMs = randomRange(0, START_BOOST_WINDOW_MS * 0.92);
  state.startBoostChargeWindowStartMs = null;
}

function resetTurnState(state: BotWaypointRuntimeState) {
  state.turnDirection = null;
  state.turnStartMs = null;
  state.driftChargeTriggeredForTurn = false;
}

function getWaypointAimPoint(
  state: BotWaypointRuntimeState,
  waypoint: BotWaypoint,
): BotTargetPoint {
  const angleNoise = seededNoise01(state.aimSeed, waypoint.index * 2 + 1);
  const radiusNoise = seededNoise01(state.aimSeed, waypoint.index * 2 + 2);
  const angle = angleNoise * Math.PI * 2;
  const radius = state.aimOffsetRadius * (0.35 + radiusNoise * 0.65);

  return {
    x: waypoint.position[0] + state.aimBiasX + Math.cos(angle) * radius,
    y: waypoint.position[1],
    z: waypoint.position[2] + state.aimBiasZ + Math.sin(angle) * radius,
  };
}

function distanceToTargetPoint(pose: CarPose, targetPoint: BotTargetPoint) {
  return Math.hypot(targetPoint.x - pose.x, targetPoint.y - pose.y, targetPoint.z - pose.z);
}

function findNearestWaypoint(
  pose: CarPose,
  waypoints: readonly BotWaypoint[],
): WaypointDistance | null {
  let nearestWaypoint: BotWaypoint | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;

  for (const waypoint of waypoints) {
    const dx = waypoint.position[0] - pose.x;
    const dy = waypoint.position[1] - pose.y;
    const dz = waypoint.position[2] - pose.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;

    if (distanceSq < nearestDistanceSq) {
      nearestWaypoint = waypoint;
      nearestDistanceSq = distanceSq;
    }
  }

  if (!nearestWaypoint) return null;

  return {
    waypoint: nearestWaypoint,
    distance: Math.sqrt(nearestDistanceSq),
  };
}

function getWaypointLookup(waypoints: readonly BotWaypoint[]): WaypointLookup {
  const cached = waypointLookupCache.get(waypoints);
  if (cached) return cached;

  const byIndex = new Map<number, BotWaypoint>();
  const arrayIndexByIndex = new Map<number, number>();
  waypoints.forEach((waypoint, arrayIndex) => {
    byIndex.set(waypoint.index, waypoint);
    arrayIndexByIndex.set(waypoint.index, arrayIndex);
  });

  const created: WaypointLookup = {
    byIndex,
    arrayIndexByIndex,
  };
  waypointLookupCache.set(waypoints, created);
  return created;
}

function getWaypointByIndex(
  waypoints: readonly BotWaypoint[],
  waypointIndex: number | null,
) {
  if (waypointIndex === null) return null;
  return getWaypointLookup(waypoints).byIndex.get(waypointIndex) ?? null;
}

function getWaypointArrayIndex(
  waypoints: readonly BotWaypoint[],
  waypointIndex: number | null,
) {
  if (waypointIndex === null) return null;
  return getWaypointLookup(waypoints).arrayIndexByIndex.get(waypointIndex) ?? null;
}

function getNextWaypointIndex(
  currentWaypointIndex: number,
  waypoints: readonly BotWaypoint[],
  advanceStep: number = WAYPOINT_ADVANCE_STEP,
) {
  if (waypoints.length === 0) return null;

  const normalizedAdvanceStep = Math.max(1, Math.floor(advanceStep));
  const currentArrayIndex = waypoints.findIndex((waypoint) => waypoint.index === currentWaypointIndex);
  if (currentArrayIndex < 0) return waypoints[0]?.index ?? null;

  const nextArrayIndex = (currentArrayIndex + normalizedAdvanceStep) % waypoints.length;
  return waypoints[nextArrayIndex]?.index ?? waypoints[0]?.index ?? null;
}

function getWaypointDirectionXZ(
  waypoints: readonly BotWaypoint[],
  waypointIndex: number | null,
  lookaheadSteps: number = OVERTAKE_DIRECTION_LOOKAHEAD,
) {
  if (waypoints.length === 0 || waypointIndex === null) return null;

  const startArrayIndex = getWaypointArrayIndex(waypoints, waypointIndex);
  if (startArrayIndex === null) return null;

  const startWaypoint = waypoints[startArrayIndex];
  const normalizedLookahead = Math.max(1, Math.floor(lookaheadSteps));

  for (let step = 1; step <= normalizedLookahead; step += 1) {
    const nextWaypoint = waypoints[(startArrayIndex + step) % waypoints.length];
    if (!nextWaypoint) continue;

    const dx = nextWaypoint.position[0] - startWaypoint.position[0];
    const dz = nextWaypoint.position[2] - startWaypoint.position[2];
    const length = Math.hypot(dx, dz);
    if (length <= 0.0001) continue;

    return {
      x: dx / length,
      z: dz / length,
    };
  }

  return null;
}

function getDesiredOvertakeLaneOffset(
  drivingTacticalState: BotDrivingTacticalState | null | undefined,
) {
  const targetDistance = drivingTacticalState?.overtakeTargetDistance ?? null;
  const desiredLaneOffset = drivingTacticalState?.desiredLaneOffset ?? null;
  if (
    targetDistance === null ||
    !Number.isFinite(targetDistance) ||
    desiredLaneOffset === null ||
    !Number.isFinite(desiredLaneOffset) ||
    Math.abs(desiredLaneOffset) <= 0.0001 ||
    targetDistance > OVERTAKE_ACTIVATION_DISTANCE
  ) {
    return null;
  }

  const blendT =
    (OVERTAKE_ACTIVATION_DISTANCE - targetDistance) /
    Math.max(0.001, OVERTAKE_ACTIVATION_DISTANCE - OVERTAKE_COMMIT_DISTANCE);
  const blend = 0.25 + smoothstep01(blendT) * 0.75;
  return desiredLaneOffset * blend;
}

function applyLaneOffsetToAimPoint(
  pose: CarPose,
  targetPoint: BotTargetPoint,
  targetWaypoint: BotWaypoint,
  waypoints: readonly BotWaypoint[],
  laneOffset: number,
): BotTargetPoint {
  const direction = getWaypointDirectionXZ(waypoints, targetWaypoint.index);
  const fallbackDirectionX = Math.sin(pose.yaw);
  const fallbackDirectionZ = Math.cos(pose.yaw);
  const rawDirectionX = direction?.x ?? fallbackDirectionX;
  const rawDirectionZ = direction?.z ?? fallbackDirectionZ;
  const directionLength = Math.hypot(rawDirectionX, rawDirectionZ);
  if (directionLength <= 0.0001) return targetPoint;

  const directionX = rawDirectionX / directionLength;
  const directionZ = rawDirectionZ / directionLength;
  const rightX = directionZ;
  const rightZ = -directionX;

  return {
    x: targetPoint.x + rightX * laneOffset,
    y: targetPoint.y,
    z: targetPoint.z + rightZ * laneOffset,
  };
}

function createBotWaypointState(): BotWaypointRuntimeState {
  const aimProfile = createWaypointAimProfile();
  const created: BotWaypointRuntimeState = {
    courseKey: null,
    wasControlsLocked: true,
    pendingNearestWaypointIndex: null,
    lastPassedWaypointIndex: null,
    targetWaypointIndex: null,
    turnDirection: null,
    turnStartMs: null,
    driftChargeTriggeredForTurn: false,
    startBoostChargeEnabled: true,
    startBoostChargeDelayMs: 0,
    startBoostChargeWindowStartMs: null,
    lastStartCountdownValue: null,
    aimSeed: aimProfile.aimSeed,
    aimOffsetRadius: aimProfile.aimOffsetRadius,
    aimBiasX: aimProfile.aimBiasX,
    aimBiasZ: aimProfile.aimBiasZ,
  };
  resetStartBoostPlan(created);
  return created;
}

function getOrCreateBotWaypointState(participantId: string): BotWaypointRuntimeState {
  const existing = botWaypointStateByParticipant.get(participantId);
  if (existing) return existing;

  const created = createBotWaypointState();
  botWaypointStateByParticipant.set(participantId, created);
  return created;
}

function applyWaypointAimProfile(state: BotWaypointRuntimeState, profile: WaypointAimProfile) {
  state.aimSeed = profile.aimSeed;
  state.aimOffsetRadius = profile.aimOffsetRadius;
  state.aimBiasX = profile.aimBiasX;
  state.aimBiasZ = profile.aimBiasZ;
}

function getWaypointCenterAimPoint(waypoint: BotWaypoint): BotTargetPoint {
  return {
    x: waypoint.position[0],
    y: waypoint.position[1],
    z: waypoint.position[2],
  };
}

export function computeBotAutopilotInput(
  args: ComputeBotAutopilotInputArgs,
): BotAutopilotInput {
  const {
    participantId,
    pose,
    controlsLocked = false,
    courseKey = null,
    waypoints = [],
    startCountdownValue = null,
    sequentialWaypoints = false,
    drivingTacticalState = null,
  } = args;
  if (!pose || waypoints.length === 0) return IDLE_INPUT;

  const nowMs = performance.now();
  const waypointAdvanceStep = sequentialWaypoints ? 1 : WAYPOINT_ADVANCE_STEP;
  const waypointReachedDistance =
    sequentialWaypoints ? WAYPOINT_REACHED_DISTANCE_SEQUENTIAL : WAYPOINT_REACHED_DISTANCE;
  const steerDeadzoneRad = sequentialWaypoints ? STEER_DEADZONE_RAD * 0.7 : STEER_DEADZONE_RAD;
  const state = getOrCreateBotWaypointState(participantId);

  if (state.courseKey !== courseKey) {
    state.courseKey = courseKey;
    state.wasControlsLocked = true;
    state.pendingNearestWaypointIndex = null;
    state.lastPassedWaypointIndex = null;
    state.targetWaypointIndex = null;
    resetTurnState(state);
    resetStartBoostPlan(state);
    state.lastStartCountdownValue = null;
    applyWaypointAimProfile(state, createWaypointAimProfile());
  }

  if (state.lastStartCountdownValue === null && startCountdownValue !== null) {
    resetStartBoostPlan(state);
  }
  if (state.lastStartCountdownValue !== null && startCountdownValue === null) {
    state.startBoostChargeWindowStartMs = null;
  }
  state.lastStartCountdownValue = startCountdownValue;

  const nearest = findNearestWaypoint(pose, waypoints);
  if (!nearest) return IDLE_INPUT;

  if (controlsLocked) {
    resetTurnState(state);

    const canChargeStartBoost =
      typeof startCountdownValue === 'number' &&
      startCountdownValue > 0 &&
      startCountdownValue <= START_BOOST_CHARGE_FROM_COUNTDOWN;

    let holdForwardForStartBoost = false;
    if (canChargeStartBoost && state.startBoostChargeEnabled) {
      if (state.startBoostChargeWindowStartMs === null) {
        state.startBoostChargeWindowStartMs = nowMs;
      }
      holdForwardForStartBoost =
        nowMs - state.startBoostChargeWindowStartMs >= state.startBoostChargeDelayMs;
    } else if (!canChargeStartBoost) {
      state.startBoostChargeWindowStartMs = null;
    }

    state.wasControlsLocked = true;
    state.pendingNearestWaypointIndex = nearest.waypoint.index;
    state.lastPassedWaypointIndex = nearest.waypoint.index;
    state.targetWaypointIndex = null;
    return {
      ...IDLE_INPUT,
      forward: holdForwardForStartBoost,
    };
  }

  if (state.wasControlsLocked || state.targetWaypointIndex === null) {
    const startWaypointIndex = state.pendingNearestWaypointIndex ?? nearest.waypoint.index;
    state.lastPassedWaypointIndex = startWaypointIndex;
    state.targetWaypointIndex = getNextWaypointIndex(startWaypointIndex, waypoints, waypointAdvanceStep);
    state.pendingNearestWaypointIndex = null;
    state.wasControlsLocked = false;
  }

  let targetWaypoint = getWaypointByIndex(waypoints, state.targetWaypointIndex);
  if (!targetWaypoint) {
    targetWaypoint = nearest.waypoint;
    state.targetWaypointIndex = targetWaypoint.index;
  }
  let targetAimPoint =
    sequentialWaypoints ? getWaypointCenterAimPoint(targetWaypoint) : getWaypointAimPoint(state, targetWaypoint);

  let targetDistance = distanceToTargetPoint(pose, targetAimPoint);

  if (targetDistance <= waypointReachedDistance) {
    state.lastPassedWaypointIndex = targetWaypoint.index;
    state.targetWaypointIndex = getNextWaypointIndex(targetWaypoint.index, waypoints, waypointAdvanceStep);
    targetWaypoint = getWaypointByIndex(waypoints, state.targetWaypointIndex) ?? targetWaypoint;
    targetAimPoint =
      sequentialWaypoints ? getWaypointCenterAimPoint(targetWaypoint) : getWaypointAimPoint(state, targetWaypoint);
    targetDistance = distanceToTargetPoint(pose, targetAimPoint);
  }

  const nearestIsDifferentFromLastPassed =
    state.lastPassedWaypointIndex === null || nearest.waypoint.index !== state.lastPassedWaypointIndex;
  if (
    !sequentialWaypoints &&
    nearestIsDifferentFromLastPassed &&
    nearest.waypoint.index !== targetWaypoint.index &&
    nearest.waypoint.index > targetWaypoint.index &&
    nearest.distance + RETARGET_DISTANCE_HYSTERESIS < targetDistance
  ) {
    targetWaypoint = nearest.waypoint;
    state.targetWaypointIndex = nearest.waypoint.index;
    targetAimPoint = getWaypointAimPoint(state, targetWaypoint);
  }

  const overtakeLaneOffset =
    !sequentialWaypoints ? getDesiredOvertakeLaneOffset(drivingTacticalState) : null;
  const steeringAimPoint =
    overtakeLaneOffset === null ?
      targetAimPoint
    : applyLaneOffsetToAimPoint(pose, targetAimPoint, targetWaypoint, waypoints, overtakeLaneOffset);

  const dx = steeringAimPoint.x - pose.x;
  const dz = steeringAimPoint.z - pose.z;
  const desiredYaw = Math.atan2(dx, dz);
  const yawDelta = normalizeAngleRad(desiredYaw - pose.yaw);

  const turnDirection: BotSteerDirection | null =
    yawDelta > steerDeadzoneRad ? 'left'
    : yawDelta < -steerDeadzoneRad ? 'right'
    : null;

  if (sequentialWaypoints) {
    state.turnDirection = turnDirection;
    state.turnStartMs = null;
    state.driftChargeTriggeredForTurn = false;
  } else {
    if (turnDirection !== state.turnDirection) {
      state.turnDirection = turnDirection;
      state.turnStartMs = turnDirection ? nowMs : null;
      state.driftChargeTriggeredForTurn = false;
    } else if (
      turnDirection !== null &&
      state.turnStartMs !== null &&
      !state.driftChargeTriggeredForTurn &&
      nowMs - state.turnStartMs >= BOT_DRIFT_TRIGGER_MS
    ) {
      state.driftChargeTriggeredForTurn = true;
    }
  }

  return {
    forward: true,
    back: false,
    left: turnDirection === 'left',
    right: turnDirection === 'right',
    driftChargeDirection:
      state.driftChargeTriggeredForTurn && turnDirection !== null ? turnDirection : null,
  };
}
