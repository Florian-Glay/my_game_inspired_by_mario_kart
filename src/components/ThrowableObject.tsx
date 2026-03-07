import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BallCollider,
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type CollisionEnterPayload,
  type IntersectionEnterPayload,
  type RapierRigidBody,
} from '@react-three/rapier';
import type { CarPose, RaceParticipantId, Vec3 } from '../types/game';
import Model from './Model';

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_COLLIDER_HALF_EXTENTS: Vec3 = [0.62, 0.62, 0.62];
const SHELL_MAX_BOUNCES = 4;
const SHELL_WALL_NORMAL_MAX_Y = 0.3;
const SHELL_BOUNCE_REPEAT_COOLDOWN_MS = 90;
const SHELL_OWNER_IMMUNITY_MS = 1000;
const RED_SHELL_TURN_RATE_RAD_PER_SEC = Math.PI * 2.4;
const BLUE_SHELL_ASCEND_TRIGGER_DISTANCE = 30;
const BLUE_SHELL_HOVER_HEIGHT = 18;
const BLUE_SHELL_ASCEND_SPEED = 24;
const BLUE_SHELL_DIVE_SPEED = 72;
const BLUE_SHELL_DIVE_TRIGGER_DISTANCE = 8;
const BLUE_SHELL_IMPACT_DISTANCE = 4.5;
const BLUE_SHELL_EXPLOSION_DURATION_MS = 2000;
const DEFAULT_BLUE_SHELL_EXPLOSION_RADIUS = 12;
const BOMB_ARMED_DURATION_MS = 3000;
const BOMB_EXPLOSION_DURATION_MS = 2000;
const DEFAULT_BOMB_EXPLOSION_RADIUS = 12;

export type ThrowableObjectBehavior =
  | 'banana'
  | 'green-shell'
  | 'red-shell'
  | 'blue-shell'
  | 'bomb';

export type ThrowableObjectProps = {
  throwableId: string;
  sourceObjectValue: number;
  ownerParticipantId: RaceParticipantId;
  behavior?: ThrowableObjectBehavior;
  modelPath: string;
  spawnPosition: Vec3;
  launchVelocity: Vec3;
  resolveRedShellDirection?: (
    position: Vec3,
    ownerParticipantId: RaceParticipantId,
  ) => { x: number; z: number } | null;
  resolveBlueShellTargetParticipantId?: (
    ownerParticipantId: RaceParticipantId,
  ) => RaceParticipantId | null;
  resolveBlueShellGroundDirection?: (
    position: Vec3,
    ownerParticipantId: RaceParticipantId,
    targetParticipantId: RaceParticipantId | null,
  ) => { x: number; z: number } | null;
  resolveParticipantPose?: (participantId: RaceParticipantId) => CarPose | null;
  resolveParticipantsWithinRadius?: (
    position: Vec3,
    radius: number,
  ) => RaceParticipantId[];
  blueShellExplosionRadius?: number;
  bombExplosionRadius?: number;
  ttlMs?: number;
  colliderHalfExtents?: Vec3;
  onExpired: (throwableId: string) => void;
  onGroundedParticipantHit: (
    throwableId: string,
    participantId: RaceParticipantId,
    sourceObjectValue: number,
  ) => void;
};

type BlueShellPhase = 'ground' | 'aerial-chase' | 'dive';
type BombPhase = 'flying' | 'grounded';

type ExplosionState = {
  position: Vec3;
  radius: number;
  color: string;
  emissive: string;
  durationMs: number;
};

const resolveParticipantId = (candidate: unknown): RaceParticipantId | null => {
  if (!candidate || typeof candidate !== 'object') return null;

  const participantId = (candidate as any).participantId;
  if (typeof participantId !== 'string' || participantId.length === 0) return null;
  return participantId;
};

const resolveParticipantIdFromCollisionPayload = (payload: CollisionEnterPayload) => {
  const candidates = [
    payload.other.colliderObject?.userData,
    payload.other.rigidBodyObject?.userData,
    (payload.other.collider as any)?.userData,
    (payload.other.rigidBody as any)?.userData,
  ];

  for (const candidate of candidates) {
    const participantId = resolveParticipantId(candidate);
    if (participantId) return participantId;
  }

  return null;
};

const resolveParticipantIdFromIntersectionPayload = (payload: IntersectionEnterPayload) => {
  const candidates = [
    payload.other.colliderObject?.userData,
    payload.other.rigidBodyObject?.userData,
    (payload.other.collider as any)?.userData,
    (payload.other.rigidBody as any)?.userData,
  ];

  for (const candidate of candidates) {
    const participantId = resolveParticipantId(candidate);
    if (participantId) return participantId;
  }

  return null;
};

const normalizeAngle = (angle: number) => {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
};

const resolveCollisionNormal = (payload: CollisionEnterPayload) => {
  const rawNormal = payload.manifold.normal();
  const sign = payload.flipped ? -1 : 1;
  return {
    x: rawNormal.x * sign,
    y: rawNormal.y * sign,
    z: rawNormal.z * sign,
  };
};

const normalizePlanarDirection = (x: number, z: number) => {
  const length = Math.hypot(x, z);
  if (length <= 0.0001) return null;
  return {
    x: x / length,
    z: z / length,
  };
};

export function ThrowableObject({
  throwableId,
  sourceObjectValue,
  ownerParticipantId,
  behavior = 'banana',
  modelPath,
  spawnPosition,
  launchVelocity,
  resolveRedShellDirection,
  resolveBlueShellTargetParticipantId,
  resolveBlueShellGroundDirection,
  resolveParticipantPose,
  resolveParticipantsWithinRadius,
  blueShellExplosionRadius = DEFAULT_BLUE_SHELL_EXPLOSION_RADIUS,
  bombExplosionRadius = DEFAULT_BOMB_EXPLOSION_RADIUS,
  ttlMs = DEFAULT_TTL_MS,
  colliderHalfExtents = DEFAULT_COLLIDER_HALF_EXTENTS,
  onExpired,
  onGroundedParticipantHit,
}: ThrowableObjectProps) {
  const { rapier, world } = useRapier();
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const bananaPhaseRef = useRef<'flying' | 'grounded'>('flying');
  const bombPhaseRef = useRef<BombPhase>('flying');
  const projectileActiveRef = useRef(true);
  const expiredRef = useRef(false);
  const [groundedBananaPosition, setGroundedBananaPosition] = useState<Vec3 | null>(null);
  const [groundedBombPosition, setGroundedBombPosition] = useState<Vec3 | null>(null);
  const [explosionState, setExplosionState] = useState<ExplosionState | null>(null);
  const shellDirectionRef = useRef<{ x: number; z: number }>({ x: 0, z: 1 });
  const shellSpeedRef = useRef(0);
  const shellBounceCountRef = useRef(0);
  const shellLastBounceColliderHandleRef = useRef<number | null>(null);
  const shellLastBounceAtMsRef = useRef(0);
  const shellSpawnAtMsRef = useRef(0);
  const blueShellPhaseRef = useRef<BlueShellPhase>('ground');
  const areaHitParticipantsRef = useRef<Set<RaceParticipantId>>(new Set());
  const resolvedTtlMs = useMemo(
    () => Math.max(100, Math.floor(Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS)),
    [ttlMs],
  );
  const resolvedBlueShellExplosionRadius = useMemo(
    () =>
      Math.max(
        1,
        Number.isFinite(blueShellExplosionRadius)
          ? blueShellExplosionRadius
          : DEFAULT_BLUE_SHELL_EXPLOSION_RADIUS,
      ),
    [blueShellExplosionRadius],
  );
  const resolvedBombExplosionRadius = useMemo(
    () =>
      Math.max(
        1,
        Number.isFinite(bombExplosionRadius)
          ? bombExplosionRadius
          : DEFAULT_BOMB_EXPLOSION_RADIUS,
      ),
    [bombExplosionRadius],
  );
  const activeCollisionTypes = useMemo(
    () =>
      rapier.ActiveCollisionTypes.DEFAULT |
      rapier.ActiveCollisionTypes.KINEMATIC_FIXED |
      rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
    [rapier],
  );
  const activeLifetimeMs = explosionState?.durationMs ?? resolvedTtlMs;

  const resolveAndExpire = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    onExpired(throwableId);
  }, [onExpired, throwableId]);

  const registerParticipantHit = useCallback(
    (participantId: RaceParticipantId) => {
      if (behavior === 'blue-shell' || behavior === 'bomb') {
        if (areaHitParticipantsRef.current.has(participantId)) return;
        areaHitParticipantsRef.current.add(participantId);
      }

      onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
    },
    [behavior, onGroundedParticipantHit, sourceObjectValue, throwableId],
  );

  const applyExplosionHits = useCallback(
    (position: Vec3, radius: number) => {
      const impactedParticipants = resolveParticipantsWithinRadius?.(position, radius) ?? [];
      for (const participantId of impactedParticipants) {
        registerParticipantHit(participantId);
      }
    },
    [registerParticipantHit, resolveParticipantsWithinRadius],
  );

  const triggerExplosion = useCallback(
    (nextExplosion: ExplosionState) => {
      if (!projectileActiveRef.current) return;

      projectileActiveRef.current = false;
      setExplosionState(nextExplosion);
      applyExplosionHits(nextExplosion.position, nextExplosion.radius);
    },
    [applyExplosionHits],
  );

  const triggerBlueShellExplosion = useCallback(
    (position: Vec3) => {
      if (behavior !== 'blue-shell') return;

      triggerExplosion({
        position: [position[0], position[1], position[2]],
        radius: resolvedBlueShellExplosionRadius,
        color: '#2f6fff',
        emissive: '#2f6fff',
        durationMs: BLUE_SHELL_EXPLOSION_DURATION_MS,
      });
    },
    [behavior, resolvedBlueShellExplosionRadius, triggerExplosion],
  );

  const triggerBombExplosion = useCallback(
    (position: Vec3) => {
      if (behavior !== 'bomb') return;

      triggerExplosion({
        position: [position[0], position[1], position[2]],
        radius: resolvedBombExplosionRadius,
        color: '#ff3b30',
        emissive: '#ff3b30',
        durationMs: BOMB_EXPLOSION_DURATION_MS,
      });
    },
    [behavior, resolvedBombExplosionRadius, triggerExplosion],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      resolveAndExpire();
    }, activeLifetimeMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeLifetimeMs, resolveAndExpire]);

  useEffect(() => {
    if (behavior !== 'bomb') return;
    if (!groundedBombPosition || explosionState) return;

    const timer = window.setTimeout(() => {
      triggerBombExplosion(groundedBombPosition);
    }, BOMB_ARMED_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [behavior, explosionState, groundedBombPosition, triggerBombExplosion]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    areaHitParticipantsRef.current.clear();
    shellSpawnAtMsRef.current = performance.now();

    if (
      behavior === 'green-shell' ||
      behavior === 'red-shell' ||
      behavior === 'blue-shell'
    ) {
      blueShellPhaseRef.current = 'ground';
      const length = Math.hypot(launchVelocity[0], launchVelocity[2]);
      const directionX = length > 0.0001 ? launchVelocity[0] / length : 0;
      const directionZ = length > 0.0001 ? launchVelocity[2] / length : 1;
      const speed = Math.max(0, length);
      shellDirectionRef.current = { x: directionX, z: directionZ };
      shellSpeedRef.current = speed;
      shellBounceCountRef.current = 0;
      shellLastBounceColliderHandleRef.current = null;
      shellLastBounceAtMsRef.current = 0;
      body.setLinvel(
        {
          x: directionX * speed,
          y: launchVelocity[1],
          z: directionZ * speed,
        },
        true,
      );
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (behavior === 'bomb') {
      bombPhaseRef.current = 'flying';
      body.setLinvel(
        {
          x: launchVelocity[0],
          y: launchVelocity[1],
          z: launchVelocity[2],
        },
        true,
      );
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    body.setLinvel(
      {
        x: launchVelocity[0],
        y: launchVelocity[1],
        z: launchVelocity[2],
      },
      true,
    );
  }, [behavior, launchVelocity]);

  useBeforePhysicsStep(() => {
    if (
      behavior !== 'green-shell' &&
      behavior !== 'red-shell' &&
      behavior !== 'blue-shell'
    ) {
      return;
    }
    if (expiredRef.current || !projectileActiveRef.current) return;

    const body = bodyRef.current;
    if (!body) return;

    const speed = shellSpeedRef.current;
    const currentVelocity = body.linvel();
    const translation = body.translation();
    const position: Vec3 = [translation.x, translation.y, translation.z];

    if (behavior === 'red-shell') {
      const desiredDirection = resolveRedShellDirection?.(position, ownerParticipantId);
      if (desiredDirection) {
        const desiredLength = Math.hypot(desiredDirection.x, desiredDirection.z);
        if (desiredLength > 0.0001) {
          const normalizedDesiredX = desiredDirection.x / desiredLength;
          const normalizedDesiredZ = desiredDirection.z / desiredLength;
          const currentDirection = shellDirectionRef.current;
          const currentAngle = Math.atan2(currentDirection.x, currentDirection.z);
          const targetAngle = Math.atan2(normalizedDesiredX, normalizedDesiredZ);
          const maxTurn = RED_SHELL_TURN_RATE_RAD_PER_SEC * Math.min(world.timestep, 0.05);
          const delta = normalizeAngle(targetAngle - currentAngle);
          const clampedDelta = Math.max(-maxTurn, Math.min(maxTurn, delta));
          const nextAngle = currentAngle + clampedDelta;
          shellDirectionRef.current = {
            x: Math.sin(nextAngle),
            z: Math.cos(nextAngle),
          };
        }
      }

      const direction = shellDirectionRef.current;
      body.setLinvel(
        {
          x: direction.x * speed,
          y: Math.max(-12, Math.min(6, currentVelocity.y)),
          z: direction.z * speed,
        },
        true,
      );
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (behavior === 'blue-shell') {
      const targetParticipantId =
        resolveBlueShellTargetParticipantId?.(ownerParticipantId) ?? null;
      const targetPose =
        targetParticipantId ? (resolveParticipantPose?.(targetParticipantId) ?? null) : null;

      if (targetPose) {
        const dx = targetPose.x - position[0];
        const dy = targetPose.y - position[1];
        const dz = targetPose.z - position[2];
        const horizontalDistance = Math.hypot(dx, dz);
        const distanceToTarget = Math.hypot(dx, dy, dz);

        if (
          blueShellPhaseRef.current === 'ground' &&
          distanceToTarget <= BLUE_SHELL_ASCEND_TRIGGER_DISTANCE
        ) {
          blueShellPhaseRef.current = 'aerial-chase';
        }

        if (blueShellPhaseRef.current === 'aerial-chase') {
          const hoverTargetY = targetPose.y + BLUE_SHELL_HOVER_HEIGHT;
          const desiredDirection = normalizePlanarDirection(dx, dz);
          if (desiredDirection) {
            shellDirectionRef.current = desiredDirection;
          }

          if (
            horizontalDistance <= BLUE_SHELL_DIVE_TRIGGER_DISTANCE &&
            position[1] >= hoverTargetY - 1.5
          ) {
            blueShellPhaseRef.current = 'dive';
          } else {
            body.setLinvel(
              {
                x: shellDirectionRef.current.x * speed,
                y: Math.max(
                  -4,
                  Math.min(BLUE_SHELL_ASCEND_SPEED, (hoverTargetY - position[1]) * 1.6),
                ),
                z: shellDirectionRef.current.z * speed,
              },
              true,
            );
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            return;
          }
        }

        if (blueShellPhaseRef.current === 'dive') {
          const impactTargetY = targetPose.y + 1;
          const toTargetX = dx;
          const toTargetY = impactTargetY - position[1];
          const toTargetZ = dz;
          const distanceToImpact = Math.hypot(toTargetX, toTargetY, toTargetZ);

          if (distanceToImpact <= BLUE_SHELL_IMPACT_DISTANCE) {
            registerParticipantHit(targetParticipantId);
            triggerBlueShellExplosion(position);
            return;
          }

          if (distanceToImpact > 0.0001) {
            const velocityScale = BLUE_SHELL_DIVE_SPEED / distanceToImpact;
            body.setLinvel(
              {
                x: toTargetX * velocityScale,
                y: toTargetY * velocityScale,
                z: toTargetZ * velocityScale,
              },
              true,
            );
            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
          return;
        }
      }

      const desiredDirection = resolveBlueShellGroundDirection?.(
        position,
        ownerParticipantId,
        targetParticipantId,
      );
      if (desiredDirection) {
        const normalizedDirection = normalizePlanarDirection(
          desiredDirection.x,
          desiredDirection.z,
        );
        if (normalizedDirection) {
          shellDirectionRef.current = normalizedDirection;
        }
      }

      body.setLinvel(
        {
          x: shellDirectionRef.current.x * speed,
          y: Math.max(-12, Math.min(8, currentVelocity.y)),
          z: shellDirectionRef.current.z * speed,
        },
        true,
      );
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    const direction = shellDirectionRef.current;
    body.setLinvel(
      {
        x: direction.x * speed,
        y: Math.max(-12, Math.min(6, currentVelocity.y)),
        z: direction.z * speed,
      },
      true,
    );
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  const handleBananaFlyingCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'banana') return;
    if (bananaPhaseRef.current !== 'flying') return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) return;

    const body = bodyRef.current;
    if (!body) return;

    const translation = body.translation();
    bananaPhaseRef.current = 'grounded';
    setGroundedBananaPosition([translation.x, translation.y, translation.z]);
  };

  const handleBananaGroundedIntersectionEnter = (payload: IntersectionEnterPayload) => {
    if (behavior !== 'banana') return;
    if (bananaPhaseRef.current !== 'grounded') return;
    if (expiredRef.current) return;

    const participantId = resolveParticipantIdFromIntersectionPayload(payload);
    if (!participantId) return;

    onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
    resolveAndExpire();
  };

  const handleGreenShellCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'green-shell') return;
    if (expiredRef.current || !projectileActiveRef.current) return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) {
      if (
        participantId === ownerParticipantId &&
        performance.now() - shellSpawnAtMsRef.current < SHELL_OWNER_IMMUNITY_MS
      ) {
        return;
      }
      onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
      resolveAndExpire();
      return;
    }

    const collisionNormal = resolveCollisionNormal(payload);
    if (Math.abs(collisionNormal.y) > SHELL_WALL_NORMAL_MAX_Y) return;

    const normalPlanarLength = Math.hypot(collisionNormal.x, collisionNormal.z);
    if (normalPlanarLength <= 0.0001) return;

    const wallNormalX = collisionNormal.x / normalPlanarLength;
    const wallNormalZ = collisionNormal.z / normalPlanarLength;
    const currentDirection = shellDirectionRef.current;
    const dot = currentDirection.x * wallNormalX + currentDirection.z * wallNormalZ;
    if (Math.abs(dot) < 0.2) return;

    const reflectedX = currentDirection.x - 2 * dot * wallNormalX;
    const reflectedZ = currentDirection.z - 2 * dot * wallNormalZ;
    const reflectedLength = Math.hypot(reflectedX, reflectedZ);
    if (reflectedLength <= 0.0001) return;

    const otherColliderHandle = payload.other.collider.handle;
    const nowMs = performance.now();
    const repeatedBounceOnSameWall =
      shellLastBounceColliderHandleRef.current === otherColliderHandle &&
      nowMs - shellLastBounceAtMsRef.current <= SHELL_BOUNCE_REPEAT_COOLDOWN_MS;
    if (repeatedBounceOnSameWall) return;

    const nextDirectionX = reflectedX / reflectedLength;
    const nextDirectionZ = reflectedZ / reflectedLength;
    shellDirectionRef.current = {
      x: nextDirectionX,
      z: nextDirectionZ,
    };
    shellLastBounceColliderHandleRef.current = otherColliderHandle;
    shellLastBounceAtMsRef.current = nowMs;
    shellBounceCountRef.current += 1;

    if (shellBounceCountRef.current >= SHELL_MAX_BOUNCES) {
      resolveAndExpire();
      return;
    }

    const body = bodyRef.current;
    if (!body) return;
    const speed = shellSpeedRef.current;
    body.setLinvel(
      {
        x: nextDirectionX * speed,
        y: Math.max(-6, Math.min(2, body.linvel().y)),
        z: nextDirectionZ * speed,
      },
      true,
    );
  };

  const handleRedShellCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'red-shell') return;
    if (expiredRef.current || !projectileActiveRef.current) return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) {
      if (
        participantId === ownerParticipantId &&
        performance.now() - shellSpawnAtMsRef.current < SHELL_OWNER_IMMUNITY_MS
      ) {
        return;
      }
      onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
      resolveAndExpire();
      return;
    }

    const collisionNormal = resolveCollisionNormal(payload);
    if (Math.abs(collisionNormal.y) > SHELL_WALL_NORMAL_MAX_Y) return;

    const normalPlanarLength = Math.hypot(collisionNormal.x, collisionNormal.z);
    if (normalPlanarLength <= 0.0001) return;

    const wallNormalX = collisionNormal.x / normalPlanarLength;
    const wallNormalZ = collisionNormal.z / normalPlanarLength;
    const direction = shellDirectionRef.current;
    const impactDot = direction.x * wallNormalX + direction.z * wallNormalZ;
    if (Math.abs(impactDot) < 0.2) return;

    resolveAndExpire();
  };

  const handleBlueShellCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'blue-shell') return;
    if (expiredRef.current || !projectileActiveRef.current) return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) {
      const targetParticipantId =
        resolveBlueShellTargetParticipantId?.(ownerParticipantId) ?? null;
      if (
        participantId === ownerParticipantId &&
        performance.now() - shellSpawnAtMsRef.current < SHELL_OWNER_IMMUNITY_MS
      ) {
        return;
      }
      if (targetParticipantId !== null && participantId !== targetParticipantId) {
        return;
      }

      registerParticipantHit(participantId);
      const body = bodyRef.current;
      if (!body) return;
      const translation = body.translation();
      triggerBlueShellExplosion([translation.x, translation.y, translation.z]);
      return;
    }

    if (blueShellPhaseRef.current !== 'dive') return;

    const body = bodyRef.current;
    if (!body) return;
    const translation = body.translation();
    triggerBlueShellExplosion([translation.x, translation.y, translation.z]);
  };

  const handleBombCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'bomb') return;
    if (expiredRef.current || !projectileActiveRef.current) return;

    const body = bodyRef.current;
    if (!body) return;

    const translation = body.translation();
    const bombPosition: Vec3 = [translation.x, translation.y, translation.z];
    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) {
      registerParticipantHit(participantId);
      triggerBombExplosion(bombPosition);
      return;
    }

    if (bombPhaseRef.current !== 'flying') return;
    bombPhaseRef.current = 'grounded';
    setGroundedBombPosition(bombPosition);
  };

  const handleBombGroundedIntersectionEnter = (payload: IntersectionEnterPayload) => {
    if (behavior !== 'bomb') return;
    if (bombPhaseRef.current !== 'grounded') return;
    if (expiredRef.current || !projectileActiveRef.current) return;

    const participantId = resolveParticipantIdFromIntersectionPayload(payload);
    if (!participantId) return;

    registerParticipantHit(participantId);
    const explosionPosition = groundedBombPosition ?? spawnPosition;
    triggerBombExplosion(explosionPosition);
  };

  const handleExplosionIntersectionEnter = (payload: IntersectionEnterPayload) => {
    if (!explosionState || expiredRef.current) return;

    const participantId = resolveParticipantIdFromIntersectionPayload(payload);
    if (!participantId) return;

    registerParticipantHit(participantId);
  };

  if (groundedBananaPosition) {
    return (
      <RigidBody type="fixed" colliders={false} position={groundedBananaPosition}>
        <CuboidCollider
          sensor
          args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
          activeCollisionTypes={activeCollisionTypes}
          onIntersectionEnter={handleBananaGroundedIntersectionEnter}
        />
        <Model src={modelPath} />
      </RigidBody>
    );
  }

  if (explosionState) {
    return (
      <RigidBody type="fixed" colliders={false} position={explosionState.position}>
        <BallCollider
          sensor
          args={[explosionState.radius]}
          activeCollisionTypes={activeCollisionTypes}
          onIntersectionEnter={handleExplosionIntersectionEnter}
        />
        <mesh>
          <sphereGeometry args={[explosionState.radius, 28, 28]} />
          <meshStandardMaterial
            color={explosionState.color}
            emissive={explosionState.emissive}
            emissiveIntensity={0.8}
            transparent
            opacity={0.5}
            depthWrite={false}
          />
        </mesh>
      </RigidBody>
    );
  }

  if (groundedBombPosition) {
    return (
      <RigidBody type="fixed" colliders={false} position={groundedBombPosition}>
        <CuboidCollider
          sensor
          args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
          activeCollisionTypes={activeCollisionTypes}
          onIntersectionEnter={handleBombGroundedIntersectionEnter}
        />
        <Model src={modelPath} />
      </RigidBody>
    );
  }

  if (
    behavior === 'green-shell' ||
    behavior === 'red-shell' ||
    behavior === 'blue-shell' ||
    behavior === 'bomb'
  ) {
    return (
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={spawnPosition}
        canSleep={false}
        linearDamping={behavior === 'bomb' ? 0.05 : 0}
        angularDamping={behavior === 'bomb' ? 2 : 5}
        enabledRotations={[false, false, false]}
      >
        <CuboidCollider
          args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
          restitution={0}
          friction={behavior === 'bomb' ? 0.25 : 0}
          activeCollisionTypes={activeCollisionTypes}
          onCollisionEnter={
            behavior === 'green-shell' ?
              handleGreenShellCollisionEnter
            : behavior === 'red-shell' ?
              handleRedShellCollisionEnter
            : behavior === 'blue-shell' ?
              handleBlueShellCollisionEnter
            : handleBombCollisionEnter
          }
        />
        <Model src={modelPath} />
      </RigidBody>
    );
  }

  return (
    <RigidBody ref={bodyRef} type="dynamic" colliders={false} position={spawnPosition}>
      <CuboidCollider
        args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
        restitution={0}
        friction={0.4}
        activeCollisionTypes={activeCollisionTypes}
        onCollisionEnter={handleBananaFlyingCollisionEnter}
      />
      <Model src={modelPath} />
    </RigidBody>
  );
}
