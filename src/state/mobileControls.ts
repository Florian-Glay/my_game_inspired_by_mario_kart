export type MobileControlState = {
  steer: number;
  throttle: number;
  useObjectPressed: boolean;
  driftPressed: boolean;
};

export function createMobileControlState(): MobileControlState {
  return {
    steer: 0,
    throttle: 0,
    useObjectPressed: false,
    driftPressed: false,
  };
}

export function resetMobileControlState(controls: MobileControlState) {
  controls.steer = 0;
  controls.throttle = 0;
  controls.useObjectPressed = false;
  controls.driftPressed = false;
}
