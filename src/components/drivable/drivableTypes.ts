import type { RapierCollider } from '@react-three/rapier';
import type { Vector3 } from 'three';
import type {
  BotDrivingTacticalState,
  BotItemTacticalState,
  CarPose,
  KeyBindings,
  ParticipantControlMode,
  RaceParticipantId,
} from '../../types/game';

export type Vec3 = [number, number, number];
export type RapierVec = { x: number; y: number; z: number };
export type GroundHit = { collider: RapierCollider; normal: RapierVec };
export type AttachmentSurfaceKind = 'road' | 'ext';
export type SteeringChargeDirection = 'left' | 'right';
export type FlameTrailColor = 'blue' | 'orange';
export type GroundHitOptions = {
  filter?: (candidate: RapierCollider) => boolean;
  preferredUp?: Vector3;
  minNormalDot?: number;
  maxRetries?: number;
  fallbackToFirstHit?: boolean;
};

export type SurfaceAttachmentConfig = {
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

export type BoosterConfig = {
  model?: string;
  duration?: number;
  strength?: number;
};

export type Props = {
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
  maxYawRate?: number;
  controlMode?: ParticipantControlMode;
  remotePose?: CarPose | null;
  onPoseUpdate?: (participantId: RaceParticipantId, pose: CarPose) => void;
  participantId?: RaceParticipantId;
  participantName?: string;
  myObject?: number;
  myObjectCharges?: number;
  coinCount?: number;
  thunderDebuffUntilTimestampMs?: number;
  bulletBillUntilTimestampMs?: number;
  stunUntilTimestampMs?: number;
  botItemTacticalState?: BotItemTacticalState | null;
  botDrivingTacticalState?: BotDrivingTacticalState | null;
  objectItemMaxValue?: number;
  miniObjectModelPaths?: readonly string[];
  onObjectUsed?: (participantId: RaceParticipantId, usedObject: number) => void;
  onObjectConsumed?: (
    participantId: RaceParticipantId,
    consumedObject: number,
    consumedUnits?: number,
  ) => void;
  controlsLocked?: boolean;
  startCountdownValue?: number | null;
  onLapTrigger?: (participantId: RaceParticipantId, triggerType: 'lap-start' | 'lap-checkpoint') => void;
  surfaceAttachment?: SurfaceAttachmentConfig;
  antiGravSwitchesEnabled?: boolean;
  booster?: BoosterConfig;
  botWaypoints?: readonly import('../../ai/botAutopilot').BotWaypoint[];
  autopilotCourseKey?: string;
};
