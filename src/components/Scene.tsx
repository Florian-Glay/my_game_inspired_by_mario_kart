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
import { Color, Euler, Matrix4, PCFSoftShadowMap, Quaternion, Vector3, type Group } from 'three';
import type { BotWaypoint } from '../ai/botAutopilot';
import { CHARACTERS, getCatalogItemById } from '../config/garageCatalog';
import { CC_SPEEDS, CIRCUITS } from '../config/raceCatalog';
import { PERF_PROFILE } from '../config/performanceProfile';
import { gameMode } from '../state/gamemode';
import type {
  CircuitId,
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
import { ObjectCrate, type ObjectCrateTouch } from './ObjectCrate';
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

type WaypointTransform = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

type CircuitWaypointLoaderProps = {
  model: string;
  transform: WaypointTransform;
  onReady: (waypoints: BotWaypoint[]) => void;
};

const WAYPOINT_NODE_NAME_RE = /^WP_(\d+)$/i;

function SceneAssetGate({ urls, onReady }: SceneAssetGateProps) {
  useGLTF(urls);

  useEffect(() => {
    onReady();
  }, [onReady, urls]);

  return null;
}

function extractWaypointsFromScene(
  root: Group,
  transform: WaypointTransform,
): BotWaypoint[] {
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

function CircuitWaypointLoader({ model, transform, onReady }: CircuitWaypointLoaderProps) {
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

type LiveScoreboardSortEntry = {
  participantId: RaceParticipantId;
  displayName: string;
  completedLaps: number;
  checkpoint: boolean;
  finished: boolean;
  finishTimestamp: number;
  waypointsRemainingToFinish: number;
};

type ObjectCrateSpawnEntry = {
  crateId: string;
  position: [number, number, number];
  rotation: [number, number, number];
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
const START_COUNTDOWN_DELAY_AFTER_LOADING_MS = 1500;
const LIVE_SCOREBOARD_REFRESH_MS = 280;
const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];
const OBJECT_CRATE_MODEL_PATH = 'models/item_box.glb';
const OBJECT_CRATE_RESPAWN_MS = 10_000;
const OBJECT_ITEM_MIN_VALUE = 1;
const OBJECT_ITEM_MAX_VALUE = 13;
const OBJECT_MUSHROOM_VALUE = 2;
const OBJECT_THUNDER_VALUE = 10;
const OBJECT_THUNDER_ELIGIBLE_MIN_POSITION = 10;
const OBJECT_THUNDER_BASE_DURATION_SECONDS = 10;
const OBJECT_BULLET_BILL_VALUE = 11;
const OBJECT_BULLET_BILL_ELIGIBLE_MIN_POSITION = 11;
const OBJECT_BULLET_BILL_DURATION_SECONDS = 15;
const OBJECT_COIN_VALUE = 13;
const PLAYER_COIN_MAX = 10;
const OBJECT_MUSHROOM_INITIAL_CHARGES = 3;
const OBJECT_DEFAULT_INITIAL_CHARGES = 1;
const OBJECT_AVAILABLE_ITEM_VALUES = [
  1,
  OBJECT_MUSHROOM_VALUE,
  OBJECT_THUNDER_VALUE,
  OBJECT_BULLET_BILL_VALUE,
  OBJECT_COIN_VALUE,
] as const;
const COIN_HUD_ICON_PATH = 'ui/object/objet-13.png';
const OBJECT_ATTACHABLE_VOID_MODEL_PATH = 'models/void.glb';
const OBJECT_ATTACHABLE_MUSHROOM_MODEL_PATH = 'models/miniObject/itemMushroom.glb';
const OBJECT_ATTACHABLE_THUNDER_MODEL_PATH = 'models/miniObject/ItemThunder.glb';
const OBJECT_ATTACHABLE_BULLET_BILL_MODEL_PATH = 'models/miniObject/itemBulletBill.glb';
const OBJECT_BULLET_BILL_VEHICLE_MODEL_PATH = 'models/BulletBill.glb';
const miniObjectModelModules = import.meta.glob('/models/miniObject/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const OBJECT_ATTACHABLE_MODEL_PATHS = (() => {
  const discovered = Object.entries(miniObjectModelModules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0);

  if (discovered.length > 0) return discovered;
  return ['models/miniObject/itemMushroom.glb',
          'models/miniObject/itemCoin.glb',
          'models/miniObject/itemBulletBill.glb',
  ];
})();
const DEFAULT_CHARACTER_PORTRAIT_PATH = 'ui/select/character/mario.png';
const COURSE_POINTS_BY_POSITION = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
const LIVE_SCOREBOARD_FINISH_WAYPOINT_BY_CIRCUIT: Record<CircuitId, number> = {
  kalimari_desert: 12,
  super_bell_subway: 5,
  stadium: 239,
  ds_mario_circuit: 75,
};

const resolveUiAssetSrc = (assetPath: string) => {
  if (
    assetPath.startsWith('http://') ||
    assetPath.startsWith('https://') ||
    assetPath.startsWith('data:') ||
    assetPath.startsWith('blob:')
  ) {
    return assetPath;
  }
  if (assetPath.startsWith('/')) return assetPath;
  return `${import.meta.env.BASE_URL}${assetPath}`;
};

const getCoursePointsForPosition = (position: number) => {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return COURSE_POINTS_BY_POSITION[position - 1] ?? 0;
};

const findNearestWaypointIndex = (
  pose: CarPose | null | undefined,
  waypoints: readonly BotWaypoint[],
) => {
  if (!pose || waypoints.length === 0) return null;

  let nearestWaypointIndex: number | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const waypoint of waypoints) {
    const dx = waypoint.position[0] - pose.x;
    const dy = waypoint.position[1] - pose.y;
    const dz = waypoint.position[2] - pose.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) continue;
    nearestDistanceSq = distanceSq;
    nearestWaypointIndex = waypoint.index;
  }

  return nearestWaypointIndex;
};

const getWaypointStepsToFinish = (
  currentWaypointOrder: number | null,
  finishWaypointOrder: number | null,
  waypointCount: number,
) => {
  if (currentWaypointOrder === null || finishWaypointOrder === null || waypointCount <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (finishWaypointOrder - currentWaypointOrder + waypointCount) % waypointCount;
};

const buildLiveScoreboardEntries = ({
  participants,
  progressByPlayer,
  poseRefsByParticipant,
  participantOrder,
  circuitWaypoints,
  waypointOrderByIndex,
  finishWaypointOrder,
  waypointCount,
}: {
  participants: RaceConfig['participants'];
  progressByPlayer: Record<RaceParticipantId, PlayerLapProgress>;
  poseRefsByParticipant: Record<RaceParticipantId, MutableRefObject<CarPose>>;
  participantOrder: Map<RaceParticipantId, number>;
  circuitWaypoints: readonly BotWaypoint[];
  waypointOrderByIndex: Map<number, number>;
  finishWaypointOrder: number | null;
  waypointCount: number;
}): LiveScoreboardEntry[] => {
  const ranking: LiveScoreboardSortEntry[] = participants.map((participant) => {
    const progress = progressByPlayer[participant.id] ?? FALLBACK_PROGRESS;
    const completedLaps = Math.min(Math.max(progress.lap - 1, 0), 3);
    const pose = poseRefsByParticipant[participant.id]?.current;
    const currentWaypointIndex = findNearestWaypointIndex(pose, circuitWaypoints);
    const currentWaypointOrder =
      currentWaypointIndex === null ? null : (waypointOrderByIndex.get(currentWaypointIndex) ?? null);
    const waypointsRemainingToFinish = getWaypointStepsToFinish(
      currentWaypointOrder,
      finishWaypointOrder,
      waypointCount,
    );

    return {
      participantId: participant.id,
      displayName: participant.displayName,
      completedLaps,
      checkpoint: progress.checkpoint,
      finished: progress.finished,
      finishTimestamp: progress.finishTimestamp ?? Number.POSITIVE_INFINITY,
      waypointsRemainingToFinish,
    };
  });

  ranking.sort((left, right) => {
    if (left.finished !== right.finished) return left.finished ? -1 : 1;
    if (left.finished && right.finished && left.finishTimestamp !== right.finishTimestamp) {
      return left.finishTimestamp - right.finishTimestamp;
    }
    if (left.completedLaps !== right.completedLaps) {
      return right.completedLaps - left.completedLaps;
    }
    if (left.waypointsRemainingToFinish !== right.waypointsRemainingToFinish) {
      return left.waypointsRemainingToFinish - right.waypointsRemainingToFinish;
    }
    return (
      (participantOrder.get(left.participantId) ?? 0) -
      (participantOrder.get(right.participantId) ?? 0)
    );
  });

  return ranking.map(
    ({ finishTimestamp: _ignoredTime, waypointsRemainingToFinish: _ignoredWaypoints, ...entry }, index) => ({
      ...entry,
      position: index + 1,
    }),
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

function createInitialParticipantObjects(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function createInitialParticipantObjectCharges(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function createInitialParticipantThunderDebuffUntil(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function createInitialParticipantBulletBillUntil(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function createInitialParticipantCoins(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function createObjectCrateActivationMap(spawns: ObjectCrateSpawnEntry[]) {
  return spawns.reduce<Record<string, boolean>>((acc, spawn) => {
    acc[spawn.crateId] = true;
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
  const [circuitWaypoints, setCircuitWaypoints] = useState<BotWaypoint[]>([]);
  const initialLapProgress = useMemo(
    () => createInitialLapProgress(raceConfig.participants),
    [raceConfig.participants],
  );
  const initialParticipantObjects = useMemo(
    () => createInitialParticipantObjects(raceConfig.participants),
    [raceConfig.participants],
  );
  const initialParticipantObjectCharges = useMemo(
    () => createInitialParticipantObjectCharges(raceConfig.participants),
    [raceConfig.participants],
  );
  const initialParticipantThunderDebuffUntil = useMemo(
    () => createInitialParticipantThunderDebuffUntil(raceConfig.participants),
    [raceConfig.participants],
  );
  const initialParticipantBulletBillUntil = useMemo(
    () => createInitialParticipantBulletBillUntil(raceConfig.participants),
    [raceConfig.participants],
  );
  const initialParticipantCoins = useMemo(
    () => createInitialParticipantCoins(raceConfig.participants),
    [raceConfig.participants],
  );
  const [lapProgressByPlayer, setLapProgressByPlayer] = useState<Record<RaceParticipantId, PlayerLapProgress>>(
    initialLapProgress,
  );
  const [myObjectByParticipant, setMyObjectByParticipant] = useState<Record<RaceParticipantId, number>>(
    initialParticipantObjects,
  );
  const [myObjectChargesByParticipant, setMyObjectChargesByParticipant] = useState<
    Record<RaceParticipantId, number>
  >(initialParticipantObjectCharges);
  const [thunderDebuffUntilByParticipant, setThunderDebuffUntilByParticipant] = useState<
    Record<RaceParticipantId, number>
  >(initialParticipantThunderDebuffUntil);
  const [bulletBillUntilByParticipant, setBulletBillUntilByParticipant] = useState<
    Record<RaceParticipantId, number>
  >(initialParticipantBulletBillUntil);
  const [coinsByParticipant, setCoinsByParticipant] = useState<Record<RaceParticipantId, number>>(
    initialParticipantCoins,
  );
  const lapProgressRef = useRef<Record<RaceParticipantId, PlayerLapProgress>>(initialLapProgress);
  const myObjectByParticipantRef = useRef<Record<RaceParticipantId, number>>(initialParticipantObjects);
  const myObjectChargesByParticipantRef = useRef<Record<RaceParticipantId, number>>(
    initialParticipantObjectCharges,
  );
  const thunderDebuffUntilByParticipantRef = useRef<Record<RaceParticipantId, number>>(
    initialParticipantThunderDebuffUntil,
  );
  const bulletBillUntilByParticipantRef = useRef<Record<RaceParticipantId, number>>(
    initialParticipantBulletBillUntil,
  );
  const coinsByParticipantRef = useRef<Record<RaceParticipantId, number>>(initialParticipantCoins);
  const [courseRanking, setCourseRanking] = useState<CourseRankingEntry[]>([]);
  const [overlayStep, setOverlayStep] = useState<RaceOverlayStep>('none');
  const [controlsLocked, setControlsLocked] = useState(true);
  const [startCountdownValue, setStartCountdownValue] = useState<number | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(true);
  const [loadingOverlayFading, setLoadingOverlayFading] = useState(false);
  const [loadingBackdropFailed, setLoadingBackdropFailed] = useState(false);
  const [loadingMascotFailed, setLoadingMascotFailed] = useState(false);
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
  const loadingBackdropSrc = `${import.meta.env.BASE_URL}ui/grand-prix/courses/preview-00.png`;
  const loadingMascotSrc = `${import.meta.env.BASE_URL}ui/MK8-Line-Yoshi-Singing.gif`;
  const circuitWaypointTransform = circuit.waypoints?.transform ?? circuit.transform;
  const requiredAssetUrls = useMemo(() => {
    const urls = [
      circuit.road.model,
      circuit.ext.model,
      OBJECT_CRATE_MODEL_PATH,
      OBJECT_ATTACHABLE_VOID_MODEL_PATH,
      OBJECT_ATTACHABLE_MUSHROOM_MODEL_PATH,
      OBJECT_ATTACHABLE_THUNDER_MODEL_PATH,
      OBJECT_ATTACHABLE_BULLET_BILL_MODEL_PATH,
      OBJECT_BULLET_BILL_VEHICLE_MODEL_PATH,
      ...OBJECT_ATTACHABLE_MODEL_PATHS,
    ];
    if (circuit.antiGravIn?.model) urls.push(circuit.antiGravIn.model);
    if (circuit.antiGravOut?.model) urls.push(circuit.antiGravOut.model);
    if (circuit.booster?.model) urls.push(circuit.booster.model);
    if (circuit.lapStart?.model) urls.push(circuit.lapStart.model);
    if (circuit.lapCheckpoint?.model) urls.push(circuit.lapCheckpoint.model);
    if (circuit.waypoints?.model) urls.push(circuit.waypoints.model);
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
    circuit.waypoints?.model,
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
  const participantPortraitSrcById = useMemo(() => {
    const fallbackSrc = resolveUiAssetSrc(DEFAULT_CHARACTER_PORTRAIT_PATH);
    const portraitsByParticipant = new Map<RaceParticipantId, string>();
    for (const participant of raceConfig.participants) {
      const character = getCatalogItemById(CHARACTERS, participant.loadout.characterId);
      portraitsByParticipant.set(participant.id, resolveUiAssetSrc(character.thumbnail ?? fallbackSrc));
    }
    return portraitsByParticipant;
  }, [raceConfig.participants]);
  const orderedWaypointIndices = useMemo(
    () => circuitWaypoints.map((waypoint) => waypoint.index),
    [circuitWaypoints],
  );
  const waypointOrderByIndex = useMemo(() => {
    const order = new Map<number, number>();
    orderedWaypointIndices.forEach((waypointIndex, index) => {
      order.set(waypointIndex, index);
    });
    return order;
  }, [orderedWaypointIndices]);
  const finishWaypointIndex = LIVE_SCOREBOARD_FINISH_WAYPOINT_BY_CIRCUIT[raceConfig.circuit];
  const finishWaypointOrder = waypointOrderByIndex.get(finishWaypointIndex) ?? null;
  const objectCrateSpawnEntries = useMemo<ObjectCrateSpawnEntry[]>(
    () =>
      circuit.objectCrateSpawns.map((spawn, index) => ({
        crateId: `${raceConfig.courseId}-crate-${index}`,
        position: [spawn.position[0], spawn.position[1], spawn.position[2]],
        rotation: [spawn.rotation[0], spawn.rotation[1], spawn.rotation[2]],
      })),
    [circuit.objectCrateSpawns, raceConfig.courseId],
  );
  const initialObjectCrates = useMemo(
    () => createObjectCrateActivationMap(objectCrateSpawnEntries),
    [objectCrateSpawnEntries],
  );
  const [activeObjectCrates, setActiveObjectCrates] = useState<Record<string, boolean>>(initialObjectCrates);
  const objectCrateRespawnTimersRef = useRef<Map<string, number>>(new Map());
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
    setLoadingBackdropFailed(false);
    setLoadingMascotFailed(false);
  }, [assetGateKey, circuitPhysicsKey, textureDebugEnabled]);

  useEffect(() => {
    setCircuitWaypoints([]);
  }, [raceConfig.circuit, raceConfig.courseId]);

  useEffect(() => {
    objectCrateRespawnTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    objectCrateRespawnTimersRef.current.clear();
    setActiveObjectCrates(initialObjectCrates);

    return () => {
      objectCrateRespawnTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      objectCrateRespawnTimersRef.current.clear();
    };
  }, [initialObjectCrates]);

  useEffect(() => {
    myObjectByParticipantRef.current = myObjectByParticipant;
  }, [myObjectByParticipant]);

  useEffect(() => {
    myObjectChargesByParticipantRef.current = myObjectChargesByParticipant;
  }, [myObjectChargesByParticipant]);

  useEffect(() => {
    thunderDebuffUntilByParticipantRef.current = thunderDebuffUntilByParticipant;
  }, [thunderDebuffUntilByParticipant]);

  useEffect(() => {
    bulletBillUntilByParticipantRef.current = bulletBillUntilByParticipant;
  }, [bulletBillUntilByParticipant]);

  useEffect(() => {
    coinsByParticipantRef.current = coinsByParticipant;
  }, [coinsByParticipant]);

  useEffect(() => {
    lapProgressRef.current = initialLapProgress;
    setLapProgressByPlayer(initialLapProgress);
    setCourseRanking([]);
    setOverlayStep('none');
    setControlsLocked(true);
    setStartCountdownValue(null);
    setMenuBusy(false);
    setLiveScoreboardTick(0);
    setMyObjectByParticipant(initialParticipantObjects);
    setMyObjectChargesByParticipant(initialParticipantObjectCharges);
    setThunderDebuffUntilByParticipant(initialParticipantThunderDebuffUntil);
    setBulletBillUntilByParticipant(initialParticipantBulletBillUntil);
    setCoinsByParticipant(initialParticipantCoins);
    myObjectByParticipantRef.current = initialParticipantObjects;
    myObjectChargesByParticipantRef.current = initialParticipantObjectCharges;
    thunderDebuffUntilByParticipantRef.current = initialParticipantThunderDebuffUntil;
    bulletBillUntilByParticipantRef.current = initialParticipantBulletBillUntil;
    coinsByParticipantRef.current = initialParticipantCoins;
    courseResultSentRef.current = false;
    startCountdownStartedRef.current = false;
    winModeHandledRef.current = false;
    gameMode.current = 'run';
  }, [
    initialLapProgress,
    initialParticipantObjectCharges,
    initialParticipantObjects,
    initialParticipantBulletBillUntil,
    initialParticipantCoins,
    initialParticipantThunderDebuffUntil,
    raceConfig.courseId,
  ]);

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

  const getLiveScoreboardSnapshot = useCallback(
    (progressByPlayer: Record<RaceParticipantId, PlayerLapProgress> = lapProgressRef.current) =>
      buildLiveScoreboardEntries({
        participants: raceConfig.participants,
        progressByPlayer,
        poseRefsByParticipant,
        participantOrder,
        circuitWaypoints,
        waypointOrderByIndex,
        finishWaypointOrder,
        waypointCount: orderedWaypointIndices.length,
      }),
    [
      circuitWaypoints,
      finishWaypointOrder,
      orderedWaypointIndices.length,
      participantOrder,
      poseRefsByParticipant,
      raceConfig.participants,
      waypointOrderByIndex,
    ],
  );

  const handleObjectCrateCollected = useCallback((crateId: string, touch: ObjectCrateTouch) => {
    setActiveObjectCrates((current) => {
      if (!current[crateId]) return current;
      return { ...current, [crateId]: false };
    });

    const currentObject = myObjectByParticipantRef.current[touch.participantId] ?? 0;
    if (currentObject === 0) {
      const liveRanking = getLiveScoreboardSnapshot();
      const nowMs = performance.now();
      const collectorPosition =
        liveRanking.find((entry) => entry.participantId === touch.participantId)?.position ??
        Number.POSITIVE_INFINITY;
      const thunderAlreadyHeldByAnotherPlayer = Object.entries(myObjectByParticipantRef.current).some(
        ([participantId, objectValue]) =>
          participantId !== touch.participantId && objectValue === OBJECT_THUNDER_VALUE,
      );
      const bulletBillAlreadyHeldByAnotherPlayer = Object.entries(myObjectByParticipantRef.current).some(
        ([participantId, objectValue]) =>
          participantId !== touch.participantId && objectValue === OBJECT_BULLET_BILL_VALUE,
      );
      const bulletBillAlreadyActiveByAnyPlayer = Object.values(bulletBillUntilByParticipantRef.current).some(
        (untilMs) => typeof untilMs === 'number' && untilMs > nowMs,
      );
      const availableValues = OBJECT_AVAILABLE_ITEM_VALUES.filter((value) => {
        if (value === OBJECT_THUNDER_VALUE) {
          if (!Number.isFinite(collectorPosition)) return false;
          if (collectorPosition < OBJECT_THUNDER_ELIGIBLE_MIN_POSITION) return false;
          return !thunderAlreadyHeldByAnotherPlayer;
        }

        if (value === OBJECT_BULLET_BILL_VALUE) {
          if (!Number.isFinite(collectorPosition)) return false;
          if (collectorPosition < OBJECT_BULLET_BILL_ELIGIBLE_MIN_POSITION) return false;
          return !bulletBillAlreadyHeldByAnotherPlayer && !bulletBillAlreadyActiveByAnyPlayer;
        }

        return true;
      });
      const randomPool = availableValues.length > 0 ? availableValues : [OBJECT_ITEM_MIN_VALUE];
      const randomValue = randomPool[Math.floor(Math.random() * randomPool.length)] ?? OBJECT_ITEM_MIN_VALUE;
      const initialObjectCharges =
        randomValue === OBJECT_MUSHROOM_VALUE ? OBJECT_MUSHROOM_INITIAL_CHARGES
        : randomValue > 0 ? OBJECT_DEFAULT_INITIAL_CHARGES
        : 0;
      myObjectByParticipantRef.current = {
        ...myObjectByParticipantRef.current,
        [touch.participantId]: randomValue,
      };
      myObjectChargesByParticipantRef.current = {
        ...myObjectChargesByParticipantRef.current,
        [touch.participantId]: initialObjectCharges,
      };

      setMyObjectByParticipant((current) => ({
        ...current,
        [touch.participantId]: randomValue,
      }));
      setMyObjectChargesByParticipant((current) => ({
        ...current,
        [touch.participantId]: initialObjectCharges,
      }));
    }

    const existingTimer = objectCrateRespawnTimersRef.current.get(crateId);
    if (typeof existingTimer === 'number') {
      window.clearTimeout(existingTimer);
    }

    const respawnTimer = window.setTimeout(() => {
      setActiveObjectCrates((current) => {
        if (current[crateId]) return current;
        return { ...current, [crateId]: true };
      });
      objectCrateRespawnTimersRef.current.delete(crateId);
    }, OBJECT_CRATE_RESPAWN_MS);

    objectCrateRespawnTimersRef.current.set(crateId, respawnTimer);
  }, [getLiveScoreboardSnapshot]);

  const handleParticipantObjectUsed = useCallback(
    (participantId: RaceParticipantId, usedObject: number) => {
      const normalizedObject = Number.isFinite(usedObject) ? Math.floor(usedObject) : 0;
      if (normalizedObject === OBJECT_THUNDER_VALUE) {
        const liveRanking = getLiveScoreboardSnapshot();
        const sourceEntry = liveRanking.find((entry) => entry.participantId === participantId);
        if (!sourceEntry) return;

        const nowMs = performance.now();
        const nextDebuffMap = { ...thunderDebuffUntilByParticipantRef.current };
        let hasAnyUpdate = false;

        for (const entry of liveRanking) {
          if (entry.participantId === participantId) continue;
          if (entry.position >= sourceEntry.position) continue;

          const durationSeconds = OBJECT_THUNDER_BASE_DURATION_SECONDS / Math.max(1, entry.position);
          const candidateUntilMs = nowMs + durationSeconds * 1000;
          const currentUntilMs = nextDebuffMap[entry.participantId] ?? 0;
          if (candidateUntilMs <= currentUntilMs) continue;

          nextDebuffMap[entry.participantId] = candidateUntilMs;
          hasAnyUpdate = true;
        }

        if (!hasAnyUpdate) return;
        thunderDebuffUntilByParticipantRef.current = nextDebuffMap;
        setThunderDebuffUntilByParticipant(nextDebuffMap);
        return;
      }

      if (normalizedObject === OBJECT_BULLET_BILL_VALUE) {
        const nowMs = performance.now();
        const nextUntilMs = nowMs + OBJECT_BULLET_BILL_DURATION_SECONDS * 1000;
        const currentUntilMs = bulletBillUntilByParticipantRef.current[participantId] ?? 0;
        if (currentUntilMs >= nextUntilMs) return;

        const nextMap = {
          ...bulletBillUntilByParticipantRef.current,
          [participantId]: nextUntilMs,
        };
        bulletBillUntilByParticipantRef.current = nextMap;
        setBulletBillUntilByParticipant(nextMap);
        return;
      }

      if (normalizedObject === OBJECT_COIN_VALUE) {
        const currentCoins = coinsByParticipantRef.current[participantId] ?? 0;
        const nextCoins = Math.min(PLAYER_COIN_MAX, Math.max(0, currentCoins) + 1);
        if (nextCoins === currentCoins) return;

        const nextMap = {
          ...coinsByParticipantRef.current,
          [participantId]: nextCoins,
        };
        coinsByParticipantRef.current = nextMap;
        setCoinsByParticipant(nextMap);
      }
    },
    [getLiveScoreboardSnapshot],
  );

  const handleParticipantObjectConsumed = useCallback(
    (participantId: RaceParticipantId, consumedObject: number, consumedUnits = 1) => {
      const normalizedObject = Number.isFinite(consumedObject) ? Math.floor(consumedObject) : 0;
      const consumeCount = Number.isFinite(consumedUnits) ? Math.max(1, Math.floor(consumedUnits)) : 1;
      if (normalizedObject <= 0) return;

      const currentObject = myObjectByParticipantRef.current[participantId] ?? 0;
      if (currentObject !== normalizedObject) return;

      if (normalizedObject === OBJECT_MUSHROOM_VALUE) {
        const currentCharges = myObjectChargesByParticipantRef.current[participantId] ?? 0;
        const nextCharges = Math.max(0, currentCharges - consumeCount);
        myObjectChargesByParticipantRef.current = {
          ...myObjectChargesByParticipantRef.current,
          [participantId]: nextCharges,
        };

        setMyObjectChargesByParticipant((current) => ({
          ...current,
          [participantId]: nextCharges,
        }));

        if (nextCharges <= 0) {
          myObjectByParticipantRef.current = {
            ...myObjectByParticipantRef.current,
            [participantId]: 0,
          };
          setMyObjectByParticipant((current) => ({
            ...current,
            [participantId]: 0,
          }));
        }
        return;
      }

      myObjectByParticipantRef.current = {
        ...myObjectByParticipantRef.current,
        [participantId]: 0,
      };
      myObjectChargesByParticipantRef.current = {
        ...myObjectChargesByParticipantRef.current,
        [participantId]: 0,
      };

      setMyObjectByParticipant((current) => ({
        ...current,
        [participantId]: 0,
      }));
      setMyObjectChargesByParticipant((current) => ({
        ...current,
        [participantId]: 0,
      }));
    },
    [],
  );

  const handleCircuitWaypointsReady = useCallback((waypoints: BotWaypoint[]) => {
    setCircuitWaypoints(waypoints);
  }, []);

  const computeLiveScoreboard = useCallback(
    (progressByPlayer: Record<RaceParticipantId, PlayerLapProgress>) =>
      getLiveScoreboardSnapshot(progressByPlayer),
    [getLiveScoreboardSnapshot],
  );

  const finalizeCourse = useCallback(
    (progressByPlayer: Record<RaceParticipantId, PlayerLapProgress>) => {
      if (courseResultSentRef.current) return;
      courseResultSentRef.current = true;

      const liveRankingAtStop = computeLiveScoreboard(progressByPlayer);
      const ranking: CourseRankingEntry[] = liveRankingAtStop.map((entry) => {
        const progress = progressByPlayer[entry.participantId] ?? FALLBACK_PROGRESS;
        return {
          participantId: entry.participantId,
          displayName: entry.displayName,
          position: entry.position,
          lap: progress.lap,
          checkpointReached: progress.checkpoint,
          finished: progress.finished,
        };
      });

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
      computeLiveScoreboard,
    ],
  );

  const validateAllLapsFromWinMode = useCallback(() => {
    if (overlayStep !== 'none') return false;

    finalizeCourse(lapProgressRef.current);
    return true;
  }, [finalizeCourse, overlayStep]);

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
  const liveScoreboard = useMemo<LiveScoreboardEntry[]>(
    () => computeLiveScoreboard(lapProgressByPlayer),
    [computeLiveScoreboard, lapProgressByPlayer, liveScoreboardTick],
  );
  const isCourseRankingVisible = overlayStep === 'course-ranking';
  const isCourseActionVisible = overlayStep === 'course-actions';
  const isGrandPrixResultVisible = overlayStep === 'grand-prix-result';
  const shouldRenderRaceWorld = !isGrandPrixResultVisible;
  const participantPortraitFallbackSrc = resolveUiAssetSrc(DEFAULT_CHARACTER_PORTRAIT_PATH);
  const getParticipantPortraitSrc = (participantId: RaceParticipantId) =>
    participantPortraitSrcById.get(participantId) ?? participantPortraitFallbackSrc;
  const hudParticipantId = humanParticipants[0]?.id ?? null;
  const hudMyObject =
    hudParticipantId ? (myObjectByParticipant[hudParticipantId] ?? 0) : 0;
  const hudObjectIconSrc =
    hudMyObject > 0 ? `${import.meta.env.BASE_URL}ui/object/objet-${hudMyObject}.png` : null;
  const coinHudIconSrc = `${import.meta.env.BASE_URL}${COIN_HUD_ICON_PATH}`;
  const humanCoinHudEntries = humanParticipants.map((participant) => ({
    participantId: participant.id,
    displayName: participant.displayName,
    coins: Math.min(PLAYER_COIN_MAX, Math.max(0, coinsByParticipant[participant.id] ?? 0)),
  }));

  useEffect(() => {
    if (!sceneReady || isLoadingOverlayActive || overlayStep !== 'none') return;
    if (startCountdownStartedRef.current) return;

    const delayTimer = window.setTimeout(() => {
      if (startCountdownStartedRef.current) return;
      startCountdownStartedRef.current = true;
      setStartCountdownValue(START_COUNTDOWN_INITIAL);
    }, START_COUNTDOWN_DELAY_AFTER_LOADING_MS);

    return () => window.clearTimeout(delayTimer);
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
    <div className="relative h-full w-full">
      <button type="button" className="mk-back-btn" onClick={onRaceBack}>
        Retour
      </button>
      {raceConfig.humanCount === 2 ? <div className="split-divider" aria-hidden /> : null}
      {loadingOverlayVisible ? (
        <div
          className={`absolute inset-0 z-80 transition-opacity duration-500 ${
            loadingOverlayFading ? 'opacity-0' : 'opacity-100'
          } bg-[#0a214f]`}
        >
          {!loadingBackdropFailed ? (
            <img
              src={loadingBackdropSrc}
              alt=""
              aria-hidden
              className="h-full w-full object-cover"
              onError={() => setLoadingBackdropFailed(true)}
            />
          ) : (
            <div
              className="h-full w-full bg-[radial-gradient(circle_at_18%_22%,rgba(142,203,255,0.45),transparent_38%),radial-gradient(circle_at_85%_80%,rgba(89,132,255,0.5),transparent_44%),linear-gradient(160deg,#0a2a9b,#2a59e8_48%,#4a78ff)]"
              aria-hidden
            />
          )}
          {!loadingMascotFailed ? (
            <img
              src={loadingMascotSrc}
              alt=""
              aria-hidden
              className="pointer-events-none absolute bottom-4 right-4 w-[clamp(120px,18cqw,240px)] max-w-[40cqw] object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)]"
              onError={() => setLoadingMascotFailed(true)}
            />
          ) : null}
        </div>
      ) : null}

      {isStartCountdownVisible ? (
        <div className="pointer-events-none absolute inset-0 z-68 flex items-center justify-center">
          <div className="text-center text-white">
            <div
              className={`leading-none font-black drop-shadow-[0_14px_34px_rgba(1,8,26,0.75)] ${
                startCountdownValue === 0 ?
                  'text-[clamp(2.8rem,10cqw,6.2rem)] uppercase tracking-[0.08em]'
                : 'text-[clamp(4rem,12cqw,8.5rem)] tabular-nums'
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

      {sceneReady && !isLoadingOverlayActive ? (
        <div className="pointer-events-none absolute left-4 top-4 z-42 flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/80 bg-black/35 shadow-[0_12px_26px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          {hudObjectIconSrc ? (
            <img
              src={hudObjectIconSrc}
              alt={`Objet ${hudMyObject}`}
              className="h-[84%] w-[84%] rounded-full object-cover"
            />
          ) : (
            <div className="h-[84%] w-[84%] rounded-full border border-white/35 bg-black/30" aria-hidden />
          )}
        </div>
      ) : null}

      {sceneReady && !isLoadingOverlayActive && humanCoinHudEntries.length > 0 ? (
        <div className="pointer-events-none absolute bottom-4 right-4 z-42 flex flex-col items-end gap-2">
          {humanCoinHudEntries.map((entry) => (
            <div
              key={`coin-hud-${entry.participantId}`}
              className="flex items-center gap-2 rounded-full border border-white/60 bg-black/40 px-2 py-1 text-white shadow-[0_8px_20px_rgba(0,0,0,0.4)] backdrop-blur-sm"
            >
              <span className="max-w-[6.4rem] truncate text-[10px] font-semibold uppercase tracking-wider text-white/85">
                {entry.displayName}
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-black/45">
                <img src={coinHudIconSrc} alt="" aria-hidden className="h-[78%] w-[78%] rounded-full object-cover" />
              </div>
              <span className="min-w-13 text-right text-sm font-black tracking-wide">
                {entry.coins}/10
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {sceneReady && !isLoadingOverlayActive && overlayStep === 'none' ? (
        <div className="absolute right-4 top-4 z-40 min-w-[230px] rounded-xl border border-white/30 bg-[#0a214f]/72 p-3 text-white shadow-2xl backdrop-blur-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/85">
            Classement live
          </div>
          <div className="mt-2 max-h-[52cqh] space-y-1.5 overflow-y-auto pr-1">
            {liveScoreboard.map((entry) => (
              <div key={`lap-${entry.participantId}`} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-7 font-black text-[#ffd670]">#{entry.position}</span>
                  <img
                    src={getParticipantPortraitSrc(entry.participantId)}
                    alt=""
                    aria-hidden
                    className="h-6 w-6 rounded-full border border-white/50 object-cover"
                  />
                  <span className="truncate font-semibold">{entry.displayName}</span>
                </div>
                <span className="font-black tracking-wide">
                  {entry.finished ? 'Arrive' : `${entry.completedLaps}/3`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sceneReady && isCourseRankingVisible ? (
        <div className="absolute inset-0 z-70 flex items-center justify-center bg-[#041334]/70 backdrop-blur-sm">
          <div className="w-[min(92cqw,640px)] rounded-2xl border border-white/35 bg-[#0a2d66]/88 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Course {raceConfig.courseIndex + 1}/{raceConfig.totalCourses}
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement de la course</h2>
            <div className="mt-4 max-h-[56cqh] space-y-2 overflow-y-auto pr-1">
              {courseRanking.map((entry) => {
                const completedLaps = Math.min(Math.max(entry.lap - 1, 0), 3);
                const earnedPoints = getCoursePointsForPosition(entry.position);
                return (
                  <div
                    key={`course-rank-${entry.participantId}`}
                    className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-black text-[#ffd670]">#{entry.position}</span>
                      <img
                        src={getParticipantPortraitSrc(entry.participantId)}
                        alt=""
                        aria-hidden
                        className="h-7 w-7 rounded-full border border-white/50 object-cover"
                      />
                      <span className="text-sm font-bold">{entry.displayName}</span>
                    </div>
                    <div className="text-right text-xs font-semibold text-white/85">
                      <div>Tour {completedLaps}/3</div>
                      <div className="text-[#8fe0ff]">+{earnedPoints} pts</div>
                    </div>
                  </div>
                );
              })}
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
          <div className="w-[min(92cqw,580px)] rounded-2xl border border-white/35 bg-[#0a2d66]/88 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
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
          <div className="w-[min(94cqw,700px)] rounded-2xl border border-white/35 bg-[#0a2d66]/90 p-6 text-white shadow-[0_24px_60px_rgba(2,8,28,0.55)]">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/80">
              Resultat Final Grand Prix
            </div>
            <h2 className="mt-2 text-2xl font-black">Classement cumule</h2>
            <div className="mt-4 max-h-[56cqh] space-y-2 overflow-y-auto pr-1">
              {grandPrixStandings.map((standing, index) => (
                <div
                  key={`grand-prix-rank-${standing.participantId}`}
                  className="flex items-center justify-between rounded-lg border border-white/20 bg-white/10 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-[#ffd670]">#{index + 1}</span>
                    <img
                      src={getParticipantPortraitSrc(standing.participantId)}
                      alt=""
                      aria-hidden
                      className="h-7 w-7 rounded-full border border-white/50 object-cover"
                    />
                    <span className="text-sm font-bold">{standing.displayName}</span>
                  </div>
                  <div className="text-right text-xs font-semibold text-white/90">
                    <div>Total: {standing.totalScore} pts</div>
                    <div className="text-white/70">
                      Courses: {standing.courseScores.map((score) => `+${score}`).join(' ') || '-'}
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
            {circuit.waypoints?.model ? (
              <CircuitWaypointLoader
                key={`${raceConfig.courseId}-waypoints`}
                model={circuit.waypoints.model}
                transform={circuitWaypointTransform}
                onReady={handleCircuitWaypointsReady}
              />
            ) : null}
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

            {objectCrateSpawnEntries.map((spawn) =>
              activeObjectCrates[spawn.crateId] ? (
                <ObjectCrate
                  key={spawn.crateId}
                  crateId={spawn.crateId}
                  position={spawn.position}
                  rotation={spawn.rotation}
                  modelPath={OBJECT_CRATE_MODEL_PATH}
                  onCollected={handleObjectCrateCollected}
                />
              ) : null,
            )}

            {drivableParticipants.map((participant) => (
              <DrivableModel
                key={participant.id}
                participantId={participant.id}
                participantName={participant.displayName}
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
                botWaypoints={circuitWaypoints}
                autopilotCourseKey={raceConfig.courseId}
                surfaceAttachment={circuit.vehicleAttachment}
                antiGravSwitchesEnabled={Boolean(circuit.antiGravIn || circuit.antiGravOut)}
                booster={circuit.booster}
                myObject={myObjectByParticipant[participant.id] ?? 0}
                myObjectCharges={myObjectChargesByParticipant[participant.id] ?? 0}
                coinCount={coinsByParticipant[participant.id] ?? 0}
                thunderDebuffUntilTimestampMs={thunderDebuffUntilByParticipant[participant.id] ?? 0}
                bulletBillUntilTimestampMs={bulletBillUntilByParticipant[participant.id] ?? 0}
                objectItemMaxValue={OBJECT_ITEM_MAX_VALUE}
                miniObjectModelPaths={OBJECT_ATTACHABLE_MODEL_PATHS}
                onObjectUsed={handleParticipantObjectUsed}
                onObjectConsumed={handleParticipantObjectConsumed}
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
