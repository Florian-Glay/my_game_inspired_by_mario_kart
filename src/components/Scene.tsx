import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { Color, PCFSoftShadowMap, type Group } from 'three';
import { CC_SPEEDS, CIRCUITS } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type {
  CarPose,
  CourseRaceResult,
  CourseRankingEntry,
  GrandPrixStanding,
  HumanPlayerSlotId,
  RaceConfig,
  RaceParticipantId,
} from '../types/game';
import { CameraController } from './CameraController';
import { CircuitMeshCullingController } from './CircuitMeshCullingController';
import DrivableModel from './DrivableModel';
import { LocalMultiviewCameraController } from './LocalMultiviewCameraController';
import Model from './Model';
import { SurfaceWithDrag } from './SurfaceWithDrag';
import TextureDebug from './TextureDebug';

useGLTF.preload('models/exemple.glb');
const DAY_CLEAR_COLOR = '#7ec3ff';
const SUN_POSITION: [number, number, number] = [220, 180, -360];
const CLOUD_WRAP_X = 620;
const CLOUD_FAR_Z = -420;
const CLOUD_NEAR_Z = 160;
const TINY_VIEWPORT_AREA = 420_000;
const MEDIUM_VIEWPORT_AREA = 820_000;

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

function AdaptiveViewportPerformance() {
  const { size, setDpr } = useThree();
  const lastDprRef = useRef<number | null>(null);

  useEffect(() => {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    const viewportArea = width * height;
    const minDpr = PERF_PROFILE.dpr[0];
    const maxDpr = PERF_PROFILE.dpr[1];

    const targetDpr =
      viewportArea <= TINY_VIEWPORT_AREA ?
        minDpr
      : viewportArea <= MEDIUM_VIEWPORT_AREA ?
        Math.max(minDpr, Math.min(maxDpr, 0.65))
      : maxDpr;

    if (lastDprRef.current !== targetDpr) {
      lastDprRef.current = targetDpr;
      setDpr(targetDpr);
    }
  }, [setDpr, size.height, size.width]);

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

type LiveScoreboardEntry = {
  participantId: RaceParticipantId;
  displayName: string;
  position: number;
  completedLaps: number;
  checkpoint: boolean;
  finished: boolean;
};

function MovingClouds() {
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
const LOADING_OVERLAY_FADE_MS = 500;
const LIVE_SCOREBOARD_REFRESH_MS = 280;
const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distanceBetweenPoints = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) =>
  Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
const distanceFromPoseToPoint = (
  pose: CarPose | null | undefined,
  point: readonly [number, number, number],
) => {
  if (!pose) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    pose.x - point[0],
    pose.y - point[1],
    pose.z - point[2],
  );
};

function createInitialLapProgress(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, PlayerLapProgress>>((acc, participant) => {
    acc[participant.id] = { ...FALLBACK_PROGRESS };
    return acc;
  }, {});
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
    () => createInitialLapProgress(raceConfig.participants),
    [raceConfig.participants],
  );
  const [lapProgressByPlayer, setLapProgressByPlayer] = useState<Record<RaceParticipantId, PlayerLapProgress>>(
    initialLapProgress,
  );
  const lapProgressRef = useRef<Record<RaceParticipantId, PlayerLapProgress>>(initialLapProgress);
  const [courseRanking, setCourseRanking] = useState<CourseRankingEntry[]>([]);
  const [overlayStep, setOverlayStep] = useState<RaceOverlayStep>('none');
  const [controlsLocked, setControlsLocked] = useState(true);
  const [startCountdownValue, setStartCountdownValue] = useState<number | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(true);
  const [loadingOverlayFading, setLoadingOverlayFading] = useState(false);
  const [liveScoreboardTick, setLiveScoreboardTick] = useState(0);
  const courseResultSentRef = useRef(false);
  const startCountdownStartedRef = useRef(false);
  const winModeHandledRef = useRef(false);
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
    for (const player of raceConfig.participants) {
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
    raceConfig.participants,
  ]);
  const assetGateKey = useMemo(() => requiredAssetUrls.join('|'), [requiredAssetUrls]);
  const humanParticipants = useMemo(
    () =>
      raceConfig.participants
        .filter((participant) => participant.kind === 'human')
        .sort((left, right) => {
          const leftOrder =
            left.humanSlotId ? HUMAN_SLOT_ORDER.indexOf(left.humanSlotId) : Number.MAX_SAFE_INTEGER;
          const rightOrder =
            right.humanSlotId ? HUMAN_SLOT_ORDER.indexOf(right.humanSlotId) : Number.MAX_SAFE_INTEGER;
          return leftOrder - rightOrder;
        }),
    [raceConfig.participants],
  );
  const poseRefsByParticipant = useMemo<
    Record<RaceParticipantId, MutableRefObject<CarPose>>
  >(() => {
    const refs: Record<RaceParticipantId, MutableRefObject<CarPose>> = {};
    for (const participant of raceConfig.participants) {
      refs[participant.id] = {
        current: {
          x: participant.spawn[0],
          y: participant.spawn[1],
          z: participant.spawn[2],
          yaw: participant.spawnRotation[1],
        },
      };
    }
    return refs;
  }, [raceConfig.participants]);
  const viewerPoseRefs = useMemo(
    () =>
      humanParticipants
        .map((participant) => poseRefsByParticipant[participant.id])
        .filter((ref): ref is MutableRefObject<CarPose> => Boolean(ref)),
    [humanParticipants, poseRefsByParticipant],
  );
  const drivableParticipants = useMemo(
    () =>
      PERF_PROFILE.simulateBots ?
        raceConfig.participants
      : raceConfig.participants.filter((participant) => participant.kind === 'human'),
    [raceConfig.participants],
  );
  const participantOrder = useMemo(
    () => new Map(raceConfig.participants.map((participant, index) => [participant.id, index])),
    [raceConfig.participants],
  );
  const lapStartMarker = useMemo<readonly [number, number, number]>(() => {
    const startPosition = circuit.lapStart?.transform.position;
    if (startPosition) return [startPosition[0], startPosition[1], startPosition[2]];
    return [0, 0, 0];
  }, [circuit.lapStart?.transform.position]);
  const lapCheckpointMarker = useMemo<readonly [number, number, number]>(() => {
    const checkpointPosition = circuit.lapCheckpoint?.transform.position;
    if (checkpointPosition) {
      return [checkpointPosition[0], checkpointPosition[1], checkpointPosition[2]];
    }
    return lapStartMarker;
  }, [circuit.lapCheckpoint?.transform.position, lapStartMarker]);
  const lapSegmentDistance = useMemo(
    () => Math.max(1, distanceBetweenPoints(lapStartMarker, lapCheckpointMarker)),
    [lapCheckpointMarker, lapStartMarker],
  );
  const roadGroupRef = useRef<Group | null>(null);
  const extGroupRef = useRef<Group | null>(null);
  const sceneReady =
    assetsReady && roadModelReady && extModelReady && physicsWarmupReady && textureDebugReady;

  useEffect(() => {
    roadGroupRef.current = null;
    extGroupRef.current = null;
    setAssetsReady(false);
    setPhysicsWarmupReady(false);
    setRoadModelReady(false);
    setExtModelReady(false);
    setTextureDebugReady(!textureDebugEnabled);
    setLoadingOverlayVisible(true);
    setLoadingOverlayFading(false);
  }, [assetGateKey, circuitPhysicsKey, textureDebugEnabled]);

  useEffect(() => {
    lapProgressRef.current = initialLapProgress;
    setLapProgressByPlayer(initialLapProgress);
    setCourseRanking([]);
    setOverlayStep('none');
    setControlsLocked(true);
    setStartCountdownValue(null);
    setMenuBusy(false);
    setLiveScoreboardTick(0);
    courseResultSentRef.current = false;
    startCountdownStartedRef.current = false;
    winModeHandledRef.current = false;
    gameMode.current = 'run';
  }, [initialLapProgress, raceConfig.courseId]);

  useEffect(() => {
    if (raceConfig.humanCount > 1 && gameMode.current === 'free') {
      gameMode.current = 'run';
    }
  }, [raceConfig.humanCount]);

  useEffect(() => {
    if (!sceneReady) {
      setLoadingOverlayVisible(true);
      setLoadingOverlayFading(false);
      return;
    }

    setLoadingOverlayFading(true);
    const fadeTimer = window.setTimeout(() => {
      setLoadingOverlayVisible(false);
    }, LOADING_OVERLAY_FADE_MS);
    return () => window.clearTimeout(fadeTimer);
  }, [sceneReady]);

  const handlePoseUpdate = useCallback(
    (participantId: RaceParticipantId, pose: CarPose) => {
      const poseRef = poseRefsByParticipant[participantId];
      if (!poseRef) return;
      poseRef.current = pose;
    },
    [poseRefsByParticipant],
  );

  const finalizeCourse = useCallback(
    (progressByPlayer: Record<RaceParticipantId, PlayerLapProgress>) => {
      if (courseResultSentRef.current) return;
      courseResultSentRef.current = true;

      const participantOrder = new Map(
        raceConfig.participants.map((participant, index) => [participant.id, index]),
      );
      const rankingWithTime = raceConfig.participants.map((participant) => {
        const progress = progressByPlayer[participant.id] ?? FALLBACK_PROGRESS;
        return {
          participantId: participant.id,
          displayName: participant.displayName,
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
        return (
          (participantOrder.get(left.participantId) ?? 0) -
          (participantOrder.get(right.participantId) ?? 0)
        );
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
      raceConfig.participants,
    ],
  );

  const validateAllLapsFromWinMode = useCallback(() => {
    if (overlayStep !== 'none') return false;

    const nowMs = performance.now();
    const nextProgress = raceConfig.participants.reduce<Record<RaceParticipantId, PlayerLapProgress>>(
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
  }, [finalizeCourse, overlayStep, raceConfig.participants]);

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
    (participantId: RaceParticipantId, triggerType: LapTriggerType) => {
      if (controlsLocked || overlayStep !== 'none') return;

      const currentPlayerProgress = lapProgressRef.current[participantId];
      if (!currentPlayerProgress || currentPlayerProgress.finished) return;

      if (triggerType === 'lap-checkpoint') {
        if (currentPlayerProgress.checkpoint) return;
        const nextProgress = {
          ...lapProgressRef.current,
          [participantId]: {
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
        [participantId]: {
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
        const allHumansFinished = raceConfig.participants
          .filter((participant) => participant.kind === 'human')
          .every((participant) => nextProgress[participant.id]?.finished);
        if (allHumansFinished) {
          finalizeCourse(nextProgress);
        }
      }
    },
    [controlsLocked, finalizeCourse, overlayStep, raceConfig.participants],
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
  const isLoadingOverlayActive = loadingOverlayVisible;
  const isStartCountdownVisible =
    sceneReady && !isLoadingOverlayActive && overlayStep === 'none' && startCountdownValue !== null;
  const showStartBoostHint =
    typeof startCountdownValue === 'number' &&
    startCountdownValue > 0 &&
    startCountdownValue <= START_COUNTDOWN_CHARGE_HINT_FROM;
  const startBoostHint =
    raceConfig.humanCount === 1 ?
      'Maintiens Z pour charger le boost de depart'
    : 'Maintiens acceleration pour charger le boost de depart';
  const startCountdownLabel =
    startCountdownValue === 0 ? 'Partez'
    : typeof startCountdownValue === 'number' ? String(startCountdownValue)
    : '';
  const liveScoreboard = useMemo<LiveScoreboardEntry[]>(() => {
    const hasCheckpoint = Boolean(circuit.lapCheckpoint);
    const ranking = raceConfig.participants.map((participant) => {
      const progress = lapProgressByPlayer[participant.id] ?? FALLBACK_PROGRESS;
      const completedLaps = Math.min(Math.max(progress.lap - 1, 0), 3);
      const pose = poseRefsByParticipant[participant.id]?.current;
      const targetMarker = progress.checkpoint ? lapStartMarker : lapCheckpointMarker;
      const distanceToTarget =
        hasCheckpoint ? distanceFromPoseToPoint(pose, targetMarker) : Number.POSITIVE_INFINITY;
      const segmentProgress =
        hasCheckpoint ? clampValue(1 - distanceToTarget / lapSegmentDistance, 0, 0.999) : 0;
      const progressionScore =
        completedLaps * 2 + (progress.checkpoint ? 1 : 0) + (progress.finished ? 1 : segmentProgress);

      return {
        participantId: participant.id,
        displayName: participant.displayName,
        completedLaps,
        checkpoint: progress.checkpoint,
        finished: progress.finished,
        finishTimestamp: progress.finishTimestamp ?? Number.POSITIVE_INFINITY,
        progressionScore,
      };
    });

    ranking.sort((left, right) => {
      if (left.finished !== right.finished) return left.finished ? -1 : 1;
      if (left.finished && right.finished && left.finishTimestamp !== right.finishTimestamp) {
        return left.finishTimestamp - right.finishTimestamp;
      }
      if (left.progressionScore !== right.progressionScore) {
        return right.progressionScore - left.progressionScore;
      }
      return (
        (participantOrder.get(left.participantId) ?? 0) -
        (participantOrder.get(right.participantId) ?? 0)
      );
    });

    return ranking.map(({ finishTimestamp: _ignoredTime, progressionScore: _ignoredScore, ...entry }, index) => ({
      ...entry,
      position: index + 1,
    }));
  }, [
    circuit.lapCheckpoint,
    lapCheckpointMarker,
    lapProgressByPlayer,
    lapSegmentDistance,
    lapStartMarker,
    liveScoreboardTick,
    participantOrder,
    poseRefsByParticipant,
    raceConfig.participants,
  ]);
  const isCourseRankingVisible = overlayStep === 'course-ranking';
  const isCourseActionVisible = overlayStep === 'course-actions';
  const isGrandPrixResultVisible = overlayStep === 'grand-prix-result';
  const shouldRenderRaceWorld = !isGrandPrixResultVisible;

  useEffect(() => {
    if (!sceneReady || isLoadingOverlayActive || overlayStep !== 'none') return;
    if (startCountdownStartedRef.current) return;

    startCountdownStartedRef.current = true;
    setStartCountdownValue(START_COUNTDOWN_INITIAL);
  }, [isLoadingOverlayActive, overlayStep, sceneReady]);

  useEffect(() => {
    if (!sceneReady || isLoadingOverlayActive || overlayStep !== 'none') return;

    const timerId = window.setInterval(() => {
      setLiveScoreboardTick((prev) => (prev + 1) % 1_000_000);
    }, LIVE_SCOREBOARD_REFRESH_MS);
    return () => window.clearInterval(timerId);
  }, [isLoadingOverlayActive, overlayStep, sceneReady]);

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
      {raceConfig.humanCount === 2 ? <div className="split-divider" aria-hidden /> : null}
      {loadingOverlayVisible ? (
        <div
          className={`absolute inset-0 z-[80] transition-opacity duration-500 ${
            loadingOverlayFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <img
            src="/ui/grand-prix/courses/preview-00.png"
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
          <img
            src="/ui/MK8-Line-Yoshi-Singing.gif"
            alt=""
            aria-hidden
            className="pointer-events-none absolute bottom-4 right-4 w-[clamp(120px,18vw,240px)] max-w-[40vw] object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)]"
          />
        </div>
      ) : null}

      {isStartCountdownVisible ? (
        <div className="pointer-events-none absolute inset-0 z-[68] flex items-center justify-center">
          <div className="text-center text-white">
            <div
              className={`leading-none font-black drop-shadow-[0_14px_34px_rgba(1,8,26,0.75)] ${
                startCountdownValue === 0 ?
                  'text-[clamp(2.8rem,10vw,6.2rem)] uppercase tracking-[0.08em]'
                : 'text-[clamp(4rem,12vw,8.5rem)] tabular-nums'
              }`}
            >
              {startCountdownLabel}
            </div>
            {showStartBoostHint ? (
              <div className="mt-2 text-xs font-semibold uppercase tracking-widest text-[#ffe8a3]">
                {startBoostHint}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {sceneReady && !isLoadingOverlayActive && overlayStep === 'none' ? (
        <div className="absolute right-4 top-4 z-40 min-w-[230px] rounded-xl border border-white/30 bg-[#0a214f]/72 p-3 text-white shadow-2xl backdrop-blur-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">
            Classement live
          </div>
          <div className="mt-2 max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {liveScoreboard.map((entry) => (
              <div key={`lap-${entry.participantId}`} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-[1.75rem] font-black text-[#ffd670]">#{entry.position}</span>
                  <span className="truncate font-semibold">{entry.displayName}</span>
                </div>
                <span className="font-black tracking-wide">
                  {entry.finished ? 'Arrive' : `${entry.completedLaps}/3`}
                  {!entry.finished ? (
                    <span className="ml-1 font-medium text-white/75">
                      {entry.checkpoint ? 'CP OK' : 'CP OFF'}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sceneReady && isCourseRankingVisible ? (
        <div className="absolute inset-0 z-70 flex items-center justify-center bg-[#041334]/70 backdrop-blur-sm">
          <div className="w-[min(92vw,640px)] rounded-2xl border border-white/35 bg-[#0a2d66]/88 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Course {raceConfig.courseIndex + 1}/{raceConfig.totalCourses}
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement de la course</h2>
            <div className="mt-4 max-h-[56vh] space-y-2 overflow-y-auto pr-1">
              {courseRanking.map((entry) => (
                <div
                  key={`course-rank-${entry.participantId}`}
                  className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#ffd670]">#{entry.position}</span>
                    <span className="text-sm font-bold">{entry.displayName}</span>
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
              className="mt-5 w-full rounded-lg border border-white/35 bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-widest transition hover:bg-white/25"
              onClick={handleContinueAfterCourse}
            >
              Continuer
            </button>
          </div>
        </div>
      ) : null}

      {sceneReady && isCourseActionVisible ? (
        <div className="absolute inset-0 z-70 flex items-center justify-center bg-[#041334]/70 backdrop-blur-sm">
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
                className="w-full rounded-lg border border-white/35 bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-widest transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="w-full rounded-lg border border-white/35 bg-[#0f2148] px-4 py-2 text-sm font-black uppercase tracking-widest transition hover:bg-[#1c376f]"
                onClick={onRaceBack}
              >
                Retour au Menu
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sceneReady && isGrandPrixResultVisible ? (
        <div className="absolute inset-0 z-70 flex items-center justify-center bg-[#041334]/74 backdrop-blur-sm">
          <div className="w-[min(94vw,700px)] rounded-2xl border border-white/35 bg-[#0a2d66]/90 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Resultat Final Grand Prix
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement cumule</h2>
            <div className="mt-4 max-h-[56vh] space-y-2 overflow-y-auto pr-1">
              {grandPrixStandings.map((standing, index) => (
                <div
                  key={`grand-prix-rank-${standing.participantId}`}
                  className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#ffd670]">#{index + 1}</span>
                    <span className="text-sm font-bold">{standing.displayName}</span>
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
              className="mt-5 w-full rounded-lg border border-white/35 bg-[#0f2148] px-4 py-2 text-sm font-black uppercase tracking-widest transition hover:bg-[#1c376f]"
              onClick={onRaceBack}
            >
              Retour au Menu
            </button>
          </div>
        </div>
      ) : null}

      {shouldRenderRaceWorld ? (
        <Canvas
          shadows
          dpr={PERF_PROFILE.dpr}
          gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false }}
          camera={{ position: [8, 3, 8], fov: 80, near: PERF_PROFILE.cameraNear, far: PERF_PROFILE.cameraFar }}
          style={{ background: DAY_CLEAR_COLOR }}
          onCreated={(state) => {
            state.gl.localClippingEnabled = true;
            state.gl.shadowMap.enabled = true;
            state.gl.shadowMap.type = PCFSoftShadowMap;
          }}
        >
          <RaceEnvironmentEnforcer />
          <AdaptiveViewportPerformance />
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
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
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

            {drivableParticipants.map((participant) => (
              <DrivableModel
                key={participant.id}
                participantId={participant.id}
                controlMode={participant.controlMode}
                vehicleModel={participant.vehicleModel}
                characterModel={participant.characterModel}
                wheelModel={participant.wheelModel}
                vehicleScale={participant.vehicleScale}
                characterScale={participant.characterScale}
                wheelScale={participant.wheelScale}
                characterMount={participant.characterMount}
                wheelMounts={participant.wheelMounts}
                chassisLift={participant.chassisLift}
                driverLift={participant.driverLift}
                position={participant.spawn}
                rotation={participant.spawnRotation}
                keyBindings={participant.keyBindings}
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
              viewerPoseRefs={viewerPoseRefs}
              performance={circuit.performance}
            />

            {viewerPoseRefs.length > 1 ?
              <LocalMultiviewCameraController
                viewerPoseRefs={viewerPoseRefs}
                clipPlaneOffset={PERF_PROFILE.clipPlaneOffset}
                enableClipPlane={PERF_PROFILE.enableCameraClipPlane}
              />
            :
              <CameraController
                targetPoseRef={viewerPoseRefs[0]}
                clipPlaneOffset={PERF_PROFILE.clipPlaneOffset}
                enableClipPlane={PERF_PROFILE.enableCameraClipPlane}
              />}

              {textureDebugEnabled ? <TextureDebug onReady={handleTextureDebugReady} /> : null}
              </Physics>
            ) : null}
          </Suspense>
        </Canvas>
      ) : null}
    </div>
  );
}
