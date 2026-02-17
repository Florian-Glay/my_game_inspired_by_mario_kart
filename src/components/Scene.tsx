import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useProgress } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Color, PCFSoftShadowMap, type Group } from 'three';
import { CC_SPEEDS, CIRCUITS } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type {
  CarPose,
  CourseRaceResult,
  CourseRankingEntry,
  GrandPrixStanding,
  PlayerId,
  RaceConfig,
} from '../types/game';
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
  onCourseFinished: (result: CourseRaceResult) => void;
  onNextCourse: () => Promise<void> | void;
  hasNextCourse: boolean;
  isAdvancingCourse: boolean;
  grandPrixStandings: GrandPrixStanding[];
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

type LapTriggerType = 'lap-start' | 'lap-checkpoint';

type PlayerLapProgress = {
  lap: number;
  checkpoint: boolean;
  finished: boolean;
  finishTimestamp: number | null;
};

type RaceOverlayStep = 'none' | 'course-ranking' | 'course-actions' | 'grand-prix-result';

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

const FALLBACK_PROGRESS: PlayerLapProgress = {
  lap: 1,
  checkpoint: false,
  finished: false,
  finishTimestamp: null,
};
const START_COUNTDOWN_INITIAL = 3;
const START_COUNTDOWN_CHARGE_HINT_FROM = 2;
const START_COUNTDOWN_TICK_MS = 1000;
const START_COUNTDOWN_ZERO_HOLD_MS = 450;

function getPlayerLabel(playerId: PlayerId) {
  return playerId === 'p1' ? 'Joueur 1' : 'Joueur 2';
}

function createInitialLapProgress(players: RaceConfig['players']) {
  return players.reduce<Record<PlayerId, PlayerLapProgress>>((acc, player) => {
    acc[player.id] = { ...FALLBACK_PROGRESS };
    return acc;
  }, {} as Record<PlayerId, PlayerLapProgress>);
}

export function Scene({
  raceConfig,
  onRaceBack,
  onCourseFinished,
  onNextCourse,
  hasNextCourse,
  isAdvancingCourse,
  grandPrixStandings,
}: SceneProps) {
  const circuit = CIRCUITS[raceConfig.circuit];
  const speedProfile = CC_SPEEDS[raceConfig.cc];
  const textureDebugEnabled = import.meta.env.DEV;
  const physicsWarmupFrames = 12;
  const [assetsReady, setAssetsReady] = useState(false);
  const [physicsWarmupReady, setPhysicsWarmupReady] = useState(false);
  const [roadModelReady, setRoadModelReady] = useState(false);
  const [extModelReady, setExtModelReady] = useState(false);
  const [textureDebugReady, setTextureDebugReady] = useState(!textureDebugEnabled);
  const initialLapProgress = useMemo(
    () => createInitialLapProgress(raceConfig.players),
    [raceConfig.players],
  );
  const [lapProgressByPlayer, setLapProgressByPlayer] = useState<Record<PlayerId, PlayerLapProgress>>(
    initialLapProgress,
  );
  const lapProgressRef = useRef<Record<PlayerId, PlayerLapProgress>>(initialLapProgress);
  const [courseRanking, setCourseRanking] = useState<CourseRankingEntry[]>([]);
  const [overlayStep, setOverlayStep] = useState<RaceOverlayStep>('none');
  const [controlsLocked, setControlsLocked] = useState(true);
  const [startCountdownValue, setStartCountdownValue] = useState<number | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const courseResultSentRef = useRef(false);
  const startCountdownStartedRef = useRef(false);
  const winModeHandledRef = useRef(false);
  const { progress, active } = useProgress();
  const circuitPhysicsKey = [
    raceConfig.circuit,
    circuit.road.model,
    circuit.ext.model,
    circuit.antiGravIn?.model ?? 'no-anti-grav-in',
    circuit.antiGravOut?.model ?? 'no-anti-grav-out',
    circuit.booster?.model ?? 'no-booster',
    circuit.lapStart?.model ?? 'no-lap-start',
    circuit.lapCheckpoint?.model ?? 'no-lap-checkpoint',
  ].join('-');
  const requiredAssetUrls = useMemo(() => {
    const urls = [circuit.road.model, circuit.ext.model];
    if (circuit.antiGravIn?.model) urls.push(circuit.antiGravIn.model);
    if (circuit.antiGravOut?.model) urls.push(circuit.antiGravOut.model);
    if (circuit.booster?.model) urls.push(circuit.booster.model);
    if (circuit.lapStart?.model) urls.push(circuit.lapStart.model);
    if (circuit.lapCheckpoint?.model) urls.push(circuit.lapCheckpoint.model);
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
    circuit.lapCheckpoint?.model,
    circuit.lapStart?.model,
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
    lapProgressRef.current = initialLapProgress;
    setLapProgressByPlayer(initialLapProgress);
    setCourseRanking([]);
    setOverlayStep('none');
    setControlsLocked(true);
    setStartCountdownValue(null);
    setMenuBusy(false);
    courseResultSentRef.current = false;
    startCountdownStartedRef.current = false;
    winModeHandledRef.current = false;
    gameMode.current = 'run';
  }, [initialLapProgress, raceConfig.courseId]);

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

  const finalizeCourse = useCallback(
    (progressByPlayer: Record<PlayerId, PlayerLapProgress>) => {
      if (courseResultSentRef.current) return;
      courseResultSentRef.current = true;

      const playerOrder = new Map(raceConfig.players.map((player, index) => [player.id, index]));
      const rankingWithTime = raceConfig.players.map((player) => {
        const progress = progressByPlayer[player.id] ?? FALLBACK_PROGRESS;
        return {
          playerId: player.id,
          lap: progress.lap,
          checkpointReached: progress.checkpoint,
          finished: progress.finished,
          finishTimestamp: progress.finishTimestamp ?? Number.POSITIVE_INFINITY,
        };
      });

      rankingWithTime.sort((left, right) => {
        if (left.finished !== right.finished) return left.finished ? -1 : 1;
        if (left.finished && right.finished && left.finishTimestamp !== right.finishTimestamp) {
          return left.finishTimestamp - right.finishTimestamp;
        }
        if (left.lap !== right.lap) return right.lap - left.lap;
        if (left.checkpointReached !== right.checkpointReached) {
          return left.checkpointReached ? -1 : 1;
        }
        return (playerOrder.get(left.playerId) ?? 0) - (playerOrder.get(right.playerId) ?? 0);
      });

      const ranking: CourseRankingEntry[] = rankingWithTime.map(
        ({ finishTimestamp: _ignored, ...entry }, index) => ({
          ...entry,
          position: index + 1,
        }),
      );

      setCourseRanking(ranking);
      setControlsLocked(true);
      setOverlayStep('course-ranking');
      onCourseFinished({
        grandPrixId: raceConfig.grandPrixId,
        courseId: raceConfig.courseId,
        courseLabel: raceConfig.courseLabel,
        courseIndex: raceConfig.courseIndex,
        ranking,
      });
    },
    [
      onCourseFinished,
      raceConfig.courseId,
      raceConfig.courseIndex,
      raceConfig.courseLabel,
      raceConfig.grandPrixId,
      raceConfig.players,
    ],
  );

  const validateAllLapsFromWinMode = useCallback(() => {
    if (overlayStep !== 'none') return false;

    const nowMs = performance.now();
    const nextProgress = raceConfig.players.reduce<Record<PlayerId, PlayerLapProgress>>(
      (acc, player, index) => {
        const current = lapProgressRef.current[player.id] ?? FALLBACK_PROGRESS;
        acc[player.id] =
          current.finished ?
            current
          : {
              ...current,
              lap: 4,
              checkpoint: false,
              finished: true,
              finishTimestamp: nowMs + index * 0.001,
            };
        return acc;
      },
      { ...lapProgressRef.current },
    );

    lapProgressRef.current = nextProgress;
    setLapProgressByPlayer(nextProgress);
    finalizeCourse(nextProgress);
    return true;
  }, [finalizeCourse, overlayStep, raceConfig.players]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      if (gameMode.current !== 'win') {
        winModeHandledRef.current = false;
        return;
      }

      if (winModeHandledRef.current) return;
      const handled = validateAllLapsFromWinMode();
      if (handled) {
        winModeHandledRef.current = true;
      }
    }, 120);

    return () => window.clearInterval(timerId);
  }, [validateAllLapsFromWinMode]);

  const handleLapTrigger = useCallback(
    (playerId: PlayerId, triggerType: LapTriggerType) => {
      if (controlsLocked || overlayStep !== 'none') return;

      const currentPlayerProgress = lapProgressRef.current[playerId];
      if (!currentPlayerProgress || currentPlayerProgress.finished) return;

      if (triggerType === 'lap-checkpoint') {
        if (currentPlayerProgress.checkpoint) return;
        const nextProgress = {
          ...lapProgressRef.current,
          [playerId]: {
            ...currentPlayerProgress,
            checkpoint: true,
          },
        };
        lapProgressRef.current = nextProgress;
        setLapProgressByPlayer(nextProgress);
        return;
      }

      if (!currentPlayerProgress.checkpoint) return;

      const nextLap = currentPlayerProgress.lap + 1;
      const hasFinished = nextLap >= 4;
      const nextProgress = {
        ...lapProgressRef.current,
        [playerId]: {
          ...currentPlayerProgress,
          lap: nextLap,
          checkpoint: false,
          finished: hasFinished,
          finishTimestamp: hasFinished ? performance.now() : null,
        },
      };

      lapProgressRef.current = nextProgress;
      setLapProgressByPlayer(nextProgress);

      if (hasFinished) {
        finalizeCourse(nextProgress);
      }
    },
    [controlsLocked, finalizeCourse, overlayStep],
  );

  const handleContinueAfterCourse = useCallback(() => {
    if (overlayStep !== 'course-ranking') return;
    setOverlayStep('course-actions');
  }, [overlayStep]);

  const handlePrimaryAction = useCallback(async () => {
    if (overlayStep !== 'course-actions') return;
    if (!hasNextCourse) {
      setOverlayStep('grand-prix-result');
      return;
    }

    setMenuBusy(true);
    try {
      await onNextCourse();
    } finally {
      setMenuBusy(false);
    }
  }, [hasNextCourse, onNextCourse, overlayStep]);

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
  const isStartCountdownVisible =
    sceneReady && overlayStep === 'none' && startCountdownValue !== null;
  const showStartBoostHint =
    typeof startCountdownValue === 'number' &&
    startCountdownValue > 0 &&
    startCountdownValue <= START_COUNTDOWN_CHARGE_HINT_FROM;
  const startBoostHint =
    raceConfig.mode === 'solo' ?
      'Maintiens Z pour charger le boost de depart'
    : 'Maintiens acceleration pour charger le boost de depart';
  const lapSummary = raceConfig.players.map((player) => {
    const progress = lapProgressByPlayer[player.id] ?? FALLBACK_PROGRESS;
    return {
      playerId: player.id,
      completedLaps: Math.min(Math.max(progress.lap - 1, 0), 3),
      checkpoint: progress.checkpoint,
    };
  });
  const isCourseRankingVisible = overlayStep === 'course-ranking';
  const isCourseActionVisible = overlayStep === 'course-actions';
  const isGrandPrixResultVisible = overlayStep === 'grand-prix-result';

  useEffect(() => {
    if (!sceneReady || overlayStep !== 'none') return;
    if (startCountdownStartedRef.current) return;

    startCountdownStartedRef.current = true;
    setStartCountdownValue(START_COUNTDOWN_INITIAL);
  }, [overlayStep, sceneReady]);

  useEffect(() => {
    if (startCountdownValue === null) return;

    if (startCountdownValue === 0) {
      setControlsLocked(false);
      const clearTimer = window.setTimeout(() => {
        setStartCountdownValue((prev) => (prev === 0 ? null : prev));
      }, START_COUNTDOWN_ZERO_HOLD_MS);
      return () => window.clearTimeout(clearTimer);
    }

    const tickTimer = window.setTimeout(() => {
      setStartCountdownValue((prev) => {
        if (prev === null) return prev;
        return Math.max(prev - 1, 0);
      });
    }, START_COUNTDOWN_TICK_MS);
    return () => window.clearTimeout(tickTimer);
  }, [startCountdownValue]);

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

      {isStartCountdownVisible ? (
        <div className="pointer-events-none absolute inset-0 z-[68] flex items-center justify-center">
          <div className="rounded-2xl border border-white/30 bg-[#041334]/62 px-10 py-7 text-center text-white shadow-[0_22px_52px_rgba(1,9,31,0.55)] backdrop-blur-sm">
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/80">Depart</div>
            <div className="mt-1 text-[clamp(4rem,12vw,8.5rem)] leading-none font-black tabular-nums">
              {startCountdownValue}
            </div>
            {showStartBoostHint ? (
              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#ffe8a3]">
                {startBoostHint}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {sceneReady && overlayStep === 'none' ? (
        <div className="absolute right-4 top-4 z-40 min-w-[180px] rounded-xl border border-white/30 bg-[#0a214f]/72 p-3 text-white shadow-2xl backdrop-blur-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">
            Tours effectues
          </div>
          <div className="mt-2 space-y-1.5">
            {lapSummary.map((entry) => (
              <div key={`lap-${entry.playerId}`} className="flex items-center justify-between text-xs">
                <span className="font-semibold">{getPlayerLabel(entry.playerId)}</span>
                <span className="font-black tracking-wide">
                  {entry.completedLaps}/3
                  <span className="ml-1 font-medium text-white/75">
                    {entry.checkpoint ? 'CP OK' : 'CP OFF'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sceneReady && isCourseRankingVisible ? (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#041334]/70 backdrop-blur-sm">
          <div className="w-[min(92vw,640px)] rounded-2xl border border-white/35 bg-[#0a2d66]/88 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Course {raceConfig.courseIndex + 1}/{raceConfig.totalCourses}
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement de la course</h2>
            <div className="mt-4 space-y-2">
              {courseRanking.map((entry) => (
                <div
                  key={`course-rank-${entry.playerId}`}
                  className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#ffd670]">#{entry.position}</span>
                    <span className="text-sm font-bold">{getPlayerLabel(entry.playerId)}</span>
                  </div>
                  <div className="text-xs font-semibold text-white/85">
                    Tour {Math.min(entry.lap, 4)}/4
                    <span className="ml-2">{entry.finished ? 'Termine' : 'En course'}</span>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-lg border border-white/35 bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-[0.1em] transition hover:bg-white/25"
              onClick={handleContinueAfterCourse}
            >
              Continuer
            </button>
          </div>
        </div>
      ) : null}

      {sceneReady && isCourseActionVisible ? (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#041334]/70 backdrop-blur-sm">
          <div className="w-[min(92vw,580px)] rounded-2xl border border-white/35 bg-[#0a2d66]/88 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <h2 className="text-2xl font-black">
              {hasNextCourse ? 'Course terminee' : 'Grand Prix termine'}
            </h2>
            <p className="mt-2 text-sm text-white/85">
              {hasNextCourse
                ? `Passe a la course ${raceConfig.courseIndex + 2}/${raceConfig.totalCourses} ou retourne au menu.`
                : 'Consulte le resultat cumule du Grand Prix ou retourne au menu.'}
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                className="w-full rounded-lg border border-white/35 bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-[0.1em] transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handlePrimaryAction}
                disabled={menuBusy || isAdvancingCourse}
              >
                {hasNextCourse
                  ? menuBusy || isAdvancingCourse
                    ? 'Chargement...'
                    : 'Course Suivante'
                  : 'Resultat'}
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-white/35 bg-[#0f2148] px-4 py-2 text-sm font-black uppercase tracking-[0.1em] transition hover:bg-[#1c376f]"
                onClick={onRaceBack}
              >
                Retour au Menu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sceneReady && isGrandPrixResultVisible ? (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#041334]/74 backdrop-blur-sm">
          <div className="w-[min(94vw,700px)] rounded-2xl border border-white/35 bg-[#0a2d66]/90 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Resultat Final Grand Prix
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement cumule</h2>
            <div className="mt-4 space-y-2">
              {grandPrixStandings.map((standing, index) => (
                <div
                  key={`grand-prix-rank-${standing.playerId}`}
                  className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#ffd670]">#{index + 1}</span>
                    <span className="text-sm font-bold">{getPlayerLabel(standing.playerId)}</span>
                  </div>
                  <div className="text-right text-xs font-semibold text-white/90">
                    <div>Total: {standing.totalPosition}</div>
                    <div className="text-white/70">
                      Courses: {standing.coursePositions.join(' + ') || '-'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-5 w-full rounded-lg border border-white/35 bg-[#0f2148] px-4 py-2 text-sm font-black uppercase tracking-[0.1em] transition hover:bg-[#1c376f]"
              onClick={onRaceBack}
            >
              Retour au Menu
            </button>
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

            {circuit.lapStart ?
              <SurfaceWithDrag
                key={`lap-start-${circuitPhysicsKey}`}
                name={`${circuit.id}-lap-start-surface`}
                type="fixed"
                colliders="trimesh"
                sensor
                surfaceTriggerType="lap-start"
                friction={0}
                restitution={0}
                position={circuit.lapStart.transform.position}
                rotation={circuit.lapStart.transform.rotation}
                drag={0}
              >
                <Model
                  src={circuit.lapStart.model}
                  scale={circuit.lapStart.transform.scale}
                  optimizeStatic={PERF_PROFILE.disableShadowsOnStatic}
                  forceFrontSideOpaque={PERF_PROFILE.forceFrontSideOpaque}
                />
              </SurfaceWithDrag>
            : null}

            {circuit.lapCheckpoint ?
              <SurfaceWithDrag
                key={`lap-checkpoint-${circuitPhysicsKey}`}
                name={`${circuit.id}-lap-checkpoint-surface`}
                type="fixed"
                colliders="trimesh"
                sensor
                surfaceTriggerType="lap-checkpoint"
                friction={0}
                restitution={0}
                position={circuit.lapCheckpoint.transform.position}
                rotation={circuit.lapCheckpoint.transform.rotation}
                drag={0}
              >
                <Model
                  src={circuit.lapCheckpoint.model}
                  scale={circuit.lapCheckpoint.transform.scale}
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
                maxYawRate={speedProfile.maxYawRate}
                onPoseUpdate={handlePoseUpdate}
                onLapTrigger={handleLapTrigger}
                controlsLocked={controlsLocked}
                startCountdownValue={startCountdownValue}
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
