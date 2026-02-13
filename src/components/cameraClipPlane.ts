import type { Camera, Plane } from 'three';
import { Vector3 } from 'three';

const tmpForward = new Vector3();
const tmpOrigin = new Vector3();

export function updateForwardClipPlane(camera: Camera, plane: Plane, offset: number) {
  camera.getWorldDirection(tmpForward);
  tmpOrigin.copy(camera.position).addScaledVector(tmpForward, offset);
  plane.setFromNormalAndCoplanarPoint(tmpForward, tmpOrigin);
}
