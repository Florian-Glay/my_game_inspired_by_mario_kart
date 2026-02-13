import type { MutableRefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { BufferGeometry, Group, Mesh } from 'three';
import { Sphere, Vector3 } from 'three';
import type { CircuitPerformanceConfig } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import type { CarPose, RaceMode } from '../types/game';

type CircuitMeshCullingControllerProps = {
  roadGroupRef: MutableRefObject<Group | null>;
  extGroupRef: MutableRefObject<Group | null>;
  p1PoseRef: MutableRefObject<CarPose>;
  p2PoseRef: MutableRefObject<CarPose>;
  mode: RaceMode;
  performance: CircuitPerformanceConfig;
};

type MeshEntry = {
  mesh: Mesh;
  localSphere: Sphere;
  worldSphere: Sphere;
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
  p1PoseRef,
  p2PoseRef,
  mode,
  performance,
}: CircuitMeshCullingControllerProps) {
  const frameRef = useRef(0);
  const meshEntriesRef = useRef<MeshEntry[]>([]);
  const rootsRef = useRef<{ road: Group | null; ext: Group | null }>({ road: null, ext: null });

  const tmpToMesh = useMemo(() => new Vector3(), []);
  const tmpToMeshPlanar = useMemo(() => new Vector3(), []);
  const tmpForward = useMemo(() => new Vector3(), []);

  const refreshMeshEntries = () => {
    const roadGroup = roadGroupRef.current;
    const extGroup = extGroupRef.current;

    if (!roadGroup || !extGroup) return;

    const entries: MeshEntry[] = [];
    const register = (candidate: unknown) => {
      const mesh = candidate as Mesh & { geometry?: BufferGeometry; name?: string; isMesh?: boolean };
      if (!mesh || !mesh.isMesh || !mesh.geometry) return;

      const meshName = typeof mesh.name === 'string' ? mesh.name : '';
      if (meshName.toUpperCase().startsWith('UCX_')) return;

      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      if (!geometry.boundingSphere) return;

      entries.push({
        mesh,
        localSphere: geometry.boundingSphere.clone(),
        worldSphere: new Sphere(),
      });
    };

    roadGroup.traverse(register);
    extGroup.traverse(register);

    meshEntriesRef.current = entries;
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

    const cullConeDot = Number.isFinite(performance.cullConeDot)
      ? Math.max(-1, Math.min(1, performance.cullConeDot))
      : DEFAULT_CULL_CONE_DOT;
    const coneHalfAngle = Math.acos(cullConeDot);
    const p1Pose = p1PoseRef.current;
    const p2Pose = p2PoseRef.current;

    for (const entry of entries) {
      entry.worldSphere.copy(entry.localSphere).applyMatrix4(entry.mesh.matrixWorld);
      const center = entry.worldSphere.center;
      const radius = entry.worldSphere.radius;
      const maxDistanceWithRadius = performance.maxVisibleDistance + radius + CULL_DISTANCE_MARGIN;
      const nearDistance = Math.max(0, performance.cullNearDistance);

      const visibleForP1 = isMeshVisibleFromPose(
        center,
        p1Pose,
        radius,
        maxDistanceWithRadius,
        nearDistance,
        coneHalfAngle,
        tmpToMesh,
        tmpToMeshPlanar,
        tmpForward,
      );
      const visibleForP2 =
        mode === 'multi' ?
          isMeshVisibleFromPose(
            center,
            p2Pose,
            radius,
            maxDistanceWithRadius,
            nearDistance,
            coneHalfAngle,
            tmpToMesh,
            tmpToMeshPlanar,
            tmpForward,
          )
        : false;

      entry.mesh.visible = visibleForP1 || visibleForP2;
    }
  });

  return null;
}
