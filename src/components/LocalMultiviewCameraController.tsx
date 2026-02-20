import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Plane, Vector3 } from 'three';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type { CarPose } from '../types/game';
import { updateForwardClipPlane } from './cameraClipPlane';

type LocalMultiviewCameraControllerProps = {
  viewerPoseRefs: MutableRefObject<CarPose>[];
  clipPlaneOffset?: number;
  enableClipPlane?: boolean;
};

type Viewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CameraFollowState = {
  smoothPos: Vector3;
  smoothLookAt: Vector3;
  smoothUp: Vector3;
  desiredPos: Vector3;
  desiredLookAt: Vector3;
  desiredUp: Vector3;
  tmpForward: Vector3;
  tmpUp: Vector3;
  clipPlane: Plane;
};

const FOLLOW_RADIUS = 8;
const FOLLOW_HEIGHT = 5;
const LOOK_AT_HEIGHT = 1.5;
const CAMERA_SMOOTH_SPEED = 8;
const BOOST_FOV_DELTA = 5;
const BOOST_FOV_IN_SPEED = 20;
const BOOST_FOV_OUT_SPEED = 10;

function getViewports(viewerCount: number, width: number, height: number): Viewport[] {
  if (viewerCount <= 1) {
    return [{ x: 0, y: 0, width, height }];
  }

  if (viewerCount === 2) {
    const leftWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(1, width - leftWidth);
    return [
      { x: 0, y: 0, width: leftWidth, height },
      { x: leftWidth, y: 0, width: rightWidth, height },
    ];
  }

  const leftWidth = Math.max(1, Math.floor(width / 2));
  const rightWidth = Math.max(1, width - leftWidth);
  const bottomHeight = Math.max(1, Math.floor(height / 2));
  const topHeight = Math.max(1, height - bottomHeight);

  return [
    { x: 0, y: bottomHeight, width: leftWidth, height: topHeight },
    { x: leftWidth, y: bottomHeight, width: rightWidth, height: topHeight },
    { x: 0, y: 0, width: leftWidth, height: bottomHeight },
    { x: leftWidth, y: 0, width: rightWidth, height: bottomHeight },
  ];
}

function followCar(
  camera: PerspectiveCamera,
  pose: CarPose,
  state: CameraFollowState,
  worldUp: Vector3,
  delta: number,
) {
  if (
    typeof pose.forwardX === 'number' &&
    typeof pose.forwardY === 'number' &&
    typeof pose.forwardZ === 'number'
  ) {
    state.tmpForward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
  } else {
    state.tmpForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  }
  if (state.tmpForward.lengthSq() < 0.0001) {
    state.tmpForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  }
  state.tmpForward.normalize();

  if (typeof pose.upX === 'number' && typeof pose.upY === 'number' && typeof pose.upZ === 'number') {
    state.tmpUp.set(pose.upX, pose.upY, pose.upZ);
  } else {
    state.tmpUp.copy(worldUp);
  }
  if (state.tmpUp.lengthSq() < 0.0001) {
    state.tmpUp.copy(worldUp);
  }
  state.tmpUp.normalize();

  state.desiredPos
    .set(pose.x, pose.y, pose.z)
    .addScaledVector(state.tmpForward, -FOLLOW_RADIUS)
    .addScaledVector(state.tmpUp, FOLLOW_HEIGHT);
  state.desiredLookAt.set(pose.x, pose.y, pose.z).addScaledVector(state.tmpUp, LOOK_AT_HEIGHT);
  state.desiredUp.copy(state.tmpUp);

  const alpha = Math.min(1, CAMERA_SMOOTH_SPEED * delta);
  state.smoothPos.lerp(state.desiredPos, alpha);
  state.smoothLookAt.lerp(state.desiredLookAt, alpha);
  state.smoothUp.lerp(state.desiredUp, alpha).normalize();

  camera.up.copy(state.smoothUp);
  camera.position.copy(state.smoothPos);
  camera.lookAt(state.smoothLookAt);
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

function createFollowState(): CameraFollowState {
  return {
    smoothPos: new Vector3(),
    smoothLookAt: new Vector3(),
    smoothUp: new Vector3(0, 1, 0),
    desiredPos: new Vector3(),
    desiredLookAt: new Vector3(),
    desiredUp: new Vector3(0, 1, 0),
    tmpForward: new Vector3(),
    tmpUp: new Vector3(),
    clipPlane: new Plane(),
  };
}

export function LocalMultiviewCameraController({
  viewerPoseRefs,
  clipPlaneOffset = PERF_PROFILE.clipPlaneOffset,
  enableClipPlane = PERF_PROFILE.enableCameraClipPlane,
}: LocalMultiviewCameraControllerProps) {
  const gl = useThree((state) => state.gl);
  const worldUp = useMemo(() => new Vector3(0, 1, 0), []);
  const cameraCount = Math.max(1, viewerPoseRefs.length);
  const cameras = useMemo(
    () =>
      Array.from(
        { length: cameraCount },
        () => new PerspectiveCamera(70, 1, PERF_PROFILE.cameraNear, PERF_PROFILE.cameraFar),
      ),
    [cameraCount],
  );
  const baseFovRef = useRef<number[]>([]);
  const followStatesRef = useRef<CameraFollowState[]>([]);

  useEffect(() => {
    for (let i = baseFovRef.current.length; i < cameras.length; i += 1) {
      baseFovRef.current[i] = cameras[i]?.fov ?? 70;
    }
    if (followStatesRef.current.length > cameras.length) {
      followStatesRef.current.length = cameras.length;
    }
    for (let i = followStatesRef.current.length; i < cameras.length; i += 1) {
      followStatesRef.current.push(createFollowState());
    }
  }, [cameras]);

  useEffect(
    () => () => {
      for (const camera of cameras) {
        camera.removeFromParent();
      }
    },
    [cameras],
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
    if (viewerPoseRefs.length === 0) return;
    if (gameMode.current === 'free') {
      gameMode.current = 'run';
    }

    const { gl, scene, size } = state;
    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));
    const viewports = getViewports(viewerPoseRefs.length, width, height);

    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.clear();

    for (let i = 0; i < viewerPoseRefs.length; i += 1) {
      const camera = cameras[i];
      const poseRef = viewerPoseRefs[i];
      const viewport = viewports[i];
      const followState = followStatesRef.current[i];
      if (!camera || !poseRef || !viewport || !followState) continue;

      camera.aspect = viewport.width / Math.max(1, viewport.height);
      camera.updateProjectionMatrix();

      followCar(camera, poseRef.current, followState, worldUp, delta);
      updateBoostFov(
        camera,
        baseFovRef.current[i] ?? 70,
        Boolean(poseRef.current?.boostActive),
        delta,
      );

      gl.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
      if (enableClipPlane) {
        updateForwardClipPlane(camera, followState.clipPlane, clipPlaneOffset);
        gl.clippingPlanes = [followState.clipPlane];
      } else if (gl.clippingPlanes.length > 0) {
        gl.clippingPlanes = [];
      }
      gl.render(scene, camera);
    }

    gl.clippingPlanes = [];
    gl.setScissorTest(false);
    gl.setViewport(0, 0, width, height);
  }, 1);

  return null;
}
