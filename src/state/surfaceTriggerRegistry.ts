type SurfaceTriggerType = 'anti-grav-in' | 'anti-grav-out' | 'booster';

const colliderTriggerByHandle = new Map<number, SurfaceTriggerType>();

export function registerSurfaceTrigger(handle: number, triggerType: SurfaceTriggerType) {
  colliderTriggerByHandle.set(handle, triggerType);
}

export function unregisterSurfaceTrigger(handle: number) {
  colliderTriggerByHandle.delete(handle);
}

export function getSurfaceTriggerType(handle: number) {
  return colliderTriggerByHandle.get(handle);
}
