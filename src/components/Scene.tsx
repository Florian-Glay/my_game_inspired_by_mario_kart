import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useProgress } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Color, PCFSoftShadowMap, type Group } from 'three';
import { CC_SPEEDS, CIRCUITS } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type { CarPose, PlayerId, RaceConfig } from '../types/game';
import { CameraController } from './CameraController';
import { CircuitMeshCullingController } from './CircuitMeshCullingController';
import DrivableModel from './DrivableModel';
import Model from './Model';
import { SplitScreenCameraController } from './SplitScreenCameraController';
import { SurfaceWithDrag } from './SurfaceWithDrag';
import TextureDebug from './TextureDebug';

useGLTF.preload('/models/exemple.glb');
const DAY_CLEAR_COLOR = '#7ec3ff';
const SUN_POSITION: [number, number, number] = [220, 180, -360];
const CLOUD_WRAP_X = 620;
const CLOUD_FAR_Z = -420;
const CLOUD_NEAR_Z = 160;

type SceneProps = {
  raceConfig: RaceConfig;
  onRaceBack: () => void;
};

type SceneAssetGateProps = {
  urls: string[];
  onReady: () => void;
};

type PhysicsWarmupGateProps = {
  enabled: boolean;
  framesToWait: number;
  onReady: () => void;
};

function SceneAssetGate({ urls, onReady }: SceneAssetGateProps) {
  useGLTF(urls);

  useEffect(() => {
    onReady();
  }, [onReady, urls]);

  return null;
}

function LoadingFallback() {
  return null;
}

function PhysicsWarmupGate({ enabled, framesToWait, onReady }: PhysicsWarmupGateProps) {
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

function RaceEnvironmentEnforcer() {
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

type CloudSeed = {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
  alpha: number;
};

function MovingClouds() {
  const rootRef = useRef<Group | null>(null);
  const cloudSeeds = useMemo<CloudSeed[]>(
    () =>
      Array.from({ length: 16 }, (_, index) => {
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

export function Scene({ raceConfig, onRaceBack }: SceneProps) {
  const circuit = CIRCUITS[raceConfig.circuit];
  const speedProfile = CC_SPEEDS[raceConfig.cc];
  const textureDebugEnabled = import.meta.env.DEV;
  const physicsWarmupFrames = 12;
  const [assetsReady, setAssetsReady] = useState(false);
  const [physicsWarmupReady, setPhysicsWarmupReady] = useState(false);
  const [roadModelReady, setRoadModelReady] = useState(false);
  const [extModelReady, setExtModelReady] = useState(false);
  const [textureDebugReady, setTextureDebugReady] = useState(!textureDebugEnabled);
  const { progress, active } = useProgress();
  const circuitPhysicsKey = [
    raceConfig.circuit,
    circuit.road.model,
    circuit.ext.model,
    circuit.antiGravIn?.model ?? 'no-anti-grav-in',
    circuit.antiGravOut?.model ?? 'no-anti-grav-out',
    circuit.booster?.model ?? 'no-booster',
  ].join('-');
  const requiredAssetUrls = useMemo(() => {
    const urls = [circuit.road.model, circuit.ext.model];
    if (circuit.antiGravIn?.model) urls.push(circuit.antiGravIn.model);
    if (circuit.antiGravOut?.model) urls.push(circuit.antiGravOut.model);
    if (circuit.booster?.model) urls.push(circuit.booster.model);
    for (const player of raceConfig.players) {
      urls.push(player.vehicleModel);
      urls.push(player.characterModel);
      urls.push(player.wheelModel);
    }
    return Array.from(new Set(urls));
  }, [
    circuit.antiGravIn?.model,
    circuit.antiGravOut?.model,
    circuit.booster?.model,
    circuit.ext.model,
    circuit.road.model,
    raceConfig.players,
  ]);
  const assetGateKey = useMemo(() => requiredAssetUrls.join('|'), [requiredAssetUrls]);

  const p1Spawn = raceConfig.players.find((player) => player.id === 'p1')?.spawn ?? [0, 1, 0];
  const p2Spawn = raceConfig.players.find((player) => player.id === 'p2')?.spawn ?? [2, 1, 0];
  const p1SpawnRotation = raceConfig.players.find((player) => player.id === 'p1')?.spawnRotation ?? [0, 0, 0];
  const p2SpawnRotation = raceConfig.players.find((player) => player.id === 'p2')?.spawnRotation ?? [0, 0, 0];

  const p1InitialPose = useMemo<CarPose>(
    () => ({ x: p1Spawn[0], y: p1Spawn[1], z: p1Spawn[2], yaw: p1SpawnRotation[1] }),
    [p1Spawn, p1SpawnRotation],
  );
  const p2InitialPose = useMemo<CarPose>(
    () => ({ x: p2Spawn[0], y: p2Spawn[1], z: p2Spawn[2], yaw: p2SpawnRotation[1] }),
    [p2Spawn, p2SpawnRotation],
  );

  const p1PoseRef = useRef<CarPose>(p1InitialPose);
  const p2PoseRef = useRef<CarPose>(p2InitialPose);
  const roadGroupRef = useRef<Group | null>(null);
  const extGroupRef = useRef<Group | null>(null);

  useEffect(() => {
    p1PoseRef.current = p1InitialPose;
    p2PoseRef.current = p2InitialPose;
  }, [p1InitialPose, p2InitialPose]);

  useEffect(() => {
    roadGroupRef.current = null;
    extGroupRef.current = null;
    setAssetsReady(false);
    setPhysicsWarmupReady(false);
    setRoadModelReady(false);
    setExtModelReady(false);
    setTextureDebugReady(!textureDebugEnabled);
  }, [assetGateKey, circuitPhysicsKey, textureDebugEnabled]);

  useEffect(() => {
    if (raceConfig.mode === 'multi' && gameMode.current === 'free') {
      gameMode.current = 'run';
    }
  }, [raceConfig.mode]);

  const handlePoseUpdate = (playerId: PlayerId, pose: CarPose) => {
    if (playerId === 'p1') {
      p1PoseRef.current = pose;
      return;
    }
    p2PoseRef.current = pose;
  };

  const handleRoadModelReady = useCallback((group: Group) => {
    roadGroupRef.current = group;
    setRoadModelReady(true);
  }, []);

  const handleExtModelReady = useCallback((group: Group) => {
    extGroupRef.current = group;
    setExtModelReady(true);
  }, []);
  const handleAssetsReady = useCallback(() => {
    setAssetsReady((prev) => (prev ? prev : true));
  }, []);
  const handlePhysicsWarmupReady = useCallback(() => {
    setPhysicsWarmupReady((prev) => (prev ? prev : true));
  }, []);
  const handleTextureDebugReady = useCallback(() => {
    setTextureDebugReady((prev) => (prev ? prev : true));
  }, []);
  const loadingPercent = Math.min(100, Math.max(0, Math.round(progress)));
  const sceneReady =
    assetsReady && roadModelReady && extModelReady && physicsWarmupReady && textureDebugReady;
  const loadingMessage =
    !assetsReady ? 'Chargement des assets...'
    : !physicsWarmupReady ? 'Initialisation physique...'
    : !(roadModelReady && extModelReady) ? 'Assemblage de la scene...'
    : !textureDebugReady ? 'Validation debug...'
    : 'Pret';
  const loadingValue = !assetsReady ? (active ? `${loadingPercent}%` : '100%') : loadingMessage;

  return (
    <div className="relative w-full h-screen">
      <button type="button" className="mk-back-btn" onClick={onRaceBack}>
        Retour
      </button>
      {raceConfig.mode === 'multi' ? <div className="split-divider" aria-hidden /> : null}
      {!sceneReady ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0b1730]/82 backdrop-blur-sm">
          <div className="rounded-xl border border-white/30 bg-black/25 px-6 py-4 text-center text-white shadow-2xl">
            <div className="text-xs font-bold tracking-[0.18em] uppercase opacity-85">Chargement 3D</div>
            <div className="mt-2 text-2xl font-black">{loadingValue}</div>
            <div className="mt-2 text-[11px] opacity-75">{loadingMessage}</div>
          </div>
        </div>
      ) : null}

      <Canvas
        shadows
        dpr={PERF_PROFILE.dpr}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false }}
        camera={{ position: [8, 3, 8], fov: 80, near: PERF_PROFILE.cameraNear, far: PERF_PROFILE.cameraFar }}
        style={{ background: DAY_CLEAR_COLOR }}
        onCreated={(state) => {
          state.gl.localClippingEnabled = true;
          state.gl.shadowMap.enabled = true;
          state.gl.shadowMap.type = PCFSoftShadowMap;
        }}
      >
        <RaceEnvironmentEnforcer />
        <Suspense fallback={<LoadingFallback />}>
          <SceneAssetGate key={assetGateKey} urls={requiredAssetUrls} onReady={handleAssetsReady} />
          {assetsReady ? (
            <Physics key={circuitPhysicsKey} gravity={[0, -9.81, 0]} colliders={false}>
            <PhysicsWarmupGate enabled={assetsReady} framesToWait={physicsWarmupFrames} onReady={handlePhysicsWarmupReady} />
            <ambientLight intensity={0.5} color="#fff4dc" />
            <hemisphereLight args={['#9fd5ff', '#e0b784', 0.62]} />
            <directionalLight
              position={[170, 260, -130]}
              intensity={1.45}
              color="#ffe0ad"
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-camera-near={1}
              shadow-camera-far={1000}
              shadow-camera-left={-320}
              shadow-camera-right={320}
              shadow-camera-top={320}
              shadow-camera-bottom={-320}
              shadow-bias={-0.00014}
              shadow-normalBias={0.03}
            />
            <directionalLight position={[-180, 120, 240]} intensity={0.42} color="#b9dcff" />

            <group position={SUN_POSITION}>
              <mesh>
                <sphereGeometry args={[34, 40, 40]} />
                <meshBasicMaterial color="#fff3bd" toneMapped={false} />
              </mesh>
              <mesh>
                <sphereGeometry args={[58, 32, 32]} />
                <meshBasicMaterial color="#ffd88f" transparent opacity={0.28} toneMapped={false} />
              </mesh>
              <pointLight color="#ffd89e" intensity={95} distance={1200} decay={2} />
            </group>
            <MovingClouds />

            <SurfaceWithDrag
              key={`road-${circuitPhysicsKey}`}
              name={`${circuit.id}-road-surface`}
              type="fixed"
              colliders="trimesh"
              surfaceAttachmentKind="road"
              friction={circuit.road.friction}
              restitution={circuit.road.restitution}
              position={circuit.transform.position}
              rotation={circuit.transform.rotation}
              drag={circuit.road.drag}
            >
              <Model
                src={circuit.road.model}
                scale={circuit.transform.scale}
                optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                onReady={handleRoadModelReady}
              />
            </SurfaceWithDrag>

            <SurfaceWithDrag
              key={`ext-${circuitPhysicsKey}`}
              name={`${circuit.id}-ext-surface`}
              type="fixed"
              colliders="trimesh"
              surfaceAttachmentKind="ext"
              friction={circuit.ext.friction}
              restitution={circuit.ext.restitution}
              position={circuit.transform.position}
              rotation={circuit.transform.rotation}
              drag={circuit.ext.drag}
            >
              <Model
                src={circuit.ext.model}
                scale={circuit.transform.scale}
                optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                onReady={handleExtModelReady}
              />
            </SurfaceWithDrag>

            {circuit.antiGravIn ?
              <SurfaceWithDrag
                key={`anti-grav-in-${circuitPhysicsKey}`}
                name={`${circuit.id}-antiGravIn-surface`}
                type="fixed"
                colliders="trimesh"
                sensor
                surfaceTriggerType="anti-grav-in"
                friction={circuit.antiGravIn.friction}
                restitution={circuit.antiGravIn.restitution}
                position={circuit.antiGravIn.transform.position}
                rotation={circuit.antiGravIn.transform.rotation}
                drag={circuit.antiGravIn.drag}
              >
                <Model
                  src={circuit.antiGravIn.model}
                  scale={circuit.antiGravIn.transform.scale}
                  optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                  forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                />
              </SurfaceWithDrag>
            : null}

            {circuit.antiGravOut ?
              <SurfaceWithDrag
                key={`anti-grav-out-${circuitPhysicsKey}`}
                name={`${circuit.id}-antiGravOut-surface`}
                type="fixed"
                colliders="trimesh"
                sensor
                surfaceTriggerType="anti-grav-out"
                friction={circuit.antiGravOut.friction}
                restitution={circuit.antiGravOut.restitution}
                position={circuit.antiGravOut.transform.position}
                rotation={circuit.antiGravOut.transform.rotation}
                drag={circuit.antiGravOut.drag}
              >
                <Model
                  src={circuit.antiGravOut.model}
                  scale={circuit.antiGravOut.transform.scale}
                  optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                  forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                />
              </SurfaceWithDrag>
            : null}

            {circuit.booster ?
              <SurfaceWithDrag
                key={`booster-${circuitPhysicsKey}`}
                name={`${circuit.id}-booster-surface`}
                type="fixed"
                colliders="trimesh"
                sensor
                surfaceTriggerType="booster"
                friction={0}
                restitution={0}
                position={circuit.booster.transform.position}
                rotation={circuit.booster.transform.rotation}
                drag={0}
              >
                <Model
                  src={circuit.booster.model}
                  scale={circuit.booster.transform.scale}
                  optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                  forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                />
              </SurfaceWithDrag>
            : null}

            {raceConfig.players.map((player) => (
              <DrivableModel
                key={player.id}
                playerId={player.id}
                vehicleModel={player.vehicleModel}
                characterModel={player.characterModel}
                wheelModel={player.wheelModel}
                vehicleScale={player.vehicleScale}
                characterScale={player.characterScale}
                wheelScale={player.wheelScale}
                characterMount={player.characterMount}
                wheelMounts={player.wheelMounts}
                chassisLift={player.chassisLift}
                driverLift={player.driverLift}
                position={player.spawn}
                rotation={player.spawnRotation}
                keyBindings={player.keyBindings}
                maxForward={speedProfile.maxForward}
                maxBackward={speedProfile.maxBackward}
                onPoseUpdate={handlePoseUpdate}
                surfaceAttachment={circuit.vehicleAttachment}
                antiGravSwitchesEnabled={Boolean(circuit.antiGravIn || circuit.antiGravOut)}
                booster={circuit.booster}
              />
            ))}

            <CircuitMeshCullingController
              roadGroupRef={roadGroupRef}
              extGroupRef={extGroupRef}
              p1PoseRef={p1PoseRef}
              p2PoseRef={p2PoseRef}
              mode={raceConfig.mode}
              performance={circuit.performance}
            />

            {raceConfig.mode === 'multi' ?
              <SplitScreenCameraController
                leftPoseRef={p1PoseRef}
                rightPoseRef={p2PoseRef}
                clipPlaneOffset={PERF_PROFILE.clipPlaneOffset}
                enableClipPlane={PERF_PROFILE.enableCameraClipPlane}
              />
            :
              <CameraController
                targetPoseRef={p1PoseRef}
                clipPlaneOffset={PERF_PROFILE.clipPlaneOffset}
                enableClipPlane={PERF_PROFILE.enableCameraClipPlane}
              />}

            {textureDebugEnabled ? <TextureDebug onReady={handleTextureDebugReady} /> : null}
            </Physics>
          ) : null}
        </Suspense>
      </Canvas>
    </div>
  );
}
