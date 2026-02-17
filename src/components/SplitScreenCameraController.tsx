import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Plane, Vector3 } from 'three';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type { CarPose } from '../types/game';
import { updateForwardClipPlane } from './cameraClipPlane';

type SplitScreenCameraControllerProps = {
  leftPoseRef: MutableRefObject<CarPose>;
  rightPoseRef: MutableRefObject<CarPose>;
  clipPlaneOffset?: number;
  enableClipPlane?: boolean;
};

const FOLLOW_RADIUS = 8;
const FOLLOW_HEIGHT = 5;
const LOOK_AT_HEIGHT = 1.5;
const CAMERA_SMOOTH_SPEED = 8;
const BOOST_FOV_DELTA = 5;
const BOOST_FOV_IN_SPEED = 20;
const BOOST_FOV_OUT_SPEED = 10;

function followCar(
  camera: PerspectiveCamera,
  pose: CarPose,
  smoothPos: Vector3,
  smoothLookAt: Vector3,
  smoothUp: Vector3,
  desiredPos: Vector3,
  desiredLookAt: Vector3,
  desiredUp: Vector3,
  tmpForward: Vector3,
  tmpUp: Vector3,
  worldUp: Vector3,
  delta: number,
) {
  if (
    typeof pose.forwardX === 'number' &&
    typeof pose.forwardY === 'number' &&
    typeof pose.forwardZ === 'number'
  ) {
    tmpForward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
  } else {
    tmpForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  }
  if (tmpForward.lengthSq() < 0.0001) tmpForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  tmpForward.normalize();

  if (typeof pose.upX === 'number' && typeof pose.upY === 'number' && typeof pose.upZ === 'number') {
    tmpUp.set(pose.upX, pose.upY, pose.upZ);
  } else {
    tmpUp.copy(worldUp);
  }
  if (tmpUp.lengthSq() < 0.0001) tmpUp.copy(worldUp);
  tmpUp.normalize();

  desiredPos
    .set(pose.x, pose.y, pose.z)
    .addScaledVector(tmpForward, -FOLLOW_RADIUS)
    .addScaledVector(tmpUp, FOLLOW_HEIGHT);
  desiredLookAt.set(pose.x, pose.y, pose.z).addScaledVector(tmpUp, LOOK_AT_HEIGHT);
  desiredUp.copy(tmpUp);

  const alpha = Math.min(1, CAMERA_SMOOTH_SPEED * delta);
  smoothPos.lerp(desiredPos, alpha);
  smoothLookAt.lerp(desiredLookAt, alpha);
  smoothUp.lerp(desiredUp, alpha).normalize();

  camera.up.copy(smoothUp);
  camera.position.copy(smoothPos);
  camera.lookAt(smoothLookAt);
}

function updateBoostFov(camera: PerspectiveCamera, baseFov: number, boostActive: boolean, delta: number) {
  const targetFov = baseFov + (boostActive ? BOOST_FOV_DELTA : 0);
  const fovRate = boostActive ? BOOST_FOV_IN_SPEED : BOOST_FOV_OUT_SPEED;
  const alpha = 1 - Math.exp(-fovRate * Math.min(delta, 0.05));
  const nextFov = camera.fov + (targetFov - camera.fov) * alpha;
  if (Math.abs(nextFov - camera.fov) > 0.0001) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
}

export function SplitScreenCameraController({
  leftPoseRef,
  rightPoseRef,
  clipPlaneOffset = PERF_PROFILE.clipPlaneOffset,
  enableClipPlane = PERF_PROFILE.enableCameraClipPlane,
}: SplitScreenCameraControllerProps) {
  const gl = useThree((state) => state.gl);
  const leftCamera = useMemo(
    () => new PerspectiveCamera(70, 1, PERF_PROFILE.cameraNear, PERF_PROFILE.cameraFar),
    [],
  );
  const rightCamera = useMemo(
    () => new PerspectiveCamera(70, 1, PERF_PROFILE.cameraNear, PERF_PROFILE.cameraFar),
    [],
  );
  const leftBaseFovRef = useRef(leftCamera.fov);
  const rightBaseFovRef = useRef(rightCamera.fov);

  const leftSmoothPos = useRef(new Vector3());
  const leftSmoothLookAt = useRef(new Vector3());
  const leftSmoothUp = useRef(new Vector3(0, 1, 0));
  const rightSmoothPos = useRef(new Vector3());
  const rightSmoothLookAt = useRef(new Vector3());
  const rightSmoothUp = useRef(new Vector3(0, 1, 0));
  const leftDesiredPos = useRef(new Vector3());
  const leftDesiredLookAt = useRef(new Vector3());
  const leftDesiredUp = useRef(new Vector3(0, 1, 0));
  const rightDesiredPos = useRef(new Vector3());
  const rightDesiredLookAt = useRef(new Vector3());
  const rightDesiredUp = useRef(new Vector3(0, 1, 0));
  const leftTmpForward = useRef(new Vector3());
  const leftTmpUp = useRef(new Vector3());
  const rightTmpForward = useRef(new Vector3());
  const rightTmpUp = useRef(new Vector3());
  const worldUp = useMemo(() => new Vector3(0, 1, 0), []);

  const leftClipPlane = useRef(new Plane());
  const rightClipPlane = useRef(new Plane());

  useEffect(
    () => () => {
      leftCamera.removeFromParent();
      rightCamera.removeFromParent();
    },
    [leftCamera, rightCamera],
  );

  useEffect(
    () => () => {
      gl.autoClear = true;
      gl.setScissorTest(false);
      gl.clippingPlanes = [];
    },
    [gl],
  );

  useFrame((state, delta) => {
    if (gameMode.current !== 'run') {
      gameMode.current = 'run';
    }

    const { gl, scene, size } = state;
    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));
    const leftWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(1, width - leftWidth);

    leftCamera.aspect = leftWidth / height;
    rightCamera.aspect = rightWidth / height;
    leftCamera.updateProjectionMatrix();
    rightCamera.updateProjectionMatrix();

    followCar(
      leftCamera,
      leftPoseRef.current,
      leftSmoothPos.current,
      leftSmoothLookAt.current,
      leftSmoothUp.current,
      leftDesiredPos.current,
      leftDesiredLookAt.current,
      leftDesiredUp.current,
      leftTmpForward.current,
      leftTmpUp.current,
      worldUp,
      delta,
    );

    updateBoostFov(
      leftCamera,
      leftBaseFovRef.current,
      Boolean(leftPoseRef.current?.boostActive),
      delta,
    );
    updateBoostFov(
      rightCamera,
      rightBaseFovRef.current,
      Boolean(rightPoseRef.current?.boostActive),
      delta,
    );
    followCar(
      rightCamera,
      rightPoseRef.current,
      rightSmoothPos.current,
      rightSmoothLookAt.current,
      rightSmoothUp.current,
      rightDesiredPos.current,
      rightDesiredLookAt.current,
      rightDesiredUp.current,
      rightTmpForward.current,
      rightTmpUp.current,
      worldUp,
      delta,
    );

    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.clear();

    gl.setViewport(0, 0, leftWidth, height);
    gl.setScissor(0, 0, leftWidth, height);
    if (enableClipPlane) {
      updateForwardClipPlane(leftCamera, leftClipPlane.current, clipPlaneOffset);
      gl.clippingPlanes = [leftClipPlane.current];
    } else if (gl.clippingPlanes.length > 0) {
      gl.clippingPlanes = [];
    }
    gl.render(scene, leftCamera);

    gl.setViewport(leftWidth, 0, rightWidth, height);
    gl.setScissor(leftWidth, 0, rightWidth, height);
    if (enableClipPlane) {
      updateForwardClipPlane(rightCamera, rightClipPlane.current, clipPlaneOffset);
      gl.clippingPlanes = [rightClipPlane.current];
    } else if (gl.clippingPlanes.length > 0) {
      gl.clippingPlanes = [];
    }
    gl.render(scene, rightCamera);

    gl.clippingPlanes = [];
    gl.setScissorTest(false);
    gl.setViewport(0, 0, width, height);
  }, 1);

  return null;
}
