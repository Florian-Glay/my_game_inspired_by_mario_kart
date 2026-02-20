import { OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import type { Group } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import {
  CHARACTERS,
  VEHICLES,
  WHEELS,
  WHEEL_SIZE_HEIGHT_PROFILES,
  getCatalogItemById,
} from '../config/garageCatalog';
import type { PlayerLoadoutSelection, Vec3 } from '../types/game';

type GaragePreviewProps = {
  loadout: PlayerLoadoutSelection | null;
};

const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const getWheelRotationForMount = (mount: Vec3): Vec3 =>
  mount[0] > 0 ? [0, Math.PI, 0] : [0, 0, 0];
const PREVIEW_CAMERA_POSITION: Vec3 = [6.2, 1.92, 5.2];
const PREVIEW_ORBIT_TARGET: Vec3 = [0, 0.12, 0];
const PREVIEW_MODEL_OFFSET: Vec3 = [0, -1.2, 0];

function useClonedScene(url: string) {
  const { scene } = useGLTF(url) as unknown as { scene: Group };
  return useMemo(() => SkeletonUtils.clone(scene) as Group, [scene]);
}

function GaragePreviewModel({ loadout }: { loadout: PlayerLoadoutSelection }) {
  const character = getCatalogItemById(CHARACTERS, loadout.characterId);
  const vehicle = getCatalogItemById(VEHICLES, loadout.vehicleId);
  const wheel = getCatalogItemById(WHEELS, loadout.wheelId);
  const wheelHeight = WHEEL_SIZE_HEIGHT_PROFILES[wheel.size];

  const vehicleScene = useClonedScene(vehicle.model);
  const characterScene = useClonedScene(character.model);

  const { scene: wheelSceneSource } = useGLTF(wheel.model) as unknown as { scene: Group };
  const wheelScenes = useMemo(
    () => Array.from({ length: 4 }, () => SkeletonUtils.clone(wheelSceneSource) as Group),
    [wheelSceneSource],
  );

  const characterPosition = addVec3(vehicle.characterMount, [0, wheelHeight.driverLift, 0]);

  return (
    <group position={[0, wheelHeight.chassisLift, 0]}>
      <primitive object={vehicleScene} scale={vehicle.scale} />
      <group position={characterPosition}>
        <primitive object={characterScene} scale={character.scale} />
      </group>
      {vehicle.wheelMounts.map((mount, index) => (
        <group key={`wheel-${index}`} position={mount} rotation={getWheelRotationForMount(mount)}>
          <primitive object={wheelScenes[index]} scale={wheel.scale} />
        </group>
      ))}
    </group>
  );
}

function GaragePreviewCanvas({ loadout }: { loadout: PlayerLoadoutSelection }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: PREVIEW_CAMERA_POSITION, fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <fog attach="fog" args={['#081b4f', 8, 22]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 4]} intensity={1.2} castShadow />
      <directionalLight position={[-5, 4, -6]} intensity={0.4} />

      <Suspense fallback={null}>
        <group position={PREVIEW_MODEL_OFFSET}>
          <GaragePreviewModel loadout={loadout} />
        </group>
      </Suspense>

      <OrbitControls
        target={PREVIEW_ORBIT_TARGET}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.9}
        maxPolarAngle={1.65}
        autoRotate
        autoRotateSpeed={0.85}
      />
    </Canvas>
  );
}

export function GaragePreview({ loadout }: GaragePreviewProps) {
  if (!loadout) {
    return (
      <div className="mk-garage-preview-fallback">
        <span>Aucune selection active</span>
      </div>
    );
  }

  return (
    <div className="mk-garage-preview-wrap">
      <GaragePreviewCanvas loadout={loadout} />
    </div>
  );
}
