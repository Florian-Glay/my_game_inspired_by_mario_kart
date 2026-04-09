import type { HumanPlayerSlotId } from '../types/game';

const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];

export const GAMEPAD_BUTTON_A = 0;
export const GAMEPAD_BUTTON_B = 1;
export const GAMEPAD_BUTTON_LEFT_TRIGGER = 6;
export const GAMEPAD_BUTTON_RIGHT_TRIGGER = 7;
export const GAMEPAD_AXIS_LEFT_X = 0;
export const GAMEPAD_AXIS_LEFT_Y = 1;

export const DEFAULT_GAMEPAD_AXIS_DEADZONE = 0.28;
export const DEFAULT_GAMEPAD_TRIGGER_THRESHOLD = 0.5;

export function getConnectedGamepads(): Gamepad[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return [];
  }

  return Array.from(navigator.getGamepads())
    .filter((gamepad): gamepad is Gamepad => Boolean(gamepad && gamepad.connected))
    .sort((left, right) => left.index - right.index);
}

export function getGamepadByHumanSlot(humanSlotId?: HumanPlayerSlotId | null): Gamepad | null {
  const connectedGamepads = getConnectedGamepads();
  if (connectedGamepads.length === 0) return null;

  const slotIndex =
    humanSlotId ? HUMAN_SLOT_ORDER.indexOf(humanSlotId) : 0;
  const safeSlotIndex = slotIndex >= 0 ? slotIndex : 0;

  return connectedGamepads[safeSlotIndex] ?? null;
}

export function isGamepadButtonPressed(
  button: GamepadButton | undefined,
  threshold = DEFAULT_GAMEPAD_TRIGGER_THRESHOLD,
) {
  if (!button) return false;
  return button.pressed || button.value >= threshold;
}

export function readGamepadAxis(
  gamepad: Gamepad | null,
  axisIndex: number,
  deadzone = DEFAULT_GAMEPAD_AXIS_DEADZONE,
) {
  if (!gamepad) return 0;
  const rawValue = gamepad.axes[axisIndex] ?? 0;
  if (!Number.isFinite(rawValue)) return 0;
  return Math.abs(rawValue) >= deadzone ? rawValue : 0;
}
