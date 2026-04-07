import { MULTIPLAYER_MAX_PLAYERS } from '../../../shared/multiplayerProtocol.ts';

export const PORT = Number.parseInt(process.env.MULTIPLAYER_PORT ?? process.env.PORT ?? '8787', 10);
export const HOST = process.env.MULTIPLAYER_HOST ?? '0.0.0.0';
export const WS_PATH = process.env.MULTIPLAYER_WS_PATH ?? '/ws';
export const MAX_WS_PAYLOAD_BYTES = Number.parseInt(
  process.env.MULTIPLAYER_MAX_WS_PAYLOAD_BYTES ?? '65536',
  10,
);
export const RACE_SNAPSHOT_INTERVAL_MS = Number.parseInt(
  process.env.MULTIPLAYER_RACE_SNAPSHOT_INTERVAL_MS ?? '33',
  10,
);
export const ALLOWED_ORIGINS = (process.env.MULTIPLAYER_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
export const MULTIPLAYER_ONLINE_BOT_TARGET = Math.max(
  0,
  Math.min(
    MULTIPLAYER_MAX_PLAYERS,
    Number.parseInt(process.env.MULTIPLAYER_ONLINE_BOT_TARGET ?? `${MULTIPLAYER_MAX_PLAYERS}`, 10) || 0,
  ),
);
