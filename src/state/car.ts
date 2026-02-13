import { Vector3 } from 'three';

// Mutable shared state to allow the camera controller to follow the car
export const carPosition = new Vector3(0, 0, 0);
export const carRotationY = { current: 0 };
