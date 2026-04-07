import { PERF_PROFILE } from '../../config/performanceProfile';
import type { KeyBindings } from '../../types/game';
import type { BoosterConfig, SurfaceAttachmentConfig, Vec3 } from './drivableTypes';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const smoothstep01 = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const COLLIDER_COVERAGE_X = 1;
export const COLLIDER_COVERAGE_Y = 1;
export const COLLIDER_COVERAGE_Z = 1;

export const SPAWN_CLEARANCE = 0.05;

// Controller tuning (units ~= meters/seconds if your scene scale is realistic)
export const MAX_FWD = 40;
export const MAX_BACK = 25;
export const ACCEL = 20;
export const COAST = 15;
export const MAX_YAW_RATE = 1.5; // rad/s
export const MAX_CLIMB_ANGLE_DEG = 60;
// Let the car pass small mesh bumps/steps and only block on higher obstacles.
export const AUTO_STEP_HEIGHT_RATIO = 0.75;
export const AUTO_STEP_HEIGHT_MIN = 0.3;
// Keep walls blocking while allowing curb-like low obstacles.
export const AUTO_STEP_HEIGHT_MAX = 0.35;
export const AUTO_STEP_MIN_WIDTH_RATIO = 0.12;
export const AUTO_STEP_MIN_WIDTH_MIN = 0.02;
// 0..1: 0 = no tilt (always upright), 1 = full tilt to ground normal
export const GROUND_TILT_FACTOR = 0.82;
// Stabilize triangle-to-triangle ground normal noise on mesh roads.
export const GROUND_NORMAL_SMOOTHING = 22;
export const GROUND_NORMAL_DEADZONE_DOT = Math.cos((2.5 * Math.PI) / 180);
// Rotation smoothing (higher = snappier, lower = smoother). Used as a rate in an
// exponential smoothing function to compute an interpolation alpha per-step.
export const ROTATION_SMOOTHING = 20;
export const GRAVITY_ACCEL = 19.81;
export const GROUND_RAY_EXTRA_DISTANCE = 4.0;
export const GROUND_RAY_START_MARGIN = 0.3;
// Global visual Y offset relative to the collider.
// Keep this at 0 so collider-ground contact and visual mesh stay aligned by default.
export const MODEL_Y_OFFSET = 0;
// Visual-only smoothing to avoid abrupt "step pop" when autostep lifts the collider.
export const VISUAL_STEP_SMOOTHING_UP = 24;
export const VISUAL_STEP_SMOOTHING_DOWN = 30;
export const VISUAL_STEP_MAX_LAG = 0.05;
// If the hit normal diverges too much from the current attached normal, treat this as a lateral wall.
export const WALL_COLLISION_ALIGN_DOT = Math.cos((88 * Math.PI) / 180);
// In wall-guard mode keep loop slopes below vertical so side walls remain collisions.
export const WALL_GUARD_MAX_CLIMB_ANGLE_DEG = 86;
export const WALL_GUARD_SLIDE_MARGIN_DEG = 4;
export const MAX_GROUND_RAY_RETRIES = 9;
// When the car is significantly tilted, keep slope checks relative to the current car up-vector.
export const LOOPING_REFERENCE_WORLD_DOT = 0.96;
// While detached during looping, allow a wider re-attach cone based on current car orientation.
export const LOOPING_DETACHED_REATTACH_DOT = Math.cos((150 * Math.PI) / 180);
// Keep using the loop reference for a short time after contact loss to avoid instant auto-upright.
export const LOOPING_DETACH_HOLD_MS = 450;
export const WAYPOINT_RESCUE_MAX_DISTANCE = 50;
export const WAYPOINT_RESCUE_HEIGHT_OFFSET = 2;
export const WAYPOINT_RESCUE_LOOKAHEAD = 4;
export const ROAD_RESCUE_DURATION_MS = 3000;
export const ROAD_RESCUE_HOVER_PHASE = 0.65;
export const ROAD_RESCUE_LIFT_HEIGHT = 10;
export const LAKITU_BASE_SCALE = 1;
export const LAKITU_FADE_IN_SECONDS = 0.35;
export const LAKITU_FADE_OUT_SECONDS = 0.35;
export const LAKITU_FOLLOW_OFFSET_Y = 3;
export const LAKITU_POSITION_SMOOTHING = 12;
export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  forward: ['z', 'w', 'arrowup'],
  back: ['s', 'arrowdown'],
  left: ['q', 'a', 'arrowleft'],
  right: ['d', 'arrowright'],
  useObject: ['e'],
};

export const DEFAULT_CHARACTER_MOUNT: Vec3 = [0, 0.5, 0];
export const DEFAULT_WHEEL_MOUNTS: [Vec3, Vec3, Vec3, Vec3] = [
  [-0.92, 0.04, 1.14],
  [0.92, 0.04, 1.14],
  [-0.92, 0.04, -1.14],
  [0.92, 0.04, -1.14],
];

export const getWheelRotationForMount = (mount: Vec3): Vec3 =>
  mount[0] > 0 ? [0, Math.PI, 0] : [0, 0, 0];

export const DEFAULT_SURFACE_ATTACHMENT: Required<SurfaceAttachmentConfig> = {
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

export const DEFAULT_BOOSTER: Required<Pick<BoosterConfig, 'duration' | 'strength'>> = {
  duration: 1,
  strength: 2,
};
export const DEFAULT_OBJECT_ITEM_MAX_VALUE = 13;
export const OBJECT_1_BOOST_STRENGTH = 2;
export const OBJECT_1_BOOST_DURATION_MS = 1500;
export const OBJECT_2_BOOST_STRENGTH = 2;
export const OBJECT_2_BOOST_DURATION_MS = 1500;
export const OBJECT_3_BANANA_VALUE = 3;
export const OBJECT_4_TRIPLE_BANANA_VALUE = 4;
export const OBJECT_5_GREEN_SHELL_VALUE = 5;
export const OBJECT_6_TRIPLE_GREEN_SHELL_VALUE = 6;
export const OBJECT_7_RED_SHELL_VALUE = 7;
export const OBJECT_8_TRIPLE_RED_SHELL_VALUE = 8;
export const OBJECT_9_BLUE_SHELL_VALUE = 9;
export const OBJECT_10_BOMB_VALUE = 10;
export const OBJECT_11_BULLET_BILL_VALUE = 11;
export const OBJECT_13_COIN_VALUE = 13;
export const PLAYER_COIN_MAX = 10;
export const MAX_COIN_SPEED_MULTIPLIER = 1.2;
export const BULLET_BILL_SPEED_MULTIPLIER = 2;
export const THUNDER_DEBUFF_SIZE_MULTIPLIER = 0.5;
export const THUNDER_DEBUFF_SPEED_MULTIPLIER = 1 / 1.5;
export const STUN_SPIN_TOTAL_RAD = Math.PI * 2;
export const BOT_AUTO_ITEM_DECISION_MIN_DELAY_MS = 280;
export const BOT_AUTO_ITEM_DECISION_MAX_DELAY_MS = 900;
export const BOT_AUTO_ITEM_RECHECK_MS = 320;
export const BOT_AUTO_ITEM_RECHECK_JITTER_MS = 240;
export const BOT_AUTO_BOOST_SPEED_RATIO = 0.78;
export const BOT_AUTO_MUSHROOM_SPEED_RATIO = 0.88;
export const BOT_AUTO_STRAIGHT_STEER_THRESHOLD = 0.35;
export const BOT_AUTO_GREEN_SHELL_RANGE = 32;
export const BOT_AUTO_RED_SHELL_RANGE = 45;
export const BOT_AUTO_BLUE_SHELL_MIN_LEADER_DISTANCE = 20;
export const BOT_AUTO_BANANA_REAR_RANGE = 18;
export const BOT_AUTO_BOMB_AHEAD_RANGE = 55;
export const BOT_AUTO_BOMB_REAR_RANGE = 18;
export const BOT_AUTO_BULLET_BILL_MIN_POSITION = 8;
export const BOT_AUTO_BULLET_BILL_GAP_RANGE = 28;
export const BOOSTER_RETRIGGER_COOLDOWN_MS = 150;
export const START_BOOST_CHARGE_FROM_COUNTDOWN = 2;
export const START_BOOST_MAX_CHARGE_MS = 2000;
export const START_BOOST_MIN_STRENGTH = 1.1;
export const START_BOOST_MAX_STRENGTH = 1.9;
export const START_BOOST_MIN_DURATION_MS = 500;
export const START_BOOST_MAX_DURATION_MS = 1200;
export const STEER_CHARGE_DOUBLE_TAP_WINDOW_MS = 320;
export const STEER_CHARGE_NORMAL_THRESHOLD_MS = 1500;
export const STEER_CHARGE_BIG_THRESHOLD_MS = 3000;
export const STEER_CHARGE_TURN_RATE_BONUS = 0.5;
export const STEER_CHARGE_JUMP_SPEED = 2.8;
export const STEER_CHARGE_NORMAL_BOOST_STRENGTH = 1.35;
export const STEER_CHARGE_NORMAL_BOOST_DURATION_MS = 900;
export const STEER_CHARGE_BIG_BOOST_STRENGTH = 1.75;
export const STEER_CHARGE_BIG_BOOST_DURATION_MS = 1300;
export const FLAME_TRAIL_MAX_PARTICLES = 420;
export const FLAME_TRAIL_SPAWN_RATE_PER_EMITTER = 52;
export const FLAME_TRAIL_MIN_LIFETIME_SEC = 1.2;
export const FLAME_TRAIL_MAX_LIFETIME_SEC = 2.1;
export const FLAME_TRAIL_PARTICLE_SIZE = 0.28;
export const FLAME_TRAIL_BACKWARD_SPEED = 3.8;
export const FLAME_TRAIL_UPWARD_SPEED = 1.15;
export const FLAME_TRAIL_GRAVITY = -1.3;
export const FLAME_TRAIL_POSITION_JITTER = 0.06;
export const FLAME_TRAIL_LATERAL_SPEED_JITTER = 0.85;
export const FLAME_TRAIL_EMIT_UP_OFFSET = 0.22;
export const FLAME_TRAIL_EMIT_BACK_OFFSET = 0.3;
export const START_BOOST_ORANGE_TRAIL_MIN_DURATION_MS = 1600;
export const FLAME_TRAIL_ORANGE_RGB: Readonly<[number, number, number]> = [1, 0.48, 0.1];
export const FLAME_TRAIL_BLUE_RGB: Readonly<[number, number, number]> = [0.2, 0.62, 1];

export const ROAD_SURFACE_RE = /(?:^|[-_])road(?:[-_]|$)/i;
export const EXT_SURFACE_RE = /(?:^|[-_])ext(?:[-_]|$)/i;
export const ANTI_GRAV_IN_SURFACE_RE = /anti[-_ ]?grav[-_ ]?in/i;
export const ANTI_GRAV_OUT_SURFACE_RE = /anti[-_ ]?grav[-_ ]?out/i;
export const BOOSTER_SURFACE_RE = /booster/i;
export const LAP_START_SURFACE_RE = /(?:^|[-_ ])start(?:[-_ ]|$)/i;
export const LAP_CHECKPOINT_SURFACE_RE = /checkpoint/i;
export const LAP_TRIGGER_RETRIGGER_COOLDOWN_MS = 220;
export const VEHICLE_COLLIDER_EXTRA_HEIGHT = 2;

export const SHOULD_LOG_GROUND_CONTACT = PERF_PROFILE.debugGroundContact && import.meta.env.DEV;
