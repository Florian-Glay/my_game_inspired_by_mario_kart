import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Plane, Vector3 } from 'three';
import { PERF_PROFILE } from '../config/performanceProfile';
import { carPosition, carRotationY } from '../state/car';
import { gameMode } from '../state/gamemode';
import type { CarPose } from '../types/game';
import { updateForwardClipPlane } from './cameraClipPlane';

type CameraControllerProps = {
  targetPoseRef?: MutableRefObject<CarPose>;
  clipPlaneOffset?: number;
  enableClipPlane?: boolean;
};

const BOOST_FOV_DELTA = 5;
const BOOST_FOV_IN_SPEED = 20;
const BOOST_FOV_OUT_SPEED = 10;

export function CameraController({
  targetPoseRef,
  clipPlaneOffset = PERF_PROFILE.clipPlaneOffset,
  enableClipPlane = PERF_PROFILE.enableCameraClipPlane,
}: CameraControllerProps) {
  const { camera, gl } = useThree();
  const angleRef = useRef(0);
  const targetAngleRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastMouseXRef = useRef(0);
  const lastMouseYRef = useRef(0);
  const targetPitchRef = useRef(0);

  const radius = 8;
  const height = 5;

  // Smoothing targets to avoid visual stutter when the car moves fast.
  const smoothPos = useRef(new Vector3());
  const smoothLookAt = useRef(new Vector3());
  const smoothUp = useRef(new Vector3(0, 1, 0));
  const desiredPos = useRef(new Vector3());
  const desiredLookAt = useRef(new Vector3());
  const desiredUp = useRef(new Vector3(0, 1, 0));

  // Free camera state.
  const freeKeysRef = useRef({ forward: false, back: false, left: false, right: false, up: false, down: false });
  const pitchRef = useRef(0);
  const freeSpeed = 10;

  const tmpForward = useRef(new Vector3());
  const tmpRight = useRef(new Vector3());
  const tmpMove = useRef(new Vector3());
  const tmpCarForward = useRef(new Vector3());
  const tmpCarUp = useRef(new Vector3());
  const upAxis = useMemo(() => new Vector3(0, 1, 0), []);
  const clipPlaneRef = useRef(new Plane());
  const baseFovRef = useRef(camera.fov);

  useEffect(() => {
    baseFovRef.current = camera.fov;
    camera.near = PERF_PROFILE.cameraNear;
    camera.far = PERF_PROFILE.cameraFar;
    camera.updateProjectionMatrix();
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      lastMouseXRef.current = e.clientX;
      lastMouseYRef.current = e.clientY;
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const deltaX = e.clientX - lastMouseXRef.current;
        const deltaY = e.clientY - lastMouseYRef.current;
        targetAngleRef.current -= deltaX * 0.005;
        targetPitchRef.current += deltaY * 0.005;
        const maxPitch = Math.PI / 2 - 0.1;
        targetPitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, targetPitchRef.current));
        lastMouseXRef.current = e.clientX;
        lastMouseYRef.current = e.clientY;
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      isDraggingRef.current = true;
      lastMouseXRef.current = e.touches[0].clientX;
      lastMouseYRef.current = e.touches[0].clientY;
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDraggingRef.current && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - lastMouseXRef.current;
        const deltaY = e.touches[0].clientY - lastMouseYRef.current;
        targetAngleRef.current -= deltaX * 0.005;
        targetPitchRef.current += deltaY * 0.005;
        const maxPitch = Math.PI / 2 - 0.1;
        targetPitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, targetPitchRef.current));
        lastMouseXRef.current = e.touches[0].clientX;
        lastMouseYRef.current = e.touches[0].clientY;
      }
    };

    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'z' || k === 'arrowup') freeKeysRef.current.forward = true;
      if (k === 's' || k === 'arrowdown') freeKeysRef.current.back = true;
      if (k === 'a' || k === 'q' || k === 'arrowleft') freeKeysRef.current.left = true;
      if (k === 'd' || k === 'arrowright') freeKeysRef.current.right = true;
      if (k === ' ') freeKeysRef.current.up = true;
      if (k === 'shift') freeKeysRef.current.down = true;
    };

    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'z' || k === 'arrowup') freeKeysRef.current.forward = false;
      if (k === 's' || k === 'arrowdown') freeKeysRef.current.back = false;
      if (k === 'a' || k === 'q' || k === 'arrowleft') freeKeysRef.current.left = false;
      if (k === 'd' || k === 'arrowright') freeKeysRef.current.right = false;
      if (k === ' ') freeKeysRef.current.up = false;
      if (k === 'shift') freeKeysRef.current.down = false;
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchmove', handleTouchMove);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [gl]);

  useEffect(
    () => () => {
      gl.clippingPlanes = [];
    },
    [gl],
  );

  useFrame((state, delta) => {
    angleRef.current += (targetAngleRef.current - angleRef.current) * 0.08;
    pitchRef.current += (targetPitchRef.current - pitchRef.current) * 0.08;

    if (gameMode.current === 'run') {
      const lookAtTargetY = 1.5;

      const pose = targetPoseRef?.current;
      const carX = pose?.x ?? carPosition.x;
      const carY = pose?.y ?? carPosition.y;
      const carZ = pose?.z ?? carPosition.z;
      const yaw = pose?.yaw ?? carRotationY.current;
      const carForward = tmpCarForward.current;
      if (
        typeof pose?.forwardX === 'number' &&
        typeof pose?.forwardY === 'number' &&
        typeof pose?.forwardZ === 'number'
      ) {
        carForward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
      } else {
        carForward.set(Math.sin(yaw), 0, Math.cos(yaw));
      }
      if (carForward.lengthSq() < 0.0001) carForward.set(Math.sin(yaw), 0, Math.cos(yaw));
      carForward.normalize();

      const carUp = tmpCarUp.current;
      if (typeof pose?.upX === 'number' && typeof pose?.upY === 'number' && typeof pose?.upZ === 'number') {
        carUp.set(pose.upX, pose.upY, pose.upZ);
      } else {
        carUp.copy(upAxis);
      }
      if (carUp.lengthSq() < 0.0001) carUp.copy(upAxis);
      carUp.normalize();

      desiredPos.current
        .set(carX, carY, carZ)
        .addScaledVector(carForward, -radius)
        .addScaledVector(carUp, height);
      desiredLookAt.current.set(carX, carY, carZ).addScaledVector(carUp, lookAtTargetY);
      desiredUp.current.copy(carUp);

      const camAlpha = 1 - Math.exp(-8 * Math.min(delta, 0.05));
      smoothPos.current.lerp(desiredPos.current, camAlpha);
      smoothLookAt.current.lerp(desiredLookAt.current, camAlpha);
      smoothUp.current.lerp(desiredUp.current, camAlpha).normalize();

      camera.up.copy(smoothUp.current);
      camera.position.copy(smoothPos.current);
      camera.lookAt(smoothLookAt.current);
    } else {
      const forward = tmpForward.current.set(-Math.sin(angleRef.current), 0, -Math.cos(angleRef.current));
      const right = tmpRight.current.crossVectors(forward, upAxis).normalize();
      const move = tmpMove.current.set(0, 0, 0);

      if (freeKeysRef.current.forward) move.add(forward);
      if (freeKeysRef.current.back) move.sub(forward);
      if (freeKeysRef.current.left) move.sub(right);
      if (freeKeysRef.current.right) move.add(right);
      if (freeKeysRef.current.up) move.y += 1;
      if (freeKeysRef.current.down) move.y -= 1;

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(freeSpeed * delta);
        camera.position.add(move);
      }

      camera.up.copy(upAxis);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = angleRef.current;
      camera.rotation.x = pitchRef.current;
    }

    const boostActive = gameMode.current === 'run' && Boolean(targetPoseRef?.current?.boostActive);
    const targetFov = baseFovRef.current + (boostActive ? BOOST_FOV_DELTA : 0);
    const fovRate = boostActive ? BOOST_FOV_IN_SPEED : BOOST_FOV_OUT_SPEED;
    const fovAlpha = 1 - Math.exp(-fovRate * Math.min(delta, 0.05));
    const nextFov = camera.fov + (targetFov - camera.fov) * fovAlpha;
    if (Math.abs(nextFov - camera.fov) > 0.0001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }

    if (enableClipPlane) {
      updateForwardClipPlane(camera, clipPlaneRef.current, clipPlaneOffset);
      state.gl.clippingPlanes = [clipPlaneRef.current];
    } else if (state.gl.clippingPlanes.length > 0) {
      state.gl.clippingPlanes = [];
    }
  });

  return null;
}
