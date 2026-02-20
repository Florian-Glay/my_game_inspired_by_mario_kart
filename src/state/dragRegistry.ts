const bodyDragMap = new Map<number, number>();
const colliderDragMap = new Map<number, number>();

const isValidHandle = (handle: unknown): handle is number =>
  typeof handle === 'number' && Number.isFinite(handle) && Number.isSafeInteger(handle) && handle >= 0;

export function registerBodyDrag(handle: number, drag: number) {
  if (!isValidHandle(handle)) return;
  bodyDragMap.set(handle, drag);
}

export function unregisterBodyDrag(handle: number) {
  if (!isValidHandle(handle)) return;
  bodyDragMap.delete(handle);
}

export function getBodyDrag(handle: number) {
  return bodyDragMap.get(handle) ?? 0;
}

export function hasBodyDrag(handle: number) {
  return bodyDragMap.has(handle);
}

export function registerColliderDrag(handle: number, drag: number) {
  if (!isValidHandle(handle)) return;
  colliderDragMap.set(handle, drag);
}

export function unregisterColliderDrag(handle: number) {
  if (!isValidHandle(handle)) return;
  colliderDragMap.delete(handle);
}

export function getColliderDrag(handle: number) {
  return colliderDragMap.get(handle) ?? 0;
}

export function hasColliderDrag(handle: number) {
  return colliderDragMap.has(handle);
}

export function clearDragRegistry() {
  bodyDragMap.clear();
  colliderDragMap.clear();
}

export default {
  bodyDragMap,
  colliderDragMap,
};
