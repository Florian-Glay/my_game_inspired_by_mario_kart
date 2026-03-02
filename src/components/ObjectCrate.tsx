import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  CuboidCollider,
  RigidBody,
  useRapier,
  type IntersectionEnterPayload,
} from '@react-three/rapier';
import type { Group, Material, Mesh, Object3D } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import type { RaceParticipantId, Vec3 } from '../types/game';

const ROTATION_SPEED_RAD_PER_SEC = Math.PI * 2;
const DEFAULT_COLLIDER_HALF_EXTENTS: Vec3 = [1.1, 1.1, 1.1];

export type ObjectCrateTouch = {
  participantId: RaceParticipantId;
  participantName: string;
};

type ObjectCrateProps = {
  crateId: string;
  position: Vec3;
  rotation?: Vec3;
  modelPath?: string;
  colliderHalfExtents?: Vec3;
  onCollected: (crateId: string, touch: ObjectCrateTouch) => void;
};

const cloneMaterial = (material: Material | null | undefined) => {
  if (!material) return null;
  return material.clone();
};

const disposeObject3D = (root: Object3D) => {
  root.traverse((child) => {
    const meshLike = child as Mesh;
    if (!meshLike.isMesh) return;

    meshLike.geometry?.dispose();

    if (Array.isArray(meshLike.material)) {
      for (const material of meshLike.material) {
        material?.dispose();
      }
      return;
    }

    meshLike.material?.dispose();
  });
};

const resolveParticipantFromPayload = (payload: IntersectionEnterPayload): ObjectCrateTouch | null => {
  const candidates = [
    payload.other.colliderObject?.userData,
    payload.other.rigidBodyObject?.userData,
    (payload.other.collider as any)?.userData,
    (payload.other.rigidBody as any)?.userData,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;

    const participantId = (candidate as any).participantId;
    if (typeof participantId !== 'string' || participantId.length === 0) continue;

    const participantNameRaw = (candidate as any).participantName;
    const participantName =
      typeof participantNameRaw === 'string' && participantNameRaw.trim().length > 0 ?
        participantNameRaw.trim()
      : participantId;

    return { participantId, participantName };
  }

  return null;
};

export function ObjectCrate({
  crateId,
  position,
  rotation = [0, 0, 0],
  modelPath = 'models/item_box.glb',
  colliderHalfExtents = DEFAULT_COLLIDER_HALF_EXTENTS,
  onCollected,
}: ObjectCrateProps) {
  const { rapier } = useRapier();
  const { scene } = useGLTF(modelPath) as unknown as { scene: Group };
  const visualRef = useRef<Group | null>(null);
  const collectedRef = useRef(false);

  const activeCollisionTypes = useMemo(
    () =>
      rapier.ActiveCollisionTypes.DEFAULT |
      rapier.ActiveCollisionTypes.KINEMATIC_FIXED |
      rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
    [rapier],
  );

  const crateModel = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene) as Group;
    cloned.traverse((child) => {
      const meshLike = child as Mesh;
      if (!meshLike.isMesh) return;

      meshLike.castShadow = true;
      meshLike.receiveShadow = true;
      meshLike.geometry = meshLike.geometry.clone();

      if (Array.isArray(meshLike.material)) {
        meshLike.material = meshLike.material
          .map((material) => cloneMaterial(material))
          .filter((material): material is Material => Boolean(material));
        return;
      }

      const material = cloneMaterial(meshLike.material);
      if (material) {
        meshLike.material = material;
      }
    });

    return cloned;
  }, [scene]);

  useEffect(
    () => () => {
      disposeObject3D(crateModel);
    },
    [crateModel],
  );

  useFrame((_, delta) => {
    const visual = visualRef.current;
    if (!visual) return;
    visual.rotation.y += ROTATION_SPEED_RAD_PER_SEC * delta;
  });

  const handleIntersectionEnter = (payload: IntersectionEnterPayload) => {
    if (collectedRef.current) return;

    const participantTouch = resolveParticipantFromPayload(payload);
    if (!participantTouch) return;

    collectedRef.current = true;
    onCollected(crateId, participantTouch);
  };

  return (
    <RigidBody type="fixed" colliders={false} position={position} rotation={rotation}>
      <CuboidCollider
        sensor
        args={[colliderHalfExtents[0], colliderHalfExtents[1], colliderHalfExtents[2]]}
        activeCollisionTypes={activeCollisionTypes}
        onIntersectionEnter={handleIntersectionEnter}
      />
      <group ref={visualRef}>
        <primitive object={crateModel} />
      </group>
    </RigidBody>
  );
}

useGLTF.preload('models/item_box.glb');
