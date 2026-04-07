import { CHARACTERS, VEHICLES, WHEELS } from '../../../src/config/garageCatalog.ts';
import { ALLOWED_ORIGINS } from './config.ts';
import {
  isMultiplayerBotSessionId,
  type MultiplayerParticipantItemState,
  type MultiplayerPlayerLoadout,
  type MultiplayerRaceParticipantState,
} from '../../../shared/multiplayerProtocol.ts';

export function isOriginAllowed(originHeader: string | undefined) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!originHeader) return false;
  return ALLOWED_ORIGINS.includes(originHeader);
}

export function sanitizeDisplayName(value: string) {
  const trimmed = value.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : 'Pilote';
}

export function sanitizeLoadout(loadout: MultiplayerPlayerLoadout): MultiplayerPlayerLoadout {
  return {
    characterId: loadout.characterId,
    vehicleId: loadout.vehicleId,
    wheelId: loadout.wheelId,
  };
}

export function isBotSessionId(sessionId: string) {
  return isMultiplayerBotSessionId(sessionId);
}

export function createBotLoadout(botIndex: number): MultiplayerPlayerLoadout {
  const character = CHARACTERS[botIndex % CHARACTERS.length] ?? CHARACTERS[0];
  const vehicle = VEHICLES[(botIndex * 3) % VEHICLES.length] ?? VEHICLES[0];
  const wheel = WHEELS[(botIndex * 5) % WHEELS.length] ?? WHEELS[0];

  return sanitizeLoadout({
    characterId: character?.id ?? '',
    vehicleId: vehicle?.id ?? '',
    wheelId: wheel?.id ?? '',
  });
}

export function createInitialLapProgress(): MultiplayerRaceParticipantState['lapProgress'] {
  return {
    lap: 1,
    checkpoint: false,
    finished: false,
    finishTimestamp: null,
  };
}

export function createInitialItemState(): MultiplayerParticipantItemState {
  return {
    heldObject: 0,
    objectCharges: 0,
    coins: 0,
    thunderDebuffUntilTimestampMs: 0,
    bulletBillUntilTimestampMs: 0,
    stunUntilTimestampMs: 0,
  };
}
