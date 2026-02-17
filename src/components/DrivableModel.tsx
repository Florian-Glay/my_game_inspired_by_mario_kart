import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Group } from 'three';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import {
  type CollisionEnterPayload,
  RigidBody,
  RoundCuboidCollider,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
  type CollisionPayload,
  type IntersectionEnterPayload,
  type IntersectionExitPayload,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import { PERF_PROFILE } from '../config/performanceProfile';
import { getBodyDrag, getColliderDrag, hasBodyDrag, hasColliderDrag } from '../state/dragRegistry';
import { carPosition, carRotationY } from '../state/car';
import { commandInputActive } from '../state/commandInput';
import { gameMode } from '../state/gamemode';
import { getSurfaceTriggerType } from '../state/surfaceTriggerRegistry';
import type { CarPose, KeyBindings, PlayerId } from '../types/game';

type Vec3 = [number, number, number];
type RapierVec = { x: number; y: number; z: number };
type GroundHit = { collider: RapierCollider; normal: RapierVec };
type AttachmentSurfaceKind = 'road' | 'ext';
type GroundHitOptions = {
  filter?: (candidate: RapierCollider) => boolean;
  preferredUp?: Vector3;
  minNormalDot?: number;
  maxRetries?: number;
  fallbackToFirstHit?: boolean;
};

type SurfaceAttachmentConfig = {
  enabled?: boolean;
  maxAttachAngleDeg?: number;
  probeDistance?: number;
  stickForce?: number;
  maxSlopeClimbAngleDeg?: number;
  detachGraceMs?: number;
  allowedSurfaces?: 'road-ext' | 'all' | 'by-circuit';
  loopSlopeClimbAngleDeg?: number;
  loopSlopeSlideAngleDeg?: number;
};

type BoosterConfig = {
  model?: string;
  duration?: number;
  strength?: number;
};

type Props = {
  vehicleModel: string;
  characterModel: string;
  wheelModel: string;
  position?: Vec3;
  rotation?: Vec3;
  vehicleScale?: number | Vec3;
  characterScale?: number | Vec3;
  wheelScale?: number | Vec3;
  characterMount?: Vec3;
  wheelMounts?: [Vec3, Vec3, Vec3, Vec3];
  chassisLift?: number;
  driverLift?: number;
  // Linear damping factor applied per second (0 = no extra drag). Typical small values like 0.5
  // will cause gradual speed loss; larger values brake faster.
  drag?: number;
  keyBindings?: KeyBindings;
  maxForward?: number;
  maxBackward?: number;
  onPoseUpdate?: (playerId: PlayerId, pose: CarPose) => void;
  playerId?: PlayerId;
  surfaceAttachment?: SurfaceAttachmentConfig;
  antiGravSwitchesEnabled?: boolean;
  booster?: BoosterConfig;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep01 = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const SHRINK_X = 0.6;
const SHRINK_Y = 0.4;
const SHRINK_Z = 0.6;

const SPAWN_CLEARANCE = 0.05;

// Controller tuning (units ~= meters/seconds if your scene scale is realistic)
const MAX_FWD = 40;
const MAX_BACK = 25;
const ACCEL = 20;
const COAST = 15;
const MAX_YAW_RATE = 1.5; // rad/s
const MAX_CLIMB_ANGLE_DEG = 60;
// Let the car pass small mesh bumps/steps and only block on higher obstacles.
const AUTO_STEP_HEIGHT_RATIO = 0.5;
const AUTO_STEP_HEIGHT_MIN = 0.08;
// Keep enough headroom for larger colliders (normal-scale assets) to still step over small ledges.
const AUTO_STEP_HEIGHT_MAX = 1.2;
const AUTO_STEP_MIN_WIDTH_RATIO = 0.35;
const AUTO_STEP_MIN_WIDTH_MIN = 0.08;
// 0..1: 0 = no tilt (always upright), 1 = full tilt to ground normal
const GROUND_TILT_FACTOR = 1;
// Stabilize triangle-to-triangle ground normal noise on mesh roads.
const GROUND_NORMAL_SMOOTHING = 22;
const GROUND_NORMAL_DEADZONE_DOT = Math.cos((1.2 * Math.PI) / 180);
// Rotation smoothing (higher = snappier, lower = smoother). Used as a rate in an
// exponential smoothing function to compute an interpolation alpha per-step.
const ROTATION_SMOOTHING = 20;
const GRAVITY_ACCEL = 19.81;
const GROUND_RAY_EXTRA_DISTANCE = 4.0;
const GROUND_RAY_START_MARGIN = 0.3;
// Global visual Y offset relative to the collider.
// Keep this at 0 so collider-ground contact and visual mesh stay aligned by default.
const MODEL_Y_OFFSET = 0;
// Visual-only smoothing to avoid abrupt "step pop" when autostep lifts the collider.
const VISUAL_STEP_SMOOTHING_UP = 24;
const VISUAL_STEP_SMOOTHING_DOWN = 30;
const VISUAL_STEP_MAX_LAG = 0.12;
// If the hit normal diverges too much from the current attached normal, treat this as a lateral wall.
const WALL_COLLISION_ALIGN_DOT = Math.cos((88 * Math.PI) / 180);
// In wall-guard mode keep loop slopes below vertical so side walls remain collisions.
const WALL_GUARD_MAX_CLIMB_ANGLE_DEG = 86;
const WALL_GUARD_SLIDE_MARGIN_DEG = 4;
const MAX_GROUND_RAY_RETRIES = 6;
// When the car is significantly tilted, keep slope checks relative to the current car up-vector.
const LOOPING_REFERENCE_WORLD_DOT = 0.96;
// While detached during looping, allow a wider re-attach cone based on current car orientation.
const LOOPING_DETACHED_REATTACH_DOT = Math.cos((150 * Math.PI) / 180);
// Keep using the loop reference for a short time after contact loss to avoid instant auto-upright.
const LOOPING_DETACH_HOLD_MS = 450;
const ROAD_RESCUE_MAX_DISTANCE = 120;
const ROAD_DISTANCE_QUERY_MAX = 220;
const ROAD_RESCUE_DURATION_MS = 3000;
const ROAD_RESCUE_HOVER_PHASE = 0.65;
const ROAD_RESCUE_LIFT_HEIGHT = 10;
const LAKITU_BASE_SCALE = 1;
const LAKITU_FADE_IN_SECONDS = 0.35;
const LAKITU_FADE_OUT_SECONDS = 0.35;
const LAKITU_FOLLOW_OFFSET_Y = 3;
const LAKITU_POSITION_SMOOTHING = 12;
const ROAD_DISTANCE_QUERY_DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, -1, 0],
  [-1, -1, 0],
  [0, -1, 1],
  [0, -1, -1],
  [1, 0, 1],
  [1, 0, -1],
  [-1, 0, 1],
  [-1, 0, -1],
];

const DEFAULT_KEY_BINDINGS: KeyBindings = {
  forward: ['z', 'w', 'arrowup'],
  back: ['s', 'arrowdown'],
  left: ['q', 'a', 'arrowleft'],
  right: ['d', 'arrowright'],
};

const DEFAULT_CHARACTER_MOUNT: Vec3 = [0, 0.5, 0];
const DEFAULT_WHEEL_MOUNTS: [Vec3, Vec3, Vec3, Vec3] = [
  [-0.92, 0.04, 1.14],
  [0.92, 0.04, 1.14],
  [-0.92, 0.04, -1.14],
  [0.92, 0.04, -1.14],
];

const getWheelRotationForMount = (mount: Vec3): Vec3 =>
  mount[0] > 0 ? [0, Math.PI, 0] : [0, 0, 0];

const DEFAULT_SURFACE_ATTACHMENT: Required<SurfaceAttachmentConfig> = {
  enabled: false,
  maxAttachAngleDeg: 85,
  probeDistance: 6,
  stickForce: 26,
  maxSlopeClimbAngleDeg: 60,
  detachGraceMs: 120,
  allowedSurfaces: 'road-ext',
  loopSlopeClimbAngleDeg: 165,
  loopSlopeSlideAngleDeg: 172,
};

const DEFAULT_BOOSTER: Required<Pick<BoosterConfig, 'duration' | 'strength'>> = {
  duration: 1,
  strength: 2,
};
const BOOSTER_RETRIGGER_COOLDOWN_MS = 150;

const ROAD_SURFACE_RE = /(?:^|[-_])road(?:[-_]|$)/i;
const EXT_SURFACE_RE = /(?:^|[-_])ext(?:[-_]|$)/i;
const ANTI_GRAV_IN_SURFACE_RE = /anti[-_ ]?grav[-_ ]?in/i;
const ANTI_GRAV_OUT_SURFACE_RE = /anti[-_ ]?grav[-_ ]?out/i;
const BOOSTER_SURFACE_RE = /booster/i;

const SHOULD_LOG_GROUND_CONTACT = PERF_PROFILE.debugGroundContact && import.meta.env.DEV;

export default function DrivableModel({
  vehicleModel,
  characterModel,
  wheelModel,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  vehicleScale = [1, 1, 1],
  characterScale = [1, 1, 1],
  wheelScale = [1, 1, 1],
  characterMount = DEFAULT_CHARACTER_MOUNT,
  wheelMounts = DEFAULT_WHEEL_MOUNTS,
  chassisLift = 0,
  driverLift = 0,
  drag = 0,
  keyBindings = DEFAULT_KEY_BINDINGS,
  maxForward = MAX_FWD,
  maxBackward = MAX_BACK,
  onPoseUpdate,
  playerId = 'p1',
  surfaceAttachment,
  antiGravSwitchesEnabled = false,
  booster,
}: Props) {
  const { rapier, world, colliderStates, rigidBodyStates } = useRapier();
  type KinematicController = InstanceType<(typeof rapier)['KinematicCharacterController']>;

  const { scene: vehicleScene } = useGLTF(vehicleModel) as unknown as { scene: Group };
  const { scene: characterScene } = useGLTF(characterModel) as unknown as { scene: Group };
  const { scene: wheelScene } = useGLTF(wheelModel) as unknown as { scene: Group };
  const { scene: lakituScene } = useGLTF('/models/lakitu.glb') as unknown as { scene: Group };
  const vehicleCloned = useMemo(() => SkeletonUtils.clone(vehicleScene) as Group, [vehicleScene]);
  const characterCloned = useMemo(
    () => SkeletonUtils.clone(characterScene) as Group,
    [characterScene],
  );
  const wheelClones = useMemo(
    () => Array.from({ length: 4 }, () => SkeletonUtils.clone(wheelScene) as Group),
    [wheelScene],
  );
  const lakituCloned = useMemo(() => SkeletonUtils.clone(lakituScene) as Group, [lakituScene]);
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const colliderRef = useRef<RapierCollider | null>(null);
  const controllerRef = useRef<KinematicController | null>(null);

  // keyboard state
  const keysRef = useRef({ forward: false, back: false, left: false, right: false });

  const bindingSets = useMemo(
    () => ({
      forward: new Set(keyBindings.forward.map((key) => key.toLowerCase())),
      back: new Set(keyBindings.back.map((key) => key.toLowerCase())),
      left: new Set(keyBindings.left.map((key) => key.toLowerCase())),
      right: new Set(keyBindings.right.map((key) => key.toLowerCase())),
    }),
    [keyBindings.back, keyBindings.forward, keyBindings.left, keyBindings.right],
  );

  // kinematic controller state
  const yawRef = useRef(0);
  const speedRef = useRef(0);
  // Positive value means movement toward the active down direction.
  const verticalVelRef = useRef(0);
  const headingRef = useRef(new Vector3(0, 0, 1));
  type AttachmentState = 'detached' | 'attached' | 'grace';
  const attachmentStateRef = useRef<AttachmentState>('detached');
  const lastAttachTimestampRef = useRef(0);
  const lastValidNormalRef = useRef(new Vector3(0, 1, 0));
  const antiGravEnabledRef = useRef(!antiGravSwitchesEnabled);
  const activeSurfaceTriggerZoneRef = useRef<'in' | 'out' | null>(null);
  const boostEndTimestampRef = useRef(0);
  const activeBoosterHandleRef = useRef<number | null>(null);
  const lastBoosterTriggerTimeRef = useRef(0);
  const lastGroundSurfaceKindRef = useRef<AttachmentSurfaceKind | null>(null);
  const hasLastRoadToExtPositionRef = useRef(false);
  const lastRoadToExtPositionRef = useRef(new Vector3());
  const hasLastRoadContactPositionRef = useRef(false);
  const lastRoadContactPositionRef = useRef(new Vector3());
  const rescueActiveRef = useRef(false);
  const rescueStartTimeRef = useRef(0);
  const rescueStartPosRef = useRef(new Vector3());
  const rescueHoverPosRef = useRef(new Vector3());
  const rescueTargetPosRef = useRef(new Vector3());
  const rescueStartQuatRef = useRef(new Quaternion());
  const lakituGroupRef = useRef<Group | null>(null);
  const visualRootRef = useRef<Group | null>(null);
  const lakituFadeRef = useRef(0);
  const lakituVisibleTargetRef = useRef(false);
  const lakituPositionTargetRef = useRef(new Vector3());
  const lakituInitializedRef = useRef(false);
  const smoothedVisualBodyYRef = useRef<number | null>(null);

  const vehicleScaleVec = useMemo<Vec3>(() => {
    if (Array.isArray(vehicleScale)) return vehicleScale;
    if (typeof vehicleScale === 'number') return [vehicleScale, vehicleScale, vehicleScale];
    return [1, 1, 1];
  }, [vehicleScale]);

  const colliderFit = useMemo(() => {
    const box = new Box3().setFromObject(vehicleCloned);

    const size = box.getSize(new Vector3());
    size.multiply(new Vector3(vehicleScaleVec[0], vehicleScaleVec[1], vehicleScaleVec[2]));

    const minYScaled = box.min.y * vehicleScaleVec[1];
    const centerScaled = box.getCenter(new Vector3());
    centerScaled.multiply(new Vector3(vehicleScaleVec[0], vehicleScaleVec[1], vehicleScaleVec[2]));

    const halfX = (size.x / 2) * SHRINK_X;
    const halfY = Math.max((size.y / 2) * SHRINK_Y, 0.05);
    const halfZ = (size.z / 2) * SHRINK_Z;

    const offsetX = centerScaled.x;
    const offsetY = minYScaled + halfY;
    const offsetZ = centerScaled.z;

    const borderRadius = Math.max(0.02, Math.min(halfX, halfY, halfZ) * 0.35);

    return {
      halfExtents: [halfX, halfY, halfZ] as Vec3,
      colliderOffset: [offsetX, offsetY, offsetZ] as Vec3,
      minYScaled,
      borderRadius,
    };
  }, [vehicleCloned, vehicleScaleVec[0], vehicleScaleVec[1], vehicleScaleVec[2]]);

  const surfaceAttachmentSettings = useMemo(() => {
    // Probe distance must cover:
    // - from body center to above the top of the collider (ray start),
    // - then from this start point down past the collider bottom and a safety margin.
    const fallbackProbeDistance = Math.max(
      DEFAULT_SURFACE_ATTACHMENT.probeDistance,
      colliderFit.halfExtents[1] * 2 + GROUND_RAY_START_MARGIN + GROUND_RAY_EXTRA_DISTANCE,
    );
    const loopSlopeClimbAngleDeg = clamp(
      surfaceAttachment?.loopSlopeClimbAngleDeg ??
        surfaceAttachment?.maxSlopeClimbAngleDeg ??
        DEFAULT_SURFACE_ATTACHMENT.loopSlopeClimbAngleDeg,
      60,
      175,
    );
    const requestedLoopSlide =
      surfaceAttachment?.loopSlopeSlideAngleDeg ?? DEFAULT_SURFACE_ATTACHMENT.loopSlopeSlideAngleDeg;
    return {
      enabled: surfaceAttachment?.enabled ?? DEFAULT_SURFACE_ATTACHMENT.enabled,
      maxAttachAngleDeg: clamp(
        surfaceAttachment?.maxAttachAngleDeg ?? DEFAULT_SURFACE_ATTACHMENT.maxAttachAngleDeg,
        10,
        175,
      ),
      probeDistance: Math.max(0.5, surfaceAttachment?.probeDistance ?? fallbackProbeDistance),
      stickForce: Math.max(0, surfaceAttachment?.stickForce ?? DEFAULT_SURFACE_ATTACHMENT.stickForce),
      maxSlopeClimbAngleDeg: clamp(
        surfaceAttachment?.maxSlopeClimbAngleDeg ?? DEFAULT_SURFACE_ATTACHMENT.maxSlopeClimbAngleDeg,
        10,
        175,
      ),
      detachGraceMs: Math.max(
        0,
        surfaceAttachment?.detachGraceMs ?? DEFAULT_SURFACE_ATTACHMENT.detachGraceMs,
      ),
      allowedSurfaces: (() => {
        const allowed = surfaceAttachment?.allowedSurfaces ?? DEFAULT_SURFACE_ATTACHMENT.allowedSurfaces;
        if (allowed === 'all' || allowed === 'by-circuit' || allowed === 'road-ext') return allowed;
        return DEFAULT_SURFACE_ATTACHMENT.allowedSurfaces;
      })(),
      loopSlopeClimbAngleDeg,
      loopSlopeSlideAngleDeg: clamp(requestedLoopSlide, loopSlopeClimbAngleDeg, 175),
    };
  }, [
    colliderFit.halfExtents,
    surfaceAttachment?.allowedSurfaces,
    surfaceAttachment?.detachGraceMs,
    surfaceAttachment?.enabled,
    surfaceAttachment?.loopSlopeClimbAngleDeg,
    surfaceAttachment?.loopSlopeSlideAngleDeg,
    surfaceAttachment?.maxAttachAngleDeg,
    surfaceAttachment?.maxSlopeClimbAngleDeg,
    surfaceAttachment?.probeDistance,
    surfaceAttachment?.stickForce,
  ]);

  const boosterSettings = useMemo(
    () => ({
      enabled: Boolean(booster?.model),
      durationMs: Math.max(100, (booster?.duration ?? DEFAULT_BOOSTER.duration) * 1000),
      strength: Math.max(1, booster?.strength ?? DEFAULT_BOOSTER.strength),
    }),
    [booster?.duration, booster?.model, booster?.strength],
  );

  const maxAttachDot = useMemo(
    () => Math.cos((surfaceAttachmentSettings.maxAttachAngleDeg * Math.PI) / 180),
    [surfaceAttachmentSettings.maxAttachAngleDeg],
  );

  const autostepSettings = useMemo(() => {
    const maxStepHeight = clamp(
      colliderFit.halfExtents[1] * AUTO_STEP_HEIGHT_RATIO,
      AUTO_STEP_HEIGHT_MIN,
      AUTO_STEP_HEIGHT_MAX,
    );
    const minStepWidth = Math.max(
      AUTO_STEP_MIN_WIDTH_MIN,
      Math.min(colliderFit.halfExtents[0], colliderFit.halfExtents[2]) * AUTO_STEP_MIN_WIDTH_RATIO,
    );
    return { maxStepHeight, minStepWidth };
  }, [colliderFit.halfExtents]);

  const spawnPosition = useMemo<Vec3>(() => {
    // Spawn so the chassis collider starts just above "ground level" (position.y).
    const spawnY = position[1] + colliderFit.halfExtents[1] + SPAWN_CLEARANCE + chassisLift;
    const spawnX = position[0];
    const spawnZ = position[2];
    return [spawnX, spawnY, spawnZ];
  }, [chassisLift, colliderFit.halfExtents, position]);

  const initialRotation = useMemo<Vec3>(() => rotation, [rotation]);

  const characterMountWithLift = useMemo<Vec3>(
    () => [characterMount[0], characterMount[1] + driverLift, characterMount[2]],
    [characterMount, driverLift],
  );

  const visualRootPosition = useMemo<Vec3>(
    () => [
      -colliderFit.colliderOffset[0],
      -colliderFit.colliderOffset[1] + MODEL_Y_OFFSET + chassisLift,
      -colliderFit.colliderOffset[2],
    ],
    [chassisLift, colliderFit.colliderOffset],
  );

  const effectiveWheelMounts = useMemo<[Vec3, Vec3, Vec3, Vec3]>(
    () => wheelMounts ?? DEFAULT_WHEEL_MOUNTS,
    [wheelMounts],
  );

  const wheelObjects = useMemo<[Group, Group, Group, Group]>(() => {
    const [a, b, c, d] = wheelClones;
    return [a, b, c, d];
  }, [wheelClones]);

  // temp objects to avoid allocations in the render loop
  const worldUp = useMemo(() => new Vector3(0, 1, 0), []);
  const tmpQuat = useMemo(() => new Quaternion(), []);
  const tmpForward = useMemo(() => new Vector3(), []);
  const tmpNormal = useMemo(() => new Vector3(), []);
  const tmpBasisRight = useMemo(() => new Vector3(), []);
  const tmpBasisFwd = useMemo(() => new Vector3(), []);
  const tmpProj = useMemo(() => new Vector3(), []);
  const tmpMtx = useMemo(() => new Matrix4(), []);
  const tmpMoveDelta = useMemo(() => new Vector3(), []);
  const tmpDownDir = useMemo(() => new Vector3(), []);
  const tmpRayOrigin = useMemo(() => new Vector3(), []);
  const tmpAttachmentNormal = useMemo(() => new Vector3(), []);
  const tmpBodyQuat = useMemo(() => new Quaternion(), []);
  const tmpPoseForward = useMemo(() => new Vector3(), []);
  const tmpPoseUp = useMemo(() => new Vector3(), []);
  const tmpDesiredUp = useMemo(() => new Vector3(), []);
  const tmpRescuePos = useMemo(() => new Vector3(), []);
  const rotRef = useRef(new Quaternion());
  const smoothedGroundNormalRef = useRef(new Vector3(0, 1, 0));
  const desiredDeltaRef = useRef<RapierVec>({ x: 0, y: 0, z: 0 });
  const nextTranslationRef = useRef<RapierVec>({ x: 0, y: 0, z: 0 });
  const tmpTranslationRef = useRef<RapierVec>({ x: 0, y: 0, z: 0 });
  const currentExtraDragRef = useRef(0);
  const lastGroundColliderHandleRef = useRef<number | null>(null);

  const groundRay = useMemo(() => {
    const origin = new rapier.Vector3(0, 0, 0);
    const dir = new rapier.Vector3(0, -1, 0);
    return new rapier.Ray(origin, dir);
  }, [rapier]);
  const controllerUpVec = useMemo(() => new rapier.Vector3(0, 1, 0), [rapier]);

  const rayStartOffset = Math.max(0.2, colliderFit.halfExtents[1] + GROUND_RAY_START_MARGIN);
  const groundProbeDistance = Math.max(
    surfaceAttachmentSettings.probeDistance,
    colliderFit.halfExtents[1] + rayStartOffset + GROUND_RAY_EXTRA_DISTANCE,
  );

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

  const resolveColliderHandle = (collider: RapierCollider | null | undefined) => {
    if (!collider) return null;

    const directHandle = resolveHandle(collider);
    if (directHandle !== null) return directHandle;

    for (const [handle, state] of colliderStates) {
      if (state.collider === collider && isValidHandle(handle)) return handle;
    }

    return null;
  };

  const resolveRigidBodyHandle = (rigidBody: RapierRigidBody | null | undefined) => {
    if (!rigidBody) return null;

    const directHandle = resolveHandle(rigidBody);
    if (directHandle !== null) return directHandle;

    for (const [handle, state] of rigidBodyStates) {
      if (state.rigidBody === rigidBody && isValidHandle(handle)) return handle;
    }

    return null;
  };

  const getSurfaceDragFromCollider = (collider: RapierCollider | null | undefined) => {
    if (!collider) return 0;

    const parent = collider.parent();
    if (parent) {
      const userData = (parent as any).userData;
      const surfaceDragFromUserData =
        typeof userData === 'number'
          ? userData
          : userData && typeof userData === 'object' && typeof (userData as any).surfaceDrag === 'number'
            ? (userData as any).surfaceDrag
            : undefined;

      if (typeof surfaceDragFromUserData === 'number' && Number.isFinite(surfaceDragFromUserData)) {
        return surfaceDragFromUserData;
      }
    }

    const colliderHandle = resolveColliderHandle(collider);
    if (colliderHandle !== null && hasColliderDrag(colliderHandle)) {
      return getColliderDrag(colliderHandle);
    }

    if (!parent) return 0;

    const parentHandle = resolveRigidBodyHandle(parent);
    if (parentHandle !== null && hasBodyDrag(parentHandle)) {
      return getBodyDrag(parentHandle);
    }

    return 0;
  };

  const resolveSurfaceNameFromCollider = (collider: RapierCollider | null | undefined) => {
    if (!collider) return '';

    const parent = collider.parent();
    if (!parent) return '';

    const parentHandle = resolveRigidBodyHandle(parent);
    const parentState = parentHandle !== null ? rigidBodyStates.get(parentHandle) : undefined;
    const objectName = parentState?.object?.name;
    if (typeof objectName === 'string' && objectName.trim().length > 0) return objectName;

    const parentName = (parent as any).name;
    if (typeof parentName === 'string' && parentName.trim().length > 0) return parentName;

    return '';
  };

  const resolveAttachmentSurfaceKindFromCollider = (
    collider: RapierCollider | null | undefined,
  ): AttachmentSurfaceKind | null => {
    if (!collider) return null;

    const colliderKind = (collider as any)?.userData?.surfaceAttachmentKind;
    if (colliderKind === 'road' || colliderKind === 'ext') return colliderKind;

    const parent = collider.parent();
    const parentKind = (parent as any)?.userData?.surfaceAttachmentKind;
    if (parentKind === 'road' || parentKind === 'ext') return parentKind;

    return null;
  };

  const extractNonEmptyName = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';

  const setAntiGravEnabled = (nextEnabled: boolean) => {
    if (!antiGravSwitchesEnabled) return;
    if (antiGravEnabledRef.current === nextEnabled) return;

    antiGravEnabledRef.current = nextEnabled;

    if (!nextEnabled) {
      attachmentStateRef.current = 'detached';
      lastAttachTimestampRef.current = 0;
      lastValidNormalRef.current.copy(worldUp);
    }
  };

  const resolveSurfaceTriggerTypeFromUserData = (userData: unknown) => {
    if (!userData || typeof userData !== 'object') return null;
    const triggerType = (userData as any).surfaceTriggerType;
    if (triggerType === 'anti-grav-in' || triggerType === 'anti-grav-out' || triggerType === 'booster') {
      return triggerType;
    }
    return null;
  };

  const resolveSurfaceTriggerTypeFromCollider = (collider: RapierCollider | null | undefined) => {
    if (!collider) return null;

    const colliderHandle = resolveColliderHandle(collider);
    if (colliderHandle !== null) {
      const registryType = getSurfaceTriggerType(colliderHandle);
      if (registryType === 'anti-grav-in' || registryType === 'anti-grav-out' || registryType === 'booster') {
        return registryType;
      }
    }

    const fromColliderUserData = resolveSurfaceTriggerTypeFromUserData((collider as any).userData);
    if (fromColliderUserData) return fromColliderUserData;

    const parent = collider.parent();
    const fromParentUserData = resolveSurfaceTriggerTypeFromUserData((parent as any)?.userData);
    if (fromParentUserData) return fromParentUserData;

    const surfaceName = resolveSurfaceNameFromCollider(collider);
    if (ANTI_GRAV_IN_SURFACE_RE.test(surfaceName)) return 'anti-grav-in' as const;
    if (ANTI_GRAV_OUT_SURFACE_RE.test(surfaceName)) return 'anti-grav-out' as const;
    if (BOOSTER_SURFACE_RE.test(surfaceName)) return 'booster' as const;
    return null;
  };

  const resolveSurfaceNameFromPayload = (payload: CollisionPayload) => {
    const candidateNames = [
      extractNonEmptyName(payload.other.rigidBodyObject?.name),
      extractNonEmptyName(payload.other.colliderObject?.name),
      extractNonEmptyName((payload.other.rigidBody as any)?.name),
      extractNonEmptyName((payload.other.collider as any)?.name),
      extractNonEmptyName(resolveSurfaceNameFromCollider(payload.other.collider)),
    ];

    return candidateNames.find((name) => name.length > 0) ?? '';
  };

  const activateBooster = () => {
    if (!boosterSettings.enabled) return;
    const nowMs = performance.now();
    boostEndTimestampRef.current = nowMs + boosterSettings.durationMs;

    const minBoostedSpeed = Math.max(0.1, maxForward) * boosterSettings.strength;
    speedRef.current = Math.max(minBoostedSpeed, Math.abs(speedRef.current) * boosterSettings.strength);
  };

  const activateBoosterFromCollider = (collider: RapierCollider | null | undefined, surfaceLabel: string) => {
    if (!boosterSettings.enabled) return;

    const nowMs = performance.now();
    const colliderHandle = resolveColliderHandle(collider);
    const samePad =
      colliderHandle !== null &&
      activeBoosterHandleRef.current === colliderHandle &&
      nowMs - lastBoosterTriggerTimeRef.current < BOOSTER_RETRIGGER_COOLDOWN_MS;

    if (samePad) return;

    activeBoosterHandleRef.current = colliderHandle;
    lastBoosterTriggerTimeRef.current = nowMs;
    activateBooster();

    const resolvedSurfaceLabel = surfaceLabel.length > 0 ? surfaceLabel : 'trigger-booster';
    console.log(
      `[booster][${playerId}] entree zone booster (${resolvedSurfaceLabel}) -> x${boosterSettings.strength} ${Math.round(boosterSettings.durationMs)}ms`,
    );
  };

  const applySurfaceTriggerFromPayload = (payload: CollisionPayload) => {
    const surfaceName = resolveSurfaceNameFromPayload(payload);
    const triggerType = resolveSurfaceTriggerTypeFromCollider(payload.other.collider);
    if (triggerType === null) return;

    if (triggerType === 'booster') {
      activateBoosterFromCollider(payload.other.collider, surfaceName);
      return;
    }

    if (!antiGravSwitchesEnabled) return;

    const zoneKind = triggerType === 'anti-grav-in' ? 'in' : 'out';
    const resolvedSurfaceLabel = surfaceName.length > 0 ? surfaceName : `trigger-${zoneKind}`;
    if (zoneKind === 'in') {
      console.log(`[anti-grav][${playerId}] entree zone looping (${resolvedSurfaceLabel}) -> mode ON`);
      setAntiGravEnabled(true);
      return;
    }

    if (zoneKind === 'out') {
      console.log(`[anti-grav][${playerId}] entree zone sortie looping (${resolvedSurfaceLabel}) -> mode OFF`);
      setAntiGravEnabled(false);
    }
  };

  const handleAntiGravCollisionEnter = (payload: CollisionEnterPayload) => {
    applySurfaceTriggerFromPayload(payload);
  };

  const handleAntiGravIntersectionEnter = (payload: IntersectionEnterPayload) => {
    applySurfaceTriggerFromPayload(payload);
  };

  const handleAntiGravIntersectionExit = (payload: IntersectionExitPayload) => {
    const surfaceName = resolveSurfaceNameFromPayload(payload);
    const triggerType =
      resolveSurfaceTriggerTypeFromUserData((payload.other.collider as any)?.userData) ??
      resolveSurfaceTriggerTypeFromUserData((payload.other.rigidBody as any)?.userData) ??
      (ANTI_GRAV_IN_SURFACE_RE.test(surfaceName) ? 'anti-grav-in' :
        ANTI_GRAV_OUT_SURFACE_RE.test(surfaceName) ? 'anti-grav-out'
        : BOOSTER_SURFACE_RE.test(surfaceName) ? 'booster'
        : null);
    if (triggerType === null) return;

    if (triggerType === 'booster') {
      const colliderHandle = resolveColliderHandle(payload.other.collider);
      if (
        colliderHandle !== null &&
        activeBoosterHandleRef.current !== null &&
        activeBoosterHandleRef.current === colliderHandle
      ) {
        activeBoosterHandleRef.current = null;
      }
      const resolvedSurfaceLabel = surfaceName.length > 0 ? surfaceName : 'trigger-booster';
      console.log(`[booster][${playerId}] sortie zone booster (${resolvedSurfaceLabel})`);
      return;
    }

    if (!antiGravSwitchesEnabled) return;

    const zoneKind = triggerType === 'anti-grav-in' ? 'in' : 'out';
    const resolvedSurfaceLabel = surfaceName.length > 0 ? surfaceName : `trigger-${zoneKind}`;
    console.log(`[anti-grav][${playerId}] sortie zone looping (${resolvedSurfaceLabel})`);
  };

  const isAttachmentSurfaceAllowed = (collider: RapierCollider | null | undefined) => {
    if (!collider) return false;

    if (surfaceAttachmentSettings.allowedSurfaces === 'all') return true;

    const attachmentKind = resolveAttachmentSurfaceKindFromCollider(collider);
    if (attachmentKind === 'road' || attachmentKind === 'ext') return true;

    const surfaceName = resolveSurfaceNameFromCollider(collider);
    if (surfaceName.length === 0) return false;

    if (surfaceAttachmentSettings.allowedSurfaces === 'road-ext') {
      return ROAD_SURFACE_RE.test(surfaceName) || EXT_SURFACE_RE.test(surfaceName);
    }

    if (surfaceAttachmentSettings.allowedSurfaces === 'by-circuit') {
      return ROAD_SURFACE_RE.test(surfaceName) || EXT_SURFACE_RE.test(surfaceName);
    }

    return false;
  };

  const isExternalGroundCollider = (candidate: RapierCollider, selfBody: RapierRigidBody) => {
    if (typeof candidate.isSensor === 'function' && candidate.isSensor()) return false;

    const selfHandle = resolveRigidBodyHandle(selfBody);
    if (selfHandle === null) return true;

    const candidateParentHandle = resolveRigidBodyHandle(candidate.parent());
    if (candidateParentHandle === null) return true;

    return candidateParentHandle !== selfHandle;
  };

  const isExternalCollider = (candidate: RapierCollider, selfBody: RapierRigidBody) => {
    const selfHandle = resolveRigidBodyHandle(selfBody);
    if (selfHandle === null) return true;

    const candidateParentHandle = resolveRigidBodyHandle(candidate.parent());
    if (candidateParentHandle === null) return true;

    return candidateParentHandle !== selfHandle;
  };

  const isRoadSurfaceCollider = (collider: RapierCollider | null | undefined) => {
    const attachmentKind = resolveAttachmentSurfaceKindFromCollider(collider);
    if (attachmentKind === 'road') return true;

    const surfaceName = resolveSurfaceNameFromCollider(collider);
    return ROAD_SURFACE_RE.test(surfaceName);
  };

  const computeDistanceToRoad = (x: number, y: number, z: number, body: RapierRigidBody) => {
    let minDistance = Number.POSITIVE_INFINITY;

    for (const [dx, dy, dz] of ROAD_DISTANCE_QUERY_DIRECTIONS) {
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.000001) continue;

      groundRay.origin.x = x;
      groundRay.origin.y = y;
      groundRay.origin.z = z;
      groundRay.dir.x = dx / len;
      groundRay.dir.y = dy / len;
      groundRay.dir.z = dz / len;

      const hit = world.castRay(
        groundRay,
        ROAD_DISTANCE_QUERY_MAX,
        true,
        undefined,
        undefined,
        undefined,
        body,
        (candidate) => isExternalGroundCollider(candidate, body) && isRoadSurfaceCollider(candidate),
      );

      if (hit && hit.timeOfImpact < minDistance) {
        minDistance = hit.timeOfImpact;
      }
    }

    return minDistance;
  };

  const setLakituTarget = (x: number, y: number, z: number, visible: boolean) => {
    lakituVisibleTargetRef.current = visible;
    lakituPositionTargetRef.current.set(x, y + LAKITU_FOLLOW_OFFSET_Y, z);
  };

  const setGroundRay = (origin: Vector3, direction: Vector3) => {
    groundRay.origin.x = origin.x;
    groundRay.origin.y = origin.y;
    groundRay.origin.z = origin.z;
    groundRay.dir.x = direction.x;
    groundRay.dir.y = direction.y;
    groundRay.dir.z = direction.z;
  };

  const buildRayOrigin = (x: number, y: number, z: number, downDirection: Vector3) =>
    tmpRayOrigin.set(x, y, z).addScaledVector(downDirection, -rayStartOffset);

  const sampleSurfaceDragAt = (
    origin: Vector3,
    downDirection: Vector3,
    body: RapierRigidBody,
    maxDistance: number,
  ) => {
    setGroundRay(origin, downDirection);

    let maxDrag = 0;
    world.intersectionsWithRay(
      groundRay,
      maxDistance,
      true,
      (intersection) => {
        const surfaceDrag = getSurfaceDragFromCollider(intersection.collider);
        if (surfaceDrag > maxDrag) maxDrag = surfaceDrag;
        return true;
      },
      undefined,
      undefined,
      undefined,
      body,
      (candidate) => isExternalGroundCollider(candidate, body),
    );

    return maxDrag;
  };

  const castGroundHit = (
    origin: Vector3,
    downDirection: Vector3,
    body: RapierRigidBody,
    maxDistance: number,
    options?: GroundHitOptions,
  ): GroundHit | null => {
    const { filter, preferredUp, minNormalDot, maxRetries = 1, fallbackToFirstHit = true } = options ?? {};
    const safeRetries = Math.max(1, Math.floor(maxRetries));
    const rejectedHandles = new Set<number>();

    setGroundRay(origin, downDirection);

    let firstHit: GroundHit | null = null;
    for (let attempt = 0; attempt < safeRetries; attempt += 1) {
      const hit = world.castRayAndGetNormal(
        groundRay,
        maxDistance,
        true,
        undefined,
        undefined,
        undefined,
        body,
        (candidate) => {
          if (!isExternalGroundCollider(candidate, body)) return false;
          if (filter && !filter(candidate)) return false;

          const candidateHandle = resolveColliderHandle(candidate);
          if (candidateHandle === null) return true;
          return !rejectedHandles.has(candidateHandle);
        },
      );

      if (!hit) break;

      const normalizedHit: GroundHit = {
        collider: hit.collider,
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      };
      if (!firstHit) firstHit = normalizedHit;

      if (!preferredUp || typeof minNormalDot !== 'number') {
        return normalizedHit;
      }

      tmpAttachmentNormal
        .set(normalizedHit.normal.x, normalizedHit.normal.y, normalizedHit.normal.z)
        .normalize();
      if (tmpAttachmentNormal.dot(preferredUp) >= minNormalDot) {
        return normalizedHit;
      }

      const hitHandle = resolveColliderHandle(normalizedHit.collider);
      if (hitHandle === null) break;
      rejectedHandles.add(hitHandle);
    }

    return fallbackToFirstHit ? firstHit : null;
  };

  const castSurfaceTriggerHit = (
    origin: Vector3,
    downDirection: Vector3,
    body: RapierRigidBody,
    maxDistance: number,
  ) => {
    setGroundRay(origin, downDirection);
    return world.castRayAndGetNormal(
      groundRay,
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      body,
      (candidate) =>
        isExternalCollider(candidate, body) && resolveSurfaceTriggerTypeFromCollider(candidate) !== null,
    );
  };

  useEffect(() => {
    const applyShadows = (root: Group) => {
      root.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    };

    applyShadows(vehicleCloned);
    applyShadows(characterCloned);
    wheelObjects.forEach((wheelObject) => applyShadows(wheelObject));
  }, [characterCloned, vehicleCloned, wheelObjects]);

  useEffect(() => {
    lakituCloned.traverse((child: any) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [lakituCloned]);

  useFrame((_, delta) => {
    const group = lakituGroupRef.current;
    if (!group) return;

    const dt = Math.min(delta, 0.1);
    const shouldBeVisible = lakituVisibleTargetRef.current;
    const duration = shouldBeVisible ? LAKITU_FADE_IN_SECONDS : LAKITU_FADE_OUT_SECONDS;
    const signedStep = duration > 0 ? dt / duration : 1;
    lakituFadeRef.current = clamp(lakituFadeRef.current + (shouldBeVisible ? signedStep : -signedStep), 0, 1);

    if (!lakituInitializedRef.current) {
      group.position.copy(lakituPositionTargetRef.current);
      lakituInitializedRef.current = true;
    } else {
      const alpha = 1 - Math.exp(-LAKITU_POSITION_SMOOTHING * dt);
      group.position.lerp(lakituPositionTargetRef.current, alpha);
    }

    const easedFade = smoothstep01(lakituFadeRef.current);
    group.visible = easedFade > 0.001;
    group.rotation.y = Math.PI;
    const scaled = LAKITU_BASE_SCALE * easedFade;
    group.scale.set(scaled, scaled, scaled);
  });

  useEffect(() => {
    yawRef.current = initialRotation[1];
    headingRef.current.set(Math.sin(yawRef.current), 0, Math.cos(yawRef.current)).normalize();
    boostEndTimestampRef.current = 0;
    activeBoosterHandleRef.current = null;
    lastBoosterTriggerTimeRef.current = 0;
    speedRef.current = 0;
    verticalVelRef.current = 0;
    attachmentStateRef.current = 'detached';
    lastAttachTimestampRef.current = 0;
    lastValidNormalRef.current.set(0, 1, 0);
    antiGravEnabledRef.current = !antiGravSwitchesEnabled;
    activeSurfaceTriggerZoneRef.current = null;
    lastGroundSurfaceKindRef.current = null;
    hasLastRoadToExtPositionRef.current = false;
    hasLastRoadContactPositionRef.current = false;
    rescueActiveRef.current = false;
    rescueStartTimeRef.current = 0;
    rescueStartPosRef.current.set(0, 0, 0);
    rescueHoverPosRef.current.set(0, 0, 0);
    rescueTargetPosRef.current.set(0, 0, 0);
    lakituFadeRef.current = 0;
    lakituVisibleTargetRef.current = false;
    lakituInitializedRef.current = false;
    lakituPositionTargetRef.current.set(
      spawnPosition[0],
      spawnPosition[1] + LAKITU_FOLLOW_OFFSET_Y,
      spawnPosition[2],
    );
    const lakitu = lakituGroupRef.current;
    if (lakitu) {
      lakitu.visible = false;
      lakitu.position.copy(lakituPositionTargetRef.current);
      lakitu.scale.set(0, 0, 0);
    }

    smoothedGroundNormalRef.current.copy(worldUp);
    smoothedVisualBodyYRef.current = null;
    const visualRoot = visualRootRef.current;
    if (visualRoot) {
      visualRoot.position.set(visualRootPosition[0], visualRootPosition[1], visualRootPosition[2]);
    }
  }, [antiGravSwitchesEnabled, initialRotation, spawnPosition, visualRootPosition]);

  useEffect(() => {
    const visualRoot = visualRootRef.current;
    if (!visualRoot) return;
    visualRoot.position.set(visualRootPosition[0], visualRootPosition[1], visualRootPosition[2]);
  }, [visualRootPosition]);

  useEffect(() => {
    const setKeyState = (key: string, pressed: boolean) => {
      if (bindingSets.forward.has(key)) keysRef.current.forward = pressed;
      if (bindingSets.back.has(key)) keysRef.current.back = pressed;
      if (bindingSets.left.has(key)) keysRef.current.left = pressed;
      if (bindingSets.right.has(key)) keysRef.current.right = pressed;
    };

    const clearAll = () => {
      keysRef.current.forward = false;
      keysRef.current.back = false;
      keysRef.current.left = false;
      keysRef.current.right = false;
    };

    const down = (e: KeyboardEvent) => {
      if (gameMode.current === 'free' || commandInputActive.current) {
        clearAll();
        return;
      }
      setKeyState(e.key.toLowerCase(), true);
    };

    const up = (e: KeyboardEvent) => {
      if (gameMode.current === 'free' || commandInputActive.current) {
        clearAll();
        return;
      }
      setKeyState(e.key.toLowerCase(), false);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearAll);
    };
  }, [bindingSets]);

  useEffect(() => {
    const controller = new rapier.KinematicCharacterController(
      0.01,
      world.integrationParameters,
      world.broadPhase,
      world.narrowPhase,
      world.bodies,
      world.colliders,
    );

    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle((MAX_CLIMB_ANGLE_DEG * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((Math.min(89.5, MAX_CLIMB_ANGLE_DEG + 5) * Math.PI) / 180);
    controller.enableAutostep(autostepSettings.maxStepHeight, autostepSettings.minStepWidth, false);

    const attachmentCapabilityEnabled = surfaceAttachmentSettings.enabled || antiGravSwitchesEnabled;
    if (!attachmentCapabilityEnabled) {
      controller.enableSnapToGround(0.25);
    }

    controllerRef.current = controller;
    return () => {
      controller.free();
      controllerRef.current = null;
    };
  }, [
    autostepSettings.maxStepHeight,
    autostepSettings.minStepWidth,
    antiGravSwitchesEnabled,
    rapier,
    surfaceAttachmentSettings.enabled,
    world,
  ]);

  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    const collider = colliderRef.current;
    const controller = controllerRef.current;
    if (!body || !collider || !controller) return;

    const dt = world.timestep;
    const dtClamped = Math.min(dt, 0.05);

    const nowMs = performance.now();
    const tCurrent = body.translation();

    if (rescueActiveRef.current) {
      keysRef.current.forward = false;
      keysRef.current.back = false;
      keysRef.current.left = false;
      keysRef.current.right = false;
      speedRef.current = 0;
      verticalVelRef.current = 0;

      const rescueElapsed = nowMs - rescueStartTimeRef.current;
      const rescueProgress = clamp(rescueElapsed / ROAD_RESCUE_DURATION_MS, 0, 1);
      const phase = clamp(ROAD_RESCUE_HOVER_PHASE, 0.05, 0.95);

      if (rescueProgress < phase) {
        const riseT = smoothstep01(rescueProgress / phase);
        tmpRescuePos.copy(rescueStartPosRef.current).lerp(rescueHoverPosRef.current, riseT);
      } else {
        const returnT = smoothstep01((rescueProgress - phase) / (1 - phase));
        tmpRescuePos.copy(rescueHoverPosRef.current).lerp(rescueTargetPosRef.current, returnT);
      }

      const nextTranslation = nextTranslationRef.current;
      nextTranslation.x = tmpRescuePos.x;
      nextTranslation.y = tmpRescuePos.y;
      nextTranslation.z = tmpRescuePos.z;
      body.setNextKinematicTranslation(nextTranslation);

      const rescueQuat = rescueStartQuatRef.current;
      body.setNextKinematicRotation({
        x: rescueQuat.x,
        y: rescueQuat.y,
        z: rescueQuat.z,
        w: rescueQuat.w,
      });

      setLakituTarget(tmpRescuePos.x, tmpRescuePos.y, tmpRescuePos.z, true);

      if (rescueProgress >= 1) {
        rescueActiveRef.current = false;
        attachmentStateRef.current = 'detached';
        lastAttachTimestampRef.current = 0;
        lastValidNormalRef.current.copy(worldUp);
      }

      return;
    }

    setLakituTarget(tCurrent.x, tCurrent.y, tCurrent.z, false);

    if (commandInputActive.current) {
      keysRef.current.forward = false;
      keysRef.current.back = false;
      keysRef.current.left = false;
      keysRef.current.right = false;
    }
    const throttle = commandInputActive.current
      ? 0
      : (keysRef.current.forward ? 1 : 0) + (keysRef.current.back ? -1 : 0);
    const steer = commandInputActive.current
      ? 0
      : (keysRef.current.left ? 1 : 0) + (keysRef.current.right ? -1 : 0);
    const boostActive = boosterSettings.enabled && nowMs < boostEndTimestampRef.current;

    const attachmentCapabilityEnabled = surfaceAttachmentSettings.enabled || antiGravSwitchesEnabled;
    const attachmentFeatureEnabled =
      attachmentCapabilityEnabled && (!antiGravSwitchesEnabled || antiGravEnabledRef.current);

    if (!attachmentFeatureEnabled && attachmentStateRef.current !== 'detached') {
      attachmentStateRef.current = 'detached';
      lastAttachTimestampRef.current = 0;
      lastValidNormalRef.current.copy(worldUp);
    }

    const probeDown = tmpDownDir;
    const hadAttachmentBeforeStep = attachmentStateRef.current !== 'detached';
    const wasGroundedAtStepStart = controller.computedGrounded();
    const bodyRotationNow = body.rotation();
    tmpBodyQuat.set(bodyRotationNow.x, bodyRotationNow.y, bodyRotationNow.z, bodyRotationNow.w).normalize();
    const currentBodyUp = tmpPoseUp.set(0, 1, 0).applyQuaternion(tmpBodyQuat).normalize();
    const isLoopingFromCurrentUp =
      attachmentFeatureEnabled && Math.abs(currentBodyUp.dot(worldUp)) < LOOPING_REFERENCE_WORLD_DOT;
    const isLoopingFromLastNormal =
      attachmentFeatureEnabled &&
      Math.abs(lastValidNormalRef.current.dot(worldUp)) < LOOPING_REFERENCE_WORLD_DOT;
    const hasRecentLoopReference =
      attachmentFeatureEnabled && nowMs - lastAttachTimestampRef.current <= LOOPING_DETACH_HOLD_MS;
    const shouldHoldDetachedLoopReference = hasRecentLoopReference && isLoopingFromLastNormal;
    const isLoopingOrientation = isLoopingFromCurrentUp || shouldHoldDetachedLoopReference;
    const detachedReferenceUp =
      shouldHoldDetachedLoopReference ? lastValidNormalRef.current
      : isLoopingFromCurrentUp ? currentBodyUp
      : worldUp;
    const preserveLoopNormalOnDetach =
      attachmentFeatureEnabled && (isLoopingFromCurrentUp || shouldHoldDetachedLoopReference);

    const shouldUseDetachedLoopProbe =
      attachmentFeatureEnabled && !hadAttachmentBeforeStep && isLoopingOrientation;
    if (attachmentFeatureEnabled && (hadAttachmentBeforeStep || shouldUseDetachedLoopProbe)) {
      const probeUpSource = hadAttachmentBeforeStep ? lastValidNormalRef.current : detachedReferenceUp;
      probeDown.copy(probeUpSource).multiplyScalar(-1).normalize();
    } else {
      probeDown.set(0, -1, 0);
    }

    const dragRayOrigin = buildRayOrigin(tCurrent.x, tCurrent.y, tCurrent.z, probeDown);
    currentExtraDragRef.current = sampleSurfaceDragAt(dragRayOrigin, probeDown, body, groundProbeDistance);

    if (antiGravSwitchesEnabled || boosterSettings.enabled) {
      const triggerHit = castSurfaceTriggerHit(dragRayOrigin, probeDown, body, groundProbeDistance);
      const triggerType = triggerHit ? resolveSurfaceTriggerTypeFromCollider(triggerHit.collider) : null;

      if (triggerType === 'booster') {
        activateBoosterFromCollider(triggerHit?.collider, resolveSurfaceNameFromCollider(triggerHit?.collider));
      } else {
        activeBoosterHandleRef.current = null;
      }

      if (antiGravSwitchesEnabled) {
        const triggerZone =
          triggerType === 'anti-grav-in' ? 'in'
          : triggerType === 'anti-grav-out' ? 'out'
          : null;
        const prevTriggerZone = activeSurfaceTriggerZoneRef.current;

        if (triggerZone !== prevTriggerZone) {
          if (prevTriggerZone !== null) {
            const prevLabel = prevTriggerZone === 'in' ? 'trigger-in' : 'trigger-out';
            console.log(`[anti-grav][${playerId}] sortie zone looping (${prevLabel})`);
          }

          if (triggerZone === 'in') {
            console.log(`[anti-grav][${playerId}] entree zone looping (trigger-in) -> mode ON`);
            setAntiGravEnabled(true);
          } else if (triggerZone === 'out') {
            console.log(`[anti-grav][${playerId}] entree zone sortie looping (trigger-out) -> mode OFF`);
            setAntiGravEnabled(false);
          }

          activeSurfaceTriggerZoneRef.current = triggerZone;
        }
      } else if (activeSurfaceTriggerZoneRef.current !== null) {
        activeSurfaceTriggerZoneRef.current = null;
      }
    }

    const preAttachmentReferenceUp =
      hadAttachmentBeforeStep ? lastValidNormalRef.current : detachedReferenceUp;
    const preAttachmentMinDot =
      !hadAttachmentBeforeStep && isLoopingOrientation ?
        Math.min(maxAttachDot, LOOPING_DETACHED_REATTACH_DOT)
      : maxAttachDot;
    const preRawGroundHit = castGroundHit(dragRayOrigin, probeDown, body, groundProbeDistance);
    const preAttachmentHit = attachmentFeatureEnabled
      ? castGroundHit(
          dragRayOrigin,
          probeDown,
          body,
          groundProbeDistance,
          {
            filter: isAttachmentSurfaceAllowed,
            preferredUp: preAttachmentReferenceUp,
            minNormalDot: preAttachmentMinDot,
            maxRetries: MAX_GROUND_RAY_RETRIES,
            fallbackToFirstHit: false,
          },
        )
      : null;

    let hasLateralWallObstruction = false;
    if (attachmentFeatureEnabled && hadAttachmentBeforeStep && preRawGroundHit) {
      tmpAttachmentNormal
        .set(preRawGroundHit.normal.x, preRawGroundHit.normal.y, preRawGroundHit.normal.z)
        .normalize();

      if (tmpAttachmentNormal.dot(lastValidNormalRef.current) < WALL_COLLISION_ALIGN_DOT) {
        const rawHandle = resolveColliderHandle(preRawGroundHit.collider);
        const alignedHandle = preAttachmentHit ? resolveColliderHandle(preAttachmentHit.collider) : null;
        hasLateralWallObstruction =
          alignedHandle === null || rawHandle === null || alignedHandle !== rawHandle;
      }
    }

    let useSurfaceAttachment = false;
    if (attachmentFeatureEnabled && preAttachmentHit) {
      tmpAttachmentNormal
        .set(preAttachmentHit.normal.x, preAttachmentHit.normal.y, preAttachmentHit.normal.z)
        .normalize();

      const referenceUp = hadAttachmentBeforeStep ? lastValidNormalRef.current : detachedReferenceUp;
      if (tmpAttachmentNormal.dot(referenceUp) >= preAttachmentMinDot) {
        attachmentStateRef.current = 'attached';
        lastAttachTimestampRef.current = nowMs;
        lastValidNormalRef.current.copy(tmpAttachmentNormal);
        useSurfaceAttachment = true;
      }
    }

    if (attachmentFeatureEnabled && !useSurfaceAttachment && hadAttachmentBeforeStep) {
      const keepAttachmentThroughWall = hasLateralWallObstruction && wasGroundedAtStepStart;
      if (keepAttachmentThroughWall) {
        attachmentStateRef.current = 'grace';
        lastAttachTimestampRef.current = nowMs;
      } else {
        const elapsedSinceAttach = nowMs - lastAttachTimestampRef.current;
        if (elapsedSinceAttach <= surfaceAttachmentSettings.detachGraceMs) {
          attachmentStateRef.current = 'grace';
        } else {
          attachmentStateRef.current = 'detached';
          if (!preserveLoopNormalOnDetach) {
            lastValidNormalRef.current.copy(worldUp);
          }
        }
      }
    }

    const isAttachmentActive = attachmentFeatureEnabled && attachmentStateRef.current !== 'detached';
    if (isAttachmentActive && !useSurfaceAttachment) {
      tmpAttachmentNormal.copy(lastValidNormalRef.current);
    }
    const shouldUseDetachedLoopReference =
      attachmentFeatureEnabled && !isAttachmentActive && isLoopingOrientation;

    const controllerUpSource =
      isAttachmentActive ? tmpAttachmentNormal
      : shouldUseDetachedLoopReference ? detachedReferenceUp
      : worldUp;
    controllerUpVec.x = controllerUpSource.x;
    controllerUpVec.y = controllerUpSource.y;
    controllerUpVec.z = controllerUpSource.z;
    controller.setUp(controllerUpVec);

    if (isAttachmentActive || shouldUseDetachedLoopReference) {
      const wallGuardEnabled = hasLateralWallObstruction;
      const adaptiveLoopSlopeClimbDeg =
        wallGuardEnabled ?
          Math.min(surfaceAttachmentSettings.loopSlopeClimbAngleDeg, WALL_GUARD_MAX_CLIMB_ANGLE_DEG)
        : surfaceAttachmentSettings.loopSlopeClimbAngleDeg;
      const adaptiveLoopSlopeSlideDeg =
        wallGuardEnabled ?
          clamp(
            adaptiveLoopSlopeClimbDeg + WALL_GUARD_SLIDE_MARGIN_DEG,
            adaptiveLoopSlopeClimbDeg,
            89.5,
          )
        : surfaceAttachmentSettings.loopSlopeSlideAngleDeg;

      controller.setMaxSlopeClimbAngle((adaptiveLoopSlopeClimbDeg * Math.PI) / 180);
      controller.setMinSlopeSlideAngle((adaptiveLoopSlopeSlideDeg * Math.PI) / 180);
    } else {
      controller.setMaxSlopeClimbAngle((MAX_CLIMB_ANGLE_DEG * Math.PI) / 180);
      controller.setMinSlopeSlideAngle((Math.min(89.5, MAX_CLIMB_ANGLE_DEG + 5) * Math.PI) / 180);
    }

    // Speed control (simple, stable)
    const forwardLimit = Math.max(0.1, maxForward) * (boostActive ? boosterSettings.strength : 1);
    const backwardLimit = -Math.max(0.1, maxBackward);
    const steerInput = steer;

    if (boostActive) {
      const minimumBoostSpeed = Math.max(0.1, maxForward) * boosterSettings.strength;
      speedRef.current = Math.max(speedRef.current, minimumBoostSpeed);
    } else if (throttle !== 0) speedRef.current += throttle * ACCEL * dtClamped;
    else {
      const s = speedRef.current;
      if (Math.abs(s) < 0.01) speedRef.current = 0;
      else speedRef.current -= Math.sign(s) * COAST * dtClamped;
    }
    speedRef.current = clamp(speedRef.current, backwardLimit, forwardLimit);

    // apply linear damping (drag) to smooth/slow the vehicle over time
    const effectiveDrag = Math.max(drag, currentExtraDragRef.current || 0);
    if (!boostActive && effectiveDrag > 0 && Math.abs(speedRef.current) > 0) {
      const damp = Math.max(0, 1 - effectiveDrag * dtClamped);
      speedRef.current *= damp;
      if (Math.abs(speedRef.current) < 0.01) speedRef.current = 0;
    }

    const steeringForwardLimit = Math.max(0.1, maxForward);
    const speedFactor = clamp(Math.abs(speedRef.current) / steeringForwardLimit, 0.2, 1.0);
    const steerAngle = steerInput * MAX_YAW_RATE * dtClamped * (speedRef.current >= 0 ? 1 : -1) * speedFactor;
    const steerAxis = isAttachmentActive ? tmpAttachmentNormal : worldUp;
    if (Math.abs(steerAngle) > 0.00001) {
      headingRef.current.applyAxisAngle(steerAxis, steerAngle);
    }

    tmpForward.copy(headingRef.current);
    if (!isAttachmentActive) {
      tmpForward.y = 0;
      if (tmpForward.lengthSq() < 0.0001) tmpForward.set(Math.sin(yawRef.current), 0, Math.cos(yawRef.current));
      tmpForward.normalize();
    } else {
      tmpProj.copy(tmpAttachmentNormal).multiplyScalar(tmpForward.dot(tmpAttachmentNormal));
      tmpForward.sub(tmpProj);
      if (tmpForward.lengthSq() < 0.0001) {
        tmpBasisRight.copy(tmpAttachmentNormal).cross(worldUp);
        if (tmpBasisRight.lengthSq() < 0.0001) tmpBasisRight.set(1, 0, 0);
        tmpForward.copy(tmpBasisRight).cross(tmpAttachmentNormal);
      }
      tmpForward.normalize();
    }

    headingRef.current.copy(tmpForward);
    yawRef.current = Math.atan2(tmpForward.x, tmpForward.z);

    // Pseudo-gravity for kinematic bodies. Positive value means movement in the "down" direction.
    const gravityWithAttachment = GRAVITY_ACCEL + (isAttachmentActive ? surfaceAttachmentSettings.stickForce : 0);
    verticalVelRef.current += gravityWithAttachment * dtClamped;

    // Desired movement (character-controller will handle slide + slope).
    tmpMoveDelta.copy(tmpForward).multiplyScalar(speedRef.current * dtClamped);
    if (isAttachmentActive) {
      tmpMoveDelta.addScaledVector(tmpAttachmentNormal, -verticalVelRef.current * dtClamped);
    } else {
      tmpMoveDelta.y -= verticalVelRef.current * dtClamped;
    }

    const desiredDelta = desiredDeltaRef.current;
    desiredDelta.x = tmpMoveDelta.x;
    desiredDelta.y = tmpMoveDelta.y;
    desiredDelta.z = tmpMoveDelta.z;

    controller.computeColliderMovement(collider, desiredDelta, undefined, undefined, (c) => c.handle !== collider.handle);

    const m = controller.computedMovement();
    const t0 = body.translation();
    const nextTranslation = nextTranslationRef.current;
    nextTranslation.x = t0.x + m.x;
    nextTranslation.y = t0.y + m.y;
    nextTranslation.z = t0.z + m.z;
    body.setNextKinematicTranslation(nextTranslation);

    const isGroundedAfterMove = controller.computedGrounded();
    if (isGroundedAfterMove && verticalVelRef.current > 0) {
      verticalVelRef.current = 0;
    }

    // Ground alignment and attachment continuity.
    const t1 = tmpTranslationRef.current;
    t1.x = t0.x + m.x;
    t1.y = t0.y + m.y;
    t1.z = t0.z + m.z;

    const shouldUseDetachedLoopProbeAfterMove =
      attachmentFeatureEnabled &&
      attachmentStateRef.current === 'detached' &&
      isLoopingOrientation;
    if (attachmentFeatureEnabled && (attachmentStateRef.current !== 'detached' || shouldUseDetachedLoopProbeAfterMove)) {
      const probeUpSource =
        attachmentStateRef.current !== 'detached' ? lastValidNormalRef.current : detachedReferenceUp;
      probeDown.copy(probeUpSource).multiplyScalar(-1).normalize();
    } else {
      probeDown.set(0, -1, 0);
    }

    const alignRayOrigin = buildRayOrigin(t1.x, t1.y, t1.z, probeDown);
    const groundHit = castGroundHit(alignRayOrigin, probeDown, body, groundProbeDistance);
    const alignAttachmentReferenceUp =
      attachmentStateRef.current === 'detached' ? detachedReferenceUp : lastValidNormalRef.current;
    const alignAttachmentMinDot =
      attachmentStateRef.current === 'detached' && isLoopingOrientation ?
        Math.min(maxAttachDot, LOOPING_DETACHED_REATTACH_DOT)
      : maxAttachDot;
    const attachmentHit = attachmentFeatureEnabled
      ? castGroundHit(
          alignRayOrigin,
          probeDown,
          body,
          groundProbeDistance,
          {
            filter: isAttachmentSurfaceAllowed,
            preferredUp: alignAttachmentReferenceUp,
            minNormalDot: alignAttachmentMinDot,
            maxRetries: MAX_GROUND_RAY_RETRIES,
            fallbackToFirstHit: false,
          },
        )
      : null;

    let hasPostWallObstruction = false;
    if (attachmentFeatureEnabled && attachmentStateRef.current !== 'detached' && groundHit) {
      tmpAttachmentNormal
        .set(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z)
        .normalize();

      if (tmpAttachmentNormal.dot(lastValidNormalRef.current) < WALL_COLLISION_ALIGN_DOT) {
        const groundHandle = resolveColliderHandle(groundHit.collider);
        const alignedHandle = attachmentHit ? resolveColliderHandle(attachmentHit.collider) : null;
        hasPostWallObstruction =
          alignedHandle === null || groundHandle === null || alignedHandle !== groundHandle;
      }
    }

    if (attachmentFeatureEnabled && attachmentHit) {
      tmpAttachmentNormal
        .set(attachmentHit.normal.x, attachmentHit.normal.y, attachmentHit.normal.z)
        .normalize();

      const referenceUp =
        attachmentStateRef.current === 'detached' ? detachedReferenceUp : lastValidNormalRef.current;
      if (tmpAttachmentNormal.dot(referenceUp) >= alignAttachmentMinDot) {
        attachmentStateRef.current = 'attached';
        lastAttachTimestampRef.current = nowMs;
        lastValidNormalRef.current.copy(tmpAttachmentNormal);
      } else if (attachmentStateRef.current !== 'detached') {
        const keepAttachmentThroughWall = hasPostWallObstruction && isGroundedAfterMove;
        if (keepAttachmentThroughWall) {
          attachmentStateRef.current = 'grace';
          lastAttachTimestampRef.current = nowMs;
        } else {
          const elapsedSinceAttach = nowMs - lastAttachTimestampRef.current;
          if (elapsedSinceAttach <= surfaceAttachmentSettings.detachGraceMs) {
            attachmentStateRef.current = 'grace';
          } else {
            attachmentStateRef.current = 'detached';
            if (!preserveLoopNormalOnDetach) {
              lastValidNormalRef.current.copy(worldUp);
            }
          }
        }
      }
    } else if (attachmentFeatureEnabled && attachmentStateRef.current !== 'detached') {
      const keepAttachmentThroughWall = hasPostWallObstruction && isGroundedAfterMove;
      if (keepAttachmentThroughWall) {
        attachmentStateRef.current = 'grace';
        lastAttachTimestampRef.current = nowMs;
      } else {
        const elapsedSinceAttach = nowMs - lastAttachTimestampRef.current;
        if (elapsedSinceAttach <= surfaceAttachmentSettings.detachGraceMs) {
          attachmentStateRef.current = 'grace';
        } else {
          attachmentStateRef.current = 'detached';
          if (!preserveLoopNormalOnDetach) {
            lastValidNormalRef.current.copy(worldUp);
          }
        }
      }
    }

    const currentGroundSurfaceKind = groundHit ? resolveAttachmentSurfaceKindFromCollider(groundHit.collider) : null;
    const previousGroundSurfaceKind = lastGroundSurfaceKindRef.current;
    if (currentGroundSurfaceKind === 'road') {
      lastRoadContactPositionRef.current.set(t1.x, t1.y, t1.z);
      hasLastRoadContactPositionRef.current = true;
    }

    const leftRoadSurface =
      previousGroundSurfaceKind === 'road' &&
      currentGroundSurfaceKind !== 'road';
    if (leftRoadSurface) {
      if (hasLastRoadContactPositionRef.current) {
        lastRoadToExtPositionRef.current.copy(lastRoadContactPositionRef.current);
      } else {
        lastRoadToExtPositionRef.current.set(t1.x, t1.y, t1.z);
      }
      hasLastRoadToExtPositionRef.current = true;
    }
    lastGroundSurfaceKindRef.current = currentGroundSurfaceKind;

    const distanceToRoad = computeDistanceToRoad(t1.x, t1.y, t1.z, body);
    const shouldStartRoadRescue =
      hasLastRoadToExtPositionRef.current &&
      currentGroundSurfaceKind !== 'road' &&
      distanceToRoad > ROAD_RESCUE_MAX_DISTANCE;

    if (shouldStartRoadRescue) {
      rescueActiveRef.current = true;
      rescueStartTimeRef.current = nowMs;
      rescueStartPosRef.current.set(t1.x, t1.y, t1.z);
      rescueTargetPosRef.current.copy(lastRoadToExtPositionRef.current);
      rescueHoverPosRef.current.copy(lastRoadToExtPositionRef.current).addScaledVector(worldUp, ROAD_RESCUE_LIFT_HEIGHT);

      const currentRotation = body.rotation();
      rescueStartQuatRef.current
        .set(currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w)
        .normalize();

      speedRef.current = 0;
      verticalVelRef.current = 0;
      attachmentStateRef.current = 'detached';
      lastAttachTimestampRef.current = 0;
      lastValidNormalRef.current.copy(worldUp);

      setLakituTarget(t1.x, t1.y, t1.z, true);
      return;
    }

    const minWalkableDot = Math.cos((MAX_CLIMB_ANGLE_DEG * Math.PI) / 180);
    const isAttachedAfterAlign = attachmentFeatureEnabled && attachmentStateRef.current !== 'detached';
    const desiredUp = tmpDesiredUp;
    if (isAttachedAfterAlign) {
      tmpNormal.copy(lastValidNormalRef.current);
      smoothedGroundNormalRef.current.copy(tmpNormal);
    } else {
      if (groundHit) {
        desiredUp.set(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z).normalize();
        if (desiredUp.dot(worldUp) < minWalkableDot) {
          desiredUp.copy(worldUp);
        } else {
          // Blend between world-up and the ground normal so we can control how strongly
          // the car tilts to match the slope. `GROUND_TILT_FACTOR` in [0..1].
          desiredUp.lerp(worldUp, 1 - GROUND_TILT_FACTOR).normalize();
        }
      } else if (shouldUseDetachedLoopReference) {
        desiredUp.copy(detachedReferenceUp);
      } else {
        desiredUp.copy(worldUp);
      }

      const smoothedUp = smoothedGroundNormalRef.current;
      const alignmentDot = clamp(smoothedUp.dot(desiredUp), -1, 1);
      if (alignmentDot < GROUND_NORMAL_DEADZONE_DOT) {
        const upAlpha = 1 - Math.exp(-GROUND_NORMAL_SMOOTHING * dtClamped);
        smoothedUp.lerp(desiredUp, upAlpha).normalize();
      }

      tmpNormal.copy(smoothedUp);
    }

    // Debug: log ground object name when the car transitions to a different collider.
    const currentGroundHandle = groundHit ? resolveColliderHandle(groundHit.collider) : null;
    if (SHOULD_LOG_GROUND_CONTACT && currentGroundHandle !== lastGroundColliderHandleRef.current) {
      lastGroundColliderHandleRef.current = currentGroundHandle;
      if (currentGroundHandle !== null) {
        const hitState = colliderStates.get(currentGroundHandle);
        const colliderName = hitState?.object?.name?.trim();

        const parentBody = groundHit?.collider.parent();
        const parentBodyHandle = resolveRigidBodyHandle(parentBody);
        const parentState = parentBodyHandle !== null ? rigidBodyStates.get(parentBodyHandle) : undefined;
        const surfaceName = parentState?.object?.name?.trim();
        const surfaceDrag = currentExtraDragRef.current;

        const resolvedColliderName = colliderName && colliderName.length > 0 ? colliderName : 'unnamed-collider';
        const resolvedSurfaceName = surfaceName && surfaceName.length > 0 ? surfaceName : 'unknown-surface';

        console.log(
          `[ground][${playerId}] collider=${resolvedColliderName} handle=${currentGroundHandle} surface=${resolvedSurfaceName} drag=${surfaceDrag}`,
        );
      }
    }

    // Build an orientation with the chosen up-vector and the requested yaw heading projected on the ground.
    tmpProj.copy(tmpNormal).multiplyScalar(tmpForward.dot(tmpNormal));
    tmpBasisFwd.copy(tmpForward).sub(tmpProj);
    if (tmpBasisFwd.lengthSq() < 0.0001) tmpBasisFwd.copy(tmpForward);
    tmpBasisFwd.normalize();

    tmpBasisRight.copy(tmpNormal).cross(tmpBasisFwd);
    if (tmpBasisRight.lengthSq() < 0.0001) tmpBasisRight.set(1, 0, 0);
    tmpBasisRight.normalize();

    tmpBasisFwd.copy(tmpBasisRight).cross(tmpNormal).normalize();

    tmpMtx.makeBasis(tmpBasisRight, tmpNormal, tmpBasisFwd);
    tmpQuat.setFromRotationMatrix(tmpMtx);

    // Smoothly interpolate the body rotation towards the target orientation so
    // the car tilts look less abrupt. We compute an alpha from `ROTATION_SMOOTHING`
    // per-frame and slerp the stored quaternion towards the target.
    const smoothAlpha = 1 - Math.exp(-ROTATION_SMOOTHING * dtClamped);
    rotRef.current.slerp(tmpQuat, smoothAlpha);
    const r = rotRef.current;
    body.setNextKinematicRotation({ x: r.x, y: r.y, z: r.z, w: r.w });
  });

  useAfterPhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;

    const nowMs = performance.now();
    const boostActiveNow = boosterSettings.enabled && nowMs < boostEndTimestampRef.current;
    const t = body.translation();
    const visualRoot = visualRootRef.current;
    if (visualRoot) {
      const dt = Math.min(world.timestep, 0.05);
      const targetBodyY = t.y;
      const previousSmoothedY = smoothedVisualBodyYRef.current;
      const smoothedBodyY =
        previousSmoothedY === null ?
          targetBodyY
        : (() => {
            const deltaY = targetBodyY - previousSmoothedY;
            const smoothingRate = deltaY >= 0 ? VISUAL_STEP_SMOOTHING_UP : VISUAL_STEP_SMOOTHING_DOWN;
            const alpha = 1 - Math.exp(-smoothingRate * dt);
            return previousSmoothedY + deltaY * alpha;
          })();

      smoothedVisualBodyYRef.current = smoothedBodyY;
      const visualStepLag = clamp(smoothedBodyY - targetBodyY, -VISUAL_STEP_MAX_LAG, VISUAL_STEP_MAX_LAG);
      visualRoot.position.set(
        visualRootPosition[0],
        visualRootPosition[1] + visualStepLag,
        visualRootPosition[2],
      );
    }

    const r = body.rotation();
    tmpBodyQuat.set(r.x, r.y, r.z, r.w).normalize();
    tmpPoseForward.set(0, 0, 1).applyQuaternion(tmpBodyQuat).normalize();
    tmpPoseUp.set(0, 1, 0).applyQuaternion(tmpBodyQuat).normalize();

    const pose: CarPose = {
      x: t.x,
      y: t.y,
      z: t.z,
      yaw: yawRef.current,
      boostActive: boostActiveNow,
      forwardX: tmpPoseForward.x,
      forwardY: tmpPoseForward.y,
      forwardZ: tmpPoseForward.z,
      upX: tmpPoseUp.x,
      upY: tmpPoseUp.y,
      upZ: tmpPoseUp.z,
      qx: tmpBodyQuat.x,
      qy: tmpBodyQuat.y,
      qz: tmpBodyQuat.z,
      qw: tmpBodyQuat.w,
    };

    if (playerId === 'p1') {
      carPosition.set(t.x, t.y, t.z);
      carRotationY.current = yawRef.current;
    }

    onPoseUpdate?.(playerId, pose);
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={spawnPosition}
        rotation={initialRotation}
      >
        <RoundCuboidCollider
          ref={colliderRef}
          args={[colliderFit.halfExtents[0], colliderFit.halfExtents[1], colliderFit.halfExtents[2], colliderFit.borderRadius]}
          position={[0, 0, 0]}
          friction={0.2}
          restitution={0}
          onCollisionEnter={handleAntiGravCollisionEnter}
          onIntersectionEnter={handleAntiGravIntersectionEnter}
          onIntersectionExit={handleAntiGravIntersectionExit}
        />
        <group ref={visualRootRef} position={visualRootPosition}>
          <primitive object={vehicleCloned} scale={vehicleScale} />
          <group position={characterMountWithLift}>
            <primitive object={characterCloned} scale={characterScale} />
          </group>
          {effectiveWheelMounts.map((mount, index) => (
            <group
              key={`wheel-instance-${index}`}
              position={mount}
              rotation={getWheelRotationForMount(mount)}
            >
              <primitive object={wheelObjects[index]} scale={wheelScale} />
            </group>
          ))}
        </group>
      </RigidBody>
      <group ref={lakituGroupRef} visible={false} scale={[0, 0, 0]}>
        <primitive object={lakituCloned} />
      </group>
    </>
  );
}

// required by drei loader typings (preload helper)
useGLTF.preload('/models/lakitu.glb');
export const preloadDrivable = (url: string) => useGLTF.preload(url);
