import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  resetMobileControlState,
  type MobileControlState,
} from '../state/mobileControls';

type MobileRaceControlsProps = {
  controls: MobileControlState;
  disabled?: boolean;
  hasObject?: boolean;
};

const JOYSTICK_DEAD_ZONE = 0.12;

function applyDeadZone(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= JOYSTICK_DEAD_ZONE) return 0;
  return Math.sign(value) * ((magnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE));
}

export function MobileRaceControls({
  controls,
  disabled = false,
  hasObject = false,
}: MobileRaceControlsProps) {
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const [stickPosition, setStickPosition] = useState({ x: 0, y: 0 });
  const [driftActive, setDriftActive] = useState(false);
  const [objectActive, setObjectActive] = useState(false);

  const resetJoystick = () => {
    joystickPointerIdRef.current = null;
    controls.steer = 0;
    controls.throttle = 0;
    setStickPosition({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (!disabled) return;
    resetMobileControlState(controls);
    setStickPosition({ x: 0, y: 0 });
    setDriftActive(false);
    setObjectActive(false);
    joystickPointerIdRef.current = null;
  }, [controls, disabled]);

  useEffect(
    () => () => {
      resetMobileControlState(controls);
    },
    [controls],
  );

  const updateJoystick = (clientX: number, clientY: number) => {
    const element = joystickRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const rawX = (clientX - (rect.left + rect.width / 2)) / radius;
    const rawY = (clientY - (rect.top + rect.height / 2)) / radius;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > 1 ? 1 / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;

    setStickPosition({ x, y });
    // The vehicle uses positive steering values for left turns.
    controls.steer = -applyDeadZone(x);
    controls.throttle = -applyDeadZone(y);
  };

  const handleJoystickDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || joystickPointerIdRef.current !== null) return;
    event.preventDefault();
    joystickPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  };

  const handleJoystickMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || joystickPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateJoystick(event.clientX, event.clientY);
  };

  const handleJoystickEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    resetJoystick();
  };

  const setActionPressed = (
    action: 'object' | 'drift',
    pressed: boolean,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    if (disabled) return;
    if (pressed) event.currentTarget.setPointerCapture(event.pointerId);

    if (action === 'object') {
      controls.useObjectPressed = pressed;
      setObjectActive(pressed);
      return;
    }

    controls.driftPressed = pressed;
    setDriftActive(pressed);
  };

  return (
    <div
      className={`mk-mobile-controls${disabled ? ' is-disabled' : ''}`}
      aria-label="Commandes tactiles de course"
    >
      <div className="mk-mobile-joystick-wrap">
        <div
          ref={joystickRef}
          className="mk-mobile-joystick"
          role="group"
          aria-label="Joystick : diriger, accélérer et freiner"
          onPointerDown={handleJoystickDown}
          onPointerMove={handleJoystickMove}
          onPointerUp={handleJoystickEnd}
          onPointerCancel={handleJoystickEnd}
          onLostPointerCapture={handleJoystickEnd}
        >
          <span className="mk-mobile-joystick-arrow is-up" aria-hidden>▲</span>
          <span className="mk-mobile-joystick-arrow is-down" aria-hidden>▼</span>
          <span
            className="mk-mobile-joystick-stick"
            style={{
              transform: `translate(calc(-50% + ${stickPosition.x * 44}%), calc(-50% + ${stickPosition.y * 44}%))`,
            }}
            aria-hidden
          />
        </div>
        <span className="mk-mobile-control-caption">Conduire</span>
      </div>

      <div className="mk-mobile-actions">
        <button
          type="button"
          className={`mk-mobile-action mk-mobile-action--object${objectActive ? ' is-active' : ''}${hasObject ? ' has-object' : ''}`}
          aria-label="Lancer l’objet"
          onPointerDown={(event) => setActionPressed('object', true, event)}
          onPointerUp={(event) => setActionPressed('object', false, event)}
          onPointerCancel={(event) => setActionPressed('object', false, event)}
          onLostPointerCapture={(event) => setActionPressed('object', false, event)}
        >
          <span className="mk-mobile-action-icon" aria-hidden>◆</span>
          <span>Objet</span>
        </button>
        <button
          type="button"
          className={`mk-mobile-action mk-mobile-action--drift${driftActive ? ' is-active' : ''}`}
          aria-label="Maintenir pour déraper"
          onPointerDown={(event) => setActionPressed('drift', true, event)}
          onPointerUp={(event) => setActionPressed('drift', false, event)}
          onPointerCancel={(event) => setActionPressed('drift', false, event)}
          onLostPointerCapture={(event) => setActionPressed('drift', false, event)}
        >
          <span className="mk-mobile-action-icon" aria-hidden>↝</span>
          <span>Dérapage</span>
        </button>
      </div>
    </div>
  );
}
