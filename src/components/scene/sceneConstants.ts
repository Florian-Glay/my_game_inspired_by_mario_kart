import type { CircuitId, HumanPlayerSlotId } from '../../types/game';
import type { PlayerLapProgress } from './sceneTypes';

export const DAY_CLEAR_COLOR = '#7ec3ff';
export const SUN_POSITION: [number, number, number] = [220, 180, -360];
export const CLOUD_WRAP_X = 620;
export const CLOUD_FAR_Z = -420;
export const CLOUD_NEAR_Z = 160;
export const TINY_VIEWPORT_AREA = 420_000;
export const MEDIUM_VIEWPORT_AREA = 820_000;
export const BOT_OVERTAKE_MAX_DISTANCE = 26;
export const BOT_OVERTAKE_MAX_WAYPOINT_STEPS = 5;
export const BOT_OVERTAKE_DIRECTION_LOOKAHEAD = 3;
export const BOT_OVERTAKE_FUTURE_TURN_LOOKAHEAD = 6;
export const BOT_OVERTAKE_LATERAL_DEADZONE = 0.9;
export const BOT_OVERTAKE_LANE_OFFSET_MIN = 1.8;
export const BOT_OVERTAKE_LANE_OFFSET_MAX = 3.2;
export const BOT_OVERTAKE_TURN_BIAS_THRESHOLD = 0.14;
export const WAYPOINT_NODE_NAME_RE = /^WP_(\d+)$/i;

export const FALLBACK_PROGRESS: PlayerLapProgress = {
  lap: 1,
  checkpoint: false,
  finished: false,
  finishTimestamp: null,
};
export const START_COUNTDOWN_INITIAL = 3;
export const START_COUNTDOWN_CHARGE_HINT_FROM = 2;
export const START_COUNTDOWN_TICK_MS = 1000;
export const START_COUNTDOWN_ZERO_HOLD_MS = 450;
export const NETWORK_START_GO_HOLD_MS = 2_000;
export const LOADING_OVERLAY_FADE_MS = 500;
export const START_COUNTDOWN_DELAY_AFTER_LOADING_MS = 1500;
export const LIVE_SCOREBOARD_REFRESH_MS = 280;
export const COURSE_RESULT_OVERLAY_MS = 10_000;
export const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];
export const OBJECT_CRATE_MODEL_PATH = 'models/item_box.glb';
export const TRACK_COIN_MODEL_PATH = 'models/miniObject/itemCoin.glb';
export const TRACK_COIN_COLLIDER_HALF_EXTENTS: [number, number, number] = [0.75, 0.75, 0.75];
export const OBJECT_ITEM_MIN_VALUE = 1;
export const OBJECT_ITEM_MAX_VALUE = 13;
export const OBJECT_MUSHROOM_VALUE = 2;
export const OBJECT_BANANA_VALUE = 3;
export const OBJECT_TRIPLE_BANANA_VALUE = 4;
export const OBJECT_GREEN_SHELL_VALUE = 5;
export const OBJECT_TRIPLE_GREEN_SHELL_VALUE = 6;
export const OBJECT_RED_SHELL_VALUE = 7;
export const OBJECT_TRIPLE_RED_SHELL_VALUE = 8;
export const OBJECT_BLUE_SHELL_VALUE = 9;
export const OBJECT_BLUE_SHELL_ELIGIBLE_MIN_POSITION = 7;
export const OBJECT_BOMB_VALUE = 10;
export const OBJECT_THROWABLE_VALUES = [3, 4, 5, 6, 7, 8, 9, 10, 12] as const;
export const OBJECT_BULLET_BILL_VALUE = 11;
export const OBJECT_BULLET_BILL_ELIGIBLE_MIN_POSITION = 11;
export const OBJECT_BULLET_BILL_DURATION_SECONDS = 15;
export const OBJECT_COIN_VALUE = 13;
export const PLAYER_COIN_MAX = 10;
export const OBJECT_MUSHROOM_INITIAL_CHARGES = 3;
export const OBJECT_TRIPLE_BANANA_INITIAL_CHARGES = 3;
export const OBJECT_TRIPLE_GREEN_SHELL_INITIAL_CHARGES = 3;
export const OBJECT_TRIPLE_RED_SHELL_INITIAL_CHARGES = 3;
export const OBJECT_DEFAULT_INITIAL_CHARGES = 1;
export const OBJECT_AVAILABLE_ITEM_VALUES = [
  1,
  OBJECT_MUSHROOM_VALUE,
  OBJECT_BANANA_VALUE,
  OBJECT_TRIPLE_BANANA_VALUE,
  OBJECT_GREEN_SHELL_VALUE,
  OBJECT_TRIPLE_GREEN_SHELL_VALUE,
  OBJECT_RED_SHELL_VALUE,
  OBJECT_TRIPLE_RED_SHELL_VALUE,
  OBJECT_BLUE_SHELL_VALUE,
  OBJECT_BOMB_VALUE,
  OBJECT_BULLET_BILL_VALUE,
  OBJECT_COIN_VALUE,
] as const;
export const COIN_HUD_ICON_PATH = 'ui/object/objet-13.png';
export const OBJECT_BANANA_MODEL_PATH = 'models/miniObject/itemBanana.glb';
export const OBJECT_GREEN_SHELL_MODEL_PATH = 'models/miniObject/itemGreenShell.glb';
export const OBJECT_RED_SHELL_MODEL_PATH = 'models/miniObject/itemRedShell.glb';
export const OBJECT_BLUE_SHELL_MODEL_PATH = 'models/miniObject/itemBlueShell.glb';
export const OBJECT_BOMB_MODEL_PATH = 'models/miniObject/itemBomb.glb';
export const OBJECT_THROWABLE_LIFETIME_MS = 30_000;
export const OBJECT_THROWABLE_HIT_STUN_DURATION_MS = 1000;
export const OBJECT_BANANA_FORWARD_SPEED = 100;
export const OBJECT_BANANA_UPWARD_SPEED = 12.5;
export const OBJECT_BANANA_SPAWN_FORWARD_OFFSET = 2.2;
export const OBJECT_BANANA_SPAWN_UP_OFFSET = 1.6;
export const OBJECT_GREEN_SHELL_SPEED_MULTIPLIER = 2;
export const OBJECT_GREEN_SHELL_MIN_SPEED = 0;
export const OBJECT_GREEN_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
export const OBJECT_GREEN_SHELL_SPAWN_UP_OFFSET = 0.9;
export const OBJECT_RED_SHELL_SPEED_MULTIPLIER = 2;
export const OBJECT_RED_SHELL_MIN_SPEED = 0;
export const OBJECT_RED_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
export const OBJECT_RED_SHELL_SPAWN_UP_OFFSET = 0.9;
export const OBJECT_RED_SHELL_TARGET_RADIUS = 30;
export const OBJECT_BLUE_SHELL_SPEED_MULTIPLIER = 2;
export const OBJECT_BLUE_SHELL_MIN_SPEED = 0;
export const OBJECT_BLUE_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
export const OBJECT_BLUE_SHELL_SPAWN_UP_OFFSET = 0.9;
export const OBJECT_BOMB_SPEED_MULTIPLIER = 2;
export const OBJECT_BOMB_MIN_FORWARD_SPEED = 30;
export const OBJECT_BOMB_TARGET_DISTANCE = 100;
export const OBJECT_BOMB_SPAWN_FORWARD_OFFSET = 3.2;
export const OBJECT_BOMB_SPAWN_UP_OFFSET = 2.4;
export const OBJECT_BOMB_GRAVITY = 9.81;
export const DEFAULT_CHARACTER_PORTRAIT_PATH = 'ui/select/character/mario.png';
export const COURSE_POINTS_BY_POSITION = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
export const LIVE_SCOREBOARD_FINISH_WAYPOINT_BY_CIRCUIT: Record<CircuitId, number> = {
  kalimari_desert: 12,
  super_bell_subway: 5,
  stadium: 239,
  ds_mario_circuit: 75,
};
export const OBJECT_THROWABLE_VALUE_SET = new Set<number>(OBJECT_THROWABLE_VALUES);
