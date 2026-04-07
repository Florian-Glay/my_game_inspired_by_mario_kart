import type { HumanPlayerSlotId } from '../types/game';

export const HUMAN_NETWORK_POSE_PUBLISH_INTERVAL_MS = 33;
export const BOT_NETWORK_POSE_PUBLISH_INTERVAL_MS = 100;

export const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];
export const GRAND_PRIX_POINTS_BY_POSITION = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
export const ONLINE_PLAYER_NAME_STORAGE_KEY = 'mk-online-player-name';
