import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { BufferGeometry, Group, Mesh } from 'three';
import { Sphere, Vector3 } from 'three';
import type { CircuitPerformanceConfig } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import type { CarPose } from '../types/game';

type CircuitMeshCullingControllerProps = {
  roadGroupRef: MutableRefObject<Group | null>;
  extGroupRef: MutableRefObject<Group | null>;
  viewerPoseRefs: MutableRefObject<CarPose>[];
  performance: CircuitPerformanceConfig;
};

type MeshEntry = {
  mesh: Mesh;
  worldCenter: Vector3;
  worldRadius: number;
};

const CULL_DISTANCE_MARGIN = 18;
const DEFAULT_CULL_CONE_DOT = Math.cos((60 * Math.PI) / 180); // 120deg FOV in front of player.
const EPSILON = 1e-9;

function getPoseForwardPlanar(pose: CarPose, outForward: Vector3) {
  if (
    typeof pose.forwardX === 'number' &&
    typeof pose.forwardY === 'number' &&
    typeof pose.forwardZ === 'number'
  ) {
    outForward.set(pose.forwardX, 0, pose.forwardZ);
  } else {
    outForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  }

  if (outForward.lengthSq() <= EPSILON) {
    outForward.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
  }

  if (outForward.lengthSq() <= EPSILON) {
    return false;
  }

  outForward.normalize();
  return true;
}

function isMeshVisibleFromPose(
  center: Vector3,
  pose: CarPose,
  radius: number,
  maxDistanceWithRadius: number,
  nearDistance: number,
  coneHalfAngle: number,
  tmpToMesh: Vector3,
  tmpToMeshPlanar: Vector3,
  tmpForward: Vector3,
) {
  tmpToMesh.set(center.x - pose.x, center.y - pose.y, center.z - pose.z);
  const distanceSq = tmpToMesh.lengthSq();
  if (distanceSq > maxDistanceWithRadius * maxDistanceWithRadius) {
    return false;
  }

  tmpToMeshPlanar.set(tmpToMesh.x, 0, tmpToMesh.z);
  const planarDistanceSq = tmpToMeshPlanar.lengthSq();
  if (planarDistanceSq <= EPSILON) {
    return true;
  }

  if (!getPoseForwardPlanar(pose, tmpForward)) {
    return true;
  }

  const planarDistance = Math.sqrt(planarDistanceSq);
  const normalizedDot = tmpForward.dot(tmpToMeshPlanar) / planarDistance;
  const forwardDistance = tmpForward.dot(tmpToMeshPlanar);

  // Hard reject only when the entire bounding sphere is behind.
  if (forwardDistance + radius <= 0) return false;

  // Keep nearby geometry to avoid harsh popping around the kart.
  if (nearDistance > 0 && planarDistanceSq <= (nearDistance + radius) * (nearDistance + radius)) return true;

  // Widen the cone for large meshes using their angular radius (asin(r / d)).
  if (planarDistance <= radius) return true;
  const angularSlack = Math.asin(Math.min(1, radius / planarDistance));
  const minDot = Math.cos(Math.min(Math.PI, coneHalfAngle + angularSlack));

  return normalizedDot >= minDot;
}

export function CircuitMeshCullingController({
  roadGroupRef,
  extGroupRef,
  viewerPoseRefs,
  performance,
}: CircuitMeshCullingControllerProps) {
  const frameRef = useRef(0);
  const nextEntryIndexRef = useRef(0);
  const meshEntriesRef = useRef<MeshEntry[]>([]);
  const rootsRef = useRef<{ road: Group | null; ext: Group | null }>({ road: null, ext: null });

  const tmpToMesh = useMemo(() => new Vector3(), []);
  const tmpToMeshPlanar = useMemo(() => new Vector3(), []);
  const tmpForward = useMemo(() => new Vector3(), []);
  const reusableSphere = useMemo(() => new Sphere(), []);
  const coneHalfAngle = useMemo(() => {
    const cullConeDot = Number.isFinite(performance.cullConeDot)
      ? Math.max(-1, Math.min(1, performance.cullConeDot))
      : DEFAULT_CULL_CONE_DOT;
    return Math.acos(cullConeDot);
  }, [performance.cullConeDot]);

  const refreshMeshEntries = () => {
    const roadGroup = roadGroupRef.current;
    const extGroup = extGroupRef.current;

    if (!roadGroup || !extGroup) return;

    roadGroup.updateWorldMatrix(true, true);
    extGroup.updateWorldMatrix(true, true);

    const entries: MeshEntry[] = [];
    const register = (candidate: unknown) => {
      const mesh = candidate as Mesh & { geometry?: BufferGeometry; name?: string; isMesh?: boolean };
      if (!mesh || !mesh.isMesh || !mesh.geometry) return;

      const meshName = typeof mesh.name === 'string' ? mesh.name : '';
      if (meshName.toUpperCase().startsWith('UCX_')) return;

      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      if (!geometry.boundingSphere) return;
      reusableSphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);

      entries.push({
        mesh,
        worldCenter: reusableSphere.center.clone(),
        worldRadius: reusableSphere.radius,
      });
    };

    roadGroup.traverse(register);
    extGroup.traverse(register);

    meshEntriesRef.current = entries;
    nextEntryIndexRef.current = 0;
    rootsRef.current = { road: roadGroup, ext: extGroup };
  };

  useEffect(() => {
    refreshMeshEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    frameRef.current += 1;
    if (frameRef.current % Math.max(1, PERF_PROFILE.cullFrameStride) !== 0) return;

    const roadGroup = roadGroupRef.current;
    const extGroup = extGroupRef.current;
    if (!roadGroup || !extGroup) return;

    if (roadGroup !== rootsRef.current.road || extGroup !== rootsRef.current.ext) {
      refreshMeshEntries();
    }

    const entries = meshEntriesRef.current;
    if (entries.length === 0) return;
    if (viewerPoseRefs.length === 0) return;

    const totalEntries = entries.length;
    const divisor = Math.max(1, Math.floor(PERF_PROFILE.cullBatchDivisor));
    const batchSize = Math.max(64, Math.ceil(totalEntries / divisor));
    let index = nextEntryIndexRef.current % totalEntries;
    const maxToProcess = Math.min(totalEntries, batchSize);

    for (let processed = 0; processed < maxToProcess; processed += 1) {
      const entry = entries[index];
      const center = entry.worldCenter;
      const radius = entry.worldRadius;
      const maxDistanceWithRadius = performance.maxVisibleDistance + radius + CULL_DISTANCE_MARGIN;
      const nearDistance = Math.max(0, performance.cullNearDistance);

      let visible = false;
      for (let viewerIndex = 0; viewerIndex < viewerPoseRefs.length; viewerIndex += 1) {
        const pose = viewerPoseRefs[viewerIndex]?.current;
        if (!pose) continue;
        if (
          isMeshVisibleFromPose(
            center,
            pose,
            radius,
            maxDistanceWithRadius,
            nearDistance,
            coneHalfAngle,
            tmpToMesh,
            tmpToMeshPlanar,
            tmpForward,
          )
        ) {
          visible = true;
          break;
        }
      }

      if (entry.mesh.visible !== visible) {
        entry.mesh.visible = visible;
      }
      index = (index + 1) % totalEntries;
    }

    nextEntryIndexRef.current = index;
  });

  return null;
}
