import { useRef, useEffect, ReactNode } from 'react';
import { RigidBody, RigidBodyProps, type RapierRigidBody } from '@react-three/rapier';
import {
  registerBodyDrag,
  registerColliderDrag,
  unregisterBodyDrag,
  unregisterColliderDrag,
} from '../state/dragRegistry';
import {
  registerSurfaceTrigger,
  type SurfaceTriggerType,
  unregisterSurfaceTrigger,
} from '../state/surfaceTriggerRegistry';

type SurfaceWithDragProps = RigidBodyProps & {
  drag: number;
  children: ReactNode;
  surfaceTriggerType?: SurfaceTriggerType;
  surfaceAttachmentKind?: 'road' | 'ext';
};

export function SurfaceWithDrag({
  drag,
  children,
  surfaceTriggerType,
  surfaceAttachmentKind,
  ...rigidBodyProps
}: SurfaceWithDragProps) {
  const ref = useRef<RapierRigidBody | null>(null);

  useEffect(() => {
    let timerId: number | null = null;
    let attemptCount = 0;
    let stableAttemptCount = 0;
    let lastObservedColliderCount = -1;
    let registeredBodyHandle: number | null = null;
    const registeredColliderHandles = new Set<number>();
    const registeredSurfaceTriggerHandles = new Set<number>();
    const MAX_REGISTRATION_ATTEMPTS = 40;
    const REQUIRED_STABLE_ATTEMPTS = 3;
    const REGISTRATION_RETRY_MS = 40;

    const isValidHandle = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0;

    const resolveHandle = (target: unknown) => {
      if (!target || (typeof target !== 'object' && typeof target !== 'function')) return null;

      const directHandle = (target as any).handle;
      if (isValidHandle(directHandle)) return directHandle;

      if (typeof directHandle === 'function') {
        try {
          const computed = directHandle.call(target);
          if (isValidHandle(computed)) return computed;
        } catch {
          // Ignore handle-read failures and keep fallback path.
        }
      }

      return null;
    };

    const syncRegistration = () => {
      const body = ref.current;
      if (!body) return 0;

      const existingUserData = body.userData;
      if (existingUserData && typeof existingUserData === 'object') {
        body.userData = {
          ...(existingUserData as Record<string, unknown>),
          surfaceDrag: drag,
          surfaceTriggerType,
          surfaceAttachmentKind,
        };
      } else {
        body.userData = { surfaceDrag: drag, surfaceTriggerType, surfaceAttachmentKind };
      }

      const bodyHandle = resolveHandle(body);
      if (bodyHandle !== null) {
        if (registeredBodyHandle !== null && registeredBodyHandle !== bodyHandle) {
          unregisterBodyDrag(registeredBodyHandle);
        }
        registerBodyDrag(bodyHandle, drag);
        registeredBodyHandle = bodyHandle;
      }

      if (typeof body.numColliders !== 'function' || typeof body.collider !== 'function') return 0;

      const colliderCount = body.numColliders();
      for (let i = 0; i < colliderCount; i += 1) {
        const collider = body.collider(i);
        const colliderHandle = resolveHandle(collider);
        if (colliderHandle === null) continue;

        const colliderUserData = (collider as any).userData;
        if (colliderUserData && typeof colliderUserData === 'object') {
          (collider as any).userData = {
            ...(colliderUserData as Record<string, unknown>),
            surfaceDrag: drag,
            surfaceTriggerType,
            surfaceAttachmentKind,
          };
        } else {
          (collider as any).userData = { surfaceDrag: drag, surfaceTriggerType, surfaceAttachmentKind };
        }

        if (surfaceTriggerType) {
          registerSurfaceTrigger(colliderHandle, surfaceTriggerType);
          registeredSurfaceTriggerHandles.add(colliderHandle);
        }

        registerColliderDrag(colliderHandle, drag);
        registeredColliderHandles.add(colliderHandle);
      }

      return colliderCount;
    };

    const tick = () => {
      const colliderCount = syncRegistration();
      attemptCount += 1;

      const registrationCaughtUp = colliderCount > 0 && registeredColliderHandles.size >= colliderCount;
      if (registrationCaughtUp && colliderCount === lastObservedColliderCount) stableAttemptCount += 1;
      else stableAttemptCount = 0;

      lastObservedColliderCount = colliderCount;

      const registrationComplete =
        registeredBodyHandle !== null &&
        registrationCaughtUp &&
        stableAttemptCount >= REQUIRED_STABLE_ATTEMPTS;
      const shouldKeepTrying = attemptCount < MAX_REGISTRATION_ATTEMPTS && !registrationComplete;

      if (shouldKeepTrying) {
        timerId = window.setTimeout(tick, REGISTRATION_RETRY_MS);
      }
    };

    tick();

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      if (registeredBodyHandle !== null) unregisterBodyDrag(registeredBodyHandle);
      registeredColliderHandles.forEach((handle) => unregisterColliderDrag(handle));
      registeredSurfaceTriggerHandles.forEach((handle) => unregisterSurfaceTrigger(handle));
    };
  }, [drag, surfaceAttachmentKind, surfaceTriggerType]);

  return (
    <RigidBody ref={ref} {...rigidBodyProps}>
      {children}
    </RigidBody>
  );
}
