import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Euler, Matrix4, Quaternion, Vector3, type Group } from 'three';
import type { BotWaypoint } from '../../ai/botAutopilot';
import { PERF_PROFILE } from '../../config/performanceProfile';
import {
  CLOUD_FAR_Z,
  CLOUD_NEAR_Z,
  CLOUD_WRAP_X,
  DAY_CLEAR_COLOR,
  MEDIUM_VIEWPORT_AREA,
  TINY_VIEWPORT_AREA,
  WAYPOINT_NODE_NAME_RE,
} from './sceneConstants';
import type {
  CircuitWaypointLoaderProps,
  RendererPerformanceSample,
  WaypointTransform,
} from './sceneTypes';

type SceneAssetGateProps = {
  urls: string[];
  onReady: () => void;
};

type PhysicsWarmupGateProps = {
  enabled: boolean;
  framesToWait: number;
  onReady: () => void;
};

type CloudSeed = {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
  alpha: number;
};

type RendererStatsProbeProps = {
  enabled: boolean;
  sampleIntervalMs?: number;
  onSample: (sample: RendererPerformanceSample) => void;
};

type DprTier = 'tiny' | 'medium' | 'large';

const DPR_AREA_HYSTERESIS = 90_000;

export function SceneAssetGate({ urls, onReady }: SceneAssetGateProps) {
  useGLTF(urls);

  useEffect(() => {
    onReady();
  }, [onReady, urls]);

  return null;
}

function extractWaypointsFromScene(root: Group, transform: WaypointTransform): BotWaypoint[] {
  const transformedWaypoints: BotWaypoint[] = [];
  const circuitTransformMatrix = new Matrix4().compose(
    new Vector3(transform.position[0], transform.position[1], transform.position[2]),
    new Quaternion().setFromEuler(
      new Euler(transform.rotation[0], transform.rotation[1], transform.rotation[2]),
    ),
    new Vector3(transform.scale[0], transform.scale[1], transform.scale[2]),
  );
  const sourcePosition = new Vector3();
  const worldPosition = new Vector3();
  const seenIndices = new Set<number>();

  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const name = typeof child.name === 'string' ? child.name.trim() : '';
    const match = WAYPOINT_NODE_NAME_RE.exec(name);
    if (!match) return;

    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || seenIndices.has(index)) return;

    child.getWorldPosition(sourcePosition);
    worldPosition.copy(sourcePosition).applyMatrix4(circuitTransformMatrix);
    seenIndices.add(index);
    transformedWaypoints.push({
      index,
      position: [worldPosition.x, worldPosition.y, worldPosition.z],
    });
  });

  transformedWaypoints.sort((left, right) => left.index - right.index);
  return transformedWaypoints;
}

export function CircuitWaypointLoader({ model, transform, onReady }: CircuitWaypointLoaderProps) {
  const { scene } = useGLTF(model) as unknown as { scene: Group };

  useEffect(() => {
    onReady(extractWaypointsFromScene(scene, transform));
  }, [
    model,
    onReady,
    scene,
    transform.position[0],
    transform.position[1],
    transform.position[2],
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2],
    transform.scale[0],
    transform.scale[1],
    transform.scale[2],
  ]);

  return null;
}

export function LoadingFallback() {
  return null;
}

export function PhysicsWarmupGate({ enabled, framesToWait, onReady }: PhysicsWarmupGateProps) {
  const frameCountRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    frameCountRef.current = 0;
    doneRef.current = false;
  }, [enabled, framesToWait, onReady]);

  useFrame(() => {
    if (!enabled || doneRef.current) return;

    frameCountRef.current += 1;
    if (frameCountRef.current < Math.max(1, Math.floor(framesToWait))) return;

    doneRef.current = true;
    onReady();
  });

  return null;
}

export function RaceEnvironmentEnforcer() {
  const { gl, scene } = useThree();

  useEffect(() => {
    const clearColor = new Color(DAY_CLEAR_COLOR);
    scene.fog = null;
    scene.background = clearColor;
    gl.setClearColor(clearColor, 1);
    gl.toneMappingExposure = 1.15;
  }, [gl, scene]);

  return null;
}

export function AdaptiveViewportPerformance() {
  const { size, setDpr } = useThree();
  const lastDprRef = useRef<number | null>(null);
  const lastTierRef = useRef<DprTier | null>(null);

  const resolveTier = (viewportArea: number): DprTier => {
    const lastTier = lastTierRef.current;
    if (lastTier === 'tiny') {
      return viewportArea > TINY_VIEWPORT_AREA + DPR_AREA_HYSTERESIS ? 'medium' : 'tiny';
    }
    if (lastTier === 'medium') {
      if (viewportArea <= TINY_VIEWPORT_AREA - DPR_AREA_HYSTERESIS) return 'tiny';
      if (viewportArea > MEDIUM_VIEWPORT_AREA + DPR_AREA_HYSTERESIS) return 'large';
      return 'medium';
    }
    if (lastTier === 'large') {
      return viewportArea <= MEDIUM_VIEWPORT_AREA - DPR_AREA_HYSTERESIS ? 'medium' : 'large';
    }
    if (viewportArea <= TINY_VIEWPORT_AREA) return 'tiny';
    if (viewportArea <= MEDIUM_VIEWPORT_AREA) return 'medium';
    return 'large';
  };

  useEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const viewportArea = width * height;
    const minDpr = PERF_PROFILE.dpr[0];
    const maxDpr = PERF_PROFILE.dpr[1];
    const mediumDpr = Math.max(minDpr, Math.min(maxDpr, minDpr + (maxDpr - minDpr) * 0.55));
    const tier = resolveTier(viewportArea);
    lastTierRef.current = tier;

    const targetDpr =
      tier === 'tiny' ?
        minDpr
      : tier === 'medium' ?
        mediumDpr
      : maxDpr;

    if (lastDprRef.current !== targetDpr) {
      lastDprRef.current = targetDpr;
      setDpr(targetDpr);
    }
  }, [setDpr, size.height, size.width]);

  return null;
}

export function RendererStatsProbe({
  enabled,
  sampleIntervalMs = 500,
  onSample,
}: RendererStatsProbeProps) {
  const { gl } = useThree();
  const lastSampleAtMsRef = useRef(0);

  useEffect(() => {
    lastSampleAtMsRef.current = 0;
  }, [enabled, sampleIntervalMs]);

  useFrame((state) => {
    if (!enabled) return;

    const nowMs = state.clock.elapsedTime * 1000;
    const minIntervalMs = Math.max(120, Math.floor(sampleIntervalMs));
    if (nowMs - lastSampleAtMsRef.current < minIntervalMs) return;
    lastSampleAtMsRef.current = nowMs;

    const programCount = Array.isArray(gl.info.programs) ? gl.info.programs.length : 0;
    const glContext = gl.getContext();
    onSample({
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: programCount,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      lines: gl.info.render.lines,
      points: gl.info.render.points,
      canvasWidth: glContext.drawingBufferWidth,
      canvasHeight: glContext.drawingBufferHeight,
      pixelRatio: gl.getPixelRatio(),
    });
  });

  return null;
}

export function MovingClouds() {
  const rootRef = useRef<Group | null>(null);
  const cloudSeeds = useMemo<CloudSeed[]>(
    () =>
      Array.from({ length: 10 }, (_, index) => {
        const lane = index % 4;
        const band = Math.floor(index / 4);
        return {
          x: -CLOUD_WRAP_X + index * 72,
          y: 110 + lane * 18 + band * 8,
          z: CLOUD_FAR_Z + ((index * 93) % (CLOUD_NEAR_Z - CLOUD_FAR_Z)),
          scale: 1 + ((index * 17) % 5) * 0.15,
          speed: 12 + (index % 5) * 3.4,
          alpha: 0.62 + (index % 4) * 0.07,
        };
      }),
    [],
  );

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;

    const elapsed = state.clock.getElapsedTime();
    for (let i = 0; i < root.children.length; i += 1) {
      const cloud = root.children[i];
      const seed = cloudSeeds[i];
      if (!seed) continue;

      cloud.position.x += seed.speed * delta;
      if (cloud.position.x > CLOUD_WRAP_X) {
        cloud.position.x = -CLOUD_WRAP_X;
      }
      cloud.position.y = seed.y + Math.sin(elapsed * 0.28 + i) * 1.4;
    }
  });

  return (
    <group ref={rootRef}>
      {cloudSeeds.map((seed) => (
        <group key={`${seed.x}-${seed.z}`} position={[seed.x, seed.y, seed.z]} scale={seed.scale}>
          <mesh position={[0, 0, 0]} rotation={[0, 0, 0.08]}>
            <sphereGeometry args={[10, 20, 20]} />
            <meshStandardMaterial
              color="#ffffff"
              roughness={0.96}
              metalness={0}
              transparent
              opacity={seed.alpha}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[12, -1, 2]}>
            <sphereGeometry args={[8.5, 20, 20]} />
            <meshStandardMaterial
              color="#f5f9ff"
              roughness={0.96}
              metalness={0}
              transparent
              opacity={Math.max(0.35, seed.alpha - 0.14)}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[-11, -1.8, -1.6]}>
            <sphereGeometry args={[8.8, 20, 20]} />
            <meshStandardMaterial
              color="#f7fbff"
              roughness={0.96}
              metalness={0}
              transparent
              opacity={Math.max(0.35, seed.alpha - 0.16)}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, -4.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[14.5, 24]} />
            <meshStandardMaterial
              color="#ffffff"
              transparent
              opacity={Math.max(0.18, seed.alpha - 0.38)}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
