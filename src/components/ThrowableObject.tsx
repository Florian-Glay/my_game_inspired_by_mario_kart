import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type CollisionEnterPayload,
  type IntersectionEnterPayload,
  type RapierRigidBody,
} from '@react-three/rapier';
import type { RaceParticipantId, Vec3 } from '../types/game';
import Model from './Model';

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_COLLIDER_HALF_EXTENTS: Vec3 = [0.62, 0.62, 0.62];
const SHELL_MAX_BOUNCES = 4;
const SHELL_WALL_NORMAL_MAX_Y = 0.65;
const SHELL_BOUNCE_REPEAT_COOLDOWN_MS = 90;

export type ThrowableObjectBehavior = 'banana' | 'green-shell';

export type ThrowableObjectProps = {
  throwableId: string;
  sourceObjectValue: number;
  ownerParticipantId: RaceParticipantId;
  behavior?: ThrowableObjectBehavior;
  modelPath: string;
  spawnPosition: Vec3;
  launchVelocity: Vec3;
  ttlMs?: number;
  colliderHalfExtents?: Vec3;
  onExpired: (throwableId: string) => void;
  onGroundedParticipantHit: (
    throwableId: string,
    participantId: RaceParticipantId,
    sourceObjectValue: number,
  ) => void;
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

export function ThrowableObject({
  throwableId,
  sourceObjectValue,
  ownerParticipantId,
  behavior = 'banana',
  modelPath,
  spawnPosition,
  launchVelocity,
  ttlMs = DEFAULT_TTL_MS,
  colliderHalfExtents = DEFAULT_COLLIDER_HALF_EXTENTS,
  onExpired,
  onGroundedParticipantHit,
}: ThrowableObjectProps) {
  const { rapier } = useRapier();
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const phaseRef = useRef<'flying' | 'grounded'>('flying');
  const removedRef = useRef(false);
  const [groundedPosition, setGroundedPosition] = useState<Vec3 | null>(null);
  const shellDirectionRef = useRef<{ x: number; z: number }>({ x: 0, z: 1 });
  const shellSpeedRef = useRef(0);
  const shellBounceCountRef = useRef(0);
  const shellLastBounceColliderHandleRef = useRef<number | null>(null);
  const shellLastBounceAtMsRef = useRef(0);
  const resolvedTtlMs = useMemo(
    () => Math.max(100, Math.floor(Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS)),
    [ttlMs],
  );
  const activeCollisionTypes = useMemo(
    () =>
      rapier.ActiveCollisionTypes.DEFAULT |
      rapier.ActiveCollisionTypes.KINEMATIC_FIXED |
      rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
    [rapier],
  );

  const resolveAndExpire = () => {
    if (removedRef.current) return;
    removedRef.current = true;
    onExpired(throwableId);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      resolveAndExpire();
    }, resolvedTtlMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [resolvedTtlMs, throwableId, onExpired]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    if (behavior === 'green-shell') {
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
          y: 0,
          z: directionZ * speed,
        },
        true,
      );
      body.setAngvel(
        {
          x: 0,
          y: 0,
          z: 0,
        },
        true,
      );
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
    if (behavior !== 'green-shell') return;
    if (removedRef.current) return;

    const body = bodyRef.current;
    if (!body) return;

    const speed = shellSpeedRef.current;
    const direction = shellDirectionRef.current;
    const currentVelocity = body.linvel();
    const constrainedVerticalVelocity = Math.max(-6, Math.min(2, currentVelocity.y));

    body.setLinvel(
      {
        x: direction.x * speed,
        y: constrainedVerticalVelocity,
        z: direction.z * speed,
      },
      true,
    );
    body.setAngvel(
      {
        x: 0,
        y: 0,
        z: 0,
      },
      true,
    );
  });

  const handleFlyingCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'banana') return;
    if (phaseRef.current !== 'flying') return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) return;

    const body = bodyRef.current;
    if (!body) return;

    const translation = body.translation();
    phaseRef.current = 'grounded';
    setGroundedPosition([translation.x, translation.y, translation.z]);
  };

  const handleGreenShellCollisionEnter = (payload: CollisionEnterPayload) => {
    if (behavior !== 'green-shell') return;
    if (removedRef.current) return;

    const participantId = resolveParticipantIdFromCollisionPayload(payload);
    if (participantId) {
      onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
      resolveAndExpire();
      return;
    }

    const rawNormal = payload.manifold.normal();
    const normalX = payload.flipped ? -rawNormal.x : rawNormal.x;
    const normalY = payload.flipped ? -rawNormal.y : rawNormal.y;
    const normalZ = payload.flipped ? -rawNormal.z : rawNormal.z;
    if (Math.abs(normalY) > SHELL_WALL_NORMAL_MAX_Y) return;

    const normalPlanarLength = Math.hypot(normalX, normalZ);
    if (normalPlanarLength <= 0.0001) return;

    const wallNormalX = normalX / normalPlanarLength;
    const wallNormalZ = normalZ / normalPlanarLength;
    const currentDirection = shellDirectionRef.current;
    const dot = currentDirection.x * wallNormalX + currentDirection.z * wallNormalZ;
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

  const handleGroundedIntersectionEnter = (payload: IntersectionEnterPayload) => {
    if (behavior !== 'banana') return;
    if (phaseRef.current !== 'grounded') return;
    if (removedRef.current) return;

    const participantId = resolveParticipantIdFromIntersectionPayload(payload);
    if (!participantId) return;
    if (participantId === ownerParticipantId) {
      // Le proprietaire peut aussi declencher son propre objet.
    }

    onGroundedParticipantHit(throwableId, participantId, sourceObjectValue);
    resolveAndExpire();
  };

  if (behavior === 'banana' && groundedPosition) {
    return (
      <RigidBody type="fixed" colliders={false} position={groundedPosition}>
        <CuboidCollider
          sensor
          args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
          activeCollisionTypes={activeCollisionTypes}
          onIntersectionEnter={handleGroundedIntersectionEnter}
        />
        <Model src={modelPath} />
      </RigidBody>
    );
  }

  if (behavior === 'green-shell') {
    return (
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        position={spawnPosition}
        canSleep={false}
        linearDamping={0}
        angularDamping={5}
        enabledRotations={[false, false, false]}
      >
        <CuboidCollider
          args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
          restitution={0}
          friction={0}
          activeCollisionTypes={activeCollisionTypes}
          onCollisionEnter={handleGreenShellCollisionEnter}
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
        onCollisionEnter={handleFlyingCollisionEnter}
      />
      <Model src={modelPath} />
    </RigidBody>
  );
}
