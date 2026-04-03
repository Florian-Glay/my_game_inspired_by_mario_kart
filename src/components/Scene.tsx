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
  BotDrivingTacticalState,
  BotItemTacticalState,
  CircuitId,
  CarPose,
  CourseRaceResult,
  CourseRankingEntry,
  GrandPrixStanding,
  HumanPlayerSlotId,
  RaceConfig,
  RaceParticipantId,
  Vec3,
} from '../types/game';
import { getRaceAssetUrls, RACE_ATTACHABLE_MODEL_URLS } from '../utils/raceAssetMemory';
import type {
  MultiplayerRaceEvent,
  MultiplayerRaceState,
  MultiplayerThrowableRemovalReason,
} from '../../shared/multiplayerProtocol';
import {
  MULTIPLAYER_OBJECT_CRATE_RESPAWN_MS,
  MULTIPLAYER_START_COUNTDOWN_MS,
  MULTIPLAYER_TRACK_COIN_RESPAWN_MS,
} from '../../shared/multiplayerProtocol';
import { CameraController } from './CameraController';
import { CircuitMeshCullingController } from './CircuitMeshCullingController';
import DrivableModel from './DrivableModel';
import { LocalMultiviewCameraController } from './LocalMultiviewCameraController';
import Model from './Model';
import { ObjectCrate, type ObjectCrateTouch } from './ObjectCrate';
import { SurfaceWithDrag } from './SurfaceWithDrag';
import { ThrowableObject } from './ThrowableObject';
import TextureDebug from './TextureDebug';

useGLTF.preload('models/exemple.glb');
const DAY_CLEAR_COLOR = '#7ec3ff';
const SUN_POSITION: [number, number, number] = [220, 180, -360];
const CLOUD_WRAP_X = 620;
const CLOUD_FAR_Z = -420;
const CLOUD_NEAR_Z = 160;
const TINY_VIEWPORT_AREA = 420_000;
const MEDIUM_VIEWPORT_AREA = 820_000;
const BOT_OVERTAKE_MAX_DISTANCE = 26;
const BOT_OVERTAKE_MAX_WAYPOINT_STEPS = 5;
const BOT_OVERTAKE_DIRECTION_LOOKAHEAD = 3;
const BOT_OVERTAKE_FUTURE_TURN_LOOKAHEAD = 6;
const BOT_OVERTAKE_LATERAL_DEADZONE = 0.9;
const BOT_OVERTAKE_LANE_OFFSET_MIN = 1.8;
const BOT_OVERTAKE_LANE_OFFSET_MAX = 3.2;
const BOT_OVERTAKE_TURN_BIAS_THRESHOLD = 0.14;

type SceneProps = {
  raceConfig: RaceConfig;
  onRaceBack: () => void;
  onCourseFinished: (result: CourseRaceResult) => void;
  onNextCourse: () => Promise<void> | void;
  hasNextCourse: boolean;
  isAdvancingCourse: boolean;
  grandPrixStandings: GrandPrixStanding[];
  networkRaceState?: MultiplayerRaceState | null;
  networkOwnedParticipantIds?: string[];
  onNetworkSceneReady?: (raceId: string) => void;
  onNetworkLocalPose?: (
    raceId: string,
    participantId: string,
    pose: CarPose,
    options?: {
      lapProgress?: MultiplayerRaceState['participants'][number]['lapProgress'];
      itemState?: MultiplayerRaceState['participants'][number]['itemState'];
    },
  ) => void;
  onNetworkRaceEvent?: (raceId: string, event: MultiplayerRaceEvent) => void;
  onNetworkCourseResultValidated?: (raceId: string) => void;
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

type RaceOverlayStep = 'none' | 'course-ranking' | 'grand-prix-result';

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

type TrackCoinSpawnEntry = {
  coinId: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

type ThrowableObjectEntry = {
  throwableId: string;
  sourceObjectValue: number;
  ownerParticipantId: RaceParticipantId;
  behavior: 'banana' | 'green-shell' | 'red-shell' | 'blue-shell' | 'bomb';
  modelPath: string;
  spawnPosition: [number, number, number];
  launchVelocity: [number, number, number];
  ttlMs: number;
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
const NETWORK_START_GO_HOLD_MS = 2_000;
const LOADING_OVERLAY_FADE_MS = 500;
const START_COUNTDOWN_DELAY_AFTER_LOADING_MS = 1500;
const LIVE_SCOREBOARD_REFRESH_MS = 280;
const COURSE_RESULT_OVERLAY_MS = 10_000;
const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];
const OBJECT_CRATE_MODEL_PATH = 'models/item_box.glb';
const TRACK_COIN_MODEL_PATH = 'models/miniObject/itemCoin.glb';
const TRACK_COIN_COLLIDER_HALF_EXTENTS: [number, number, number] = [0.75, 0.75, 0.75];
const OBJECT_ITEM_MIN_VALUE = 1;
const OBJECT_ITEM_MAX_VALUE = 13;
const OBJECT_MUSHROOM_VALUE = 2;
const OBJECT_BANANA_VALUE = 3;
const OBJECT_TRIPLE_BANANA_VALUE = 4;
const OBJECT_GREEN_SHELL_VALUE = 5;
const OBJECT_TRIPLE_GREEN_SHELL_VALUE = 6;
const OBJECT_RED_SHELL_VALUE = 7;
const OBJECT_TRIPLE_RED_SHELL_VALUE = 8;
const OBJECT_BLUE_SHELL_VALUE = 9;
const OBJECT_BLUE_SHELL_ELIGIBLE_MIN_POSITION = 7;
const OBJECT_BOMB_VALUE = 10;
const OBJECT_THROWABLE_VALUES = [3, 4, 5, 6, 7, 8, 9, 10, 12] as const;
const OBJECT_BULLET_BILL_VALUE = 11;
const OBJECT_BULLET_BILL_ELIGIBLE_MIN_POSITION = 11;
const OBJECT_BULLET_BILL_DURATION_SECONDS = 15;
const OBJECT_COIN_VALUE = 13;
const PLAYER_COIN_MAX = 10;
const OBJECT_MUSHROOM_INITIAL_CHARGES = 3;
const OBJECT_TRIPLE_BANANA_INITIAL_CHARGES = 3;
const OBJECT_TRIPLE_GREEN_SHELL_INITIAL_CHARGES = 3;
const OBJECT_TRIPLE_RED_SHELL_INITIAL_CHARGES = 3;
const OBJECT_DEFAULT_INITIAL_CHARGES = 1;
const OBJECT_AVAILABLE_ITEM_VALUES = [
  1,
  OBJECT_MUSHROOM_VALUE,
  OBJECT_BANANA_VALUE,
  OBJECT_TRIPLE_BANANA_VALUE,
  OBJECT_GREEN_SHELL_VALUE,
  OBJECT_TRIPLE_GREEN_SHELL_VALUE,
  OBJECT_RED_SHELL_VALUE,
  OBJECT_TRIPLE_RED_SHELL_VALUE,
  OBJECT_BLUE_SHELL_VALUE,
  OBJECT_BOMB_VALUE,
  OBJECT_BULLET_BILL_VALUE,
  OBJECT_COIN_VALUE,
] as const;
const COIN_HUD_ICON_PATH = 'ui/object/objet-13.png';
const OBJECT_BANANA_MODEL_PATH = 'models/miniObject/itemBanana.glb';
const OBJECT_GREEN_SHELL_MODEL_PATH = 'models/miniObject/itemGreenShell.glb';
const OBJECT_RED_SHELL_MODEL_PATH = 'models/miniObject/itemRedShell.glb';
const OBJECT_BLUE_SHELL_MODEL_PATH = 'models/miniObject/itemBlueShell.glb';
const OBJECT_BOMB_MODEL_PATH = 'models/miniObject/itemBomb.glb';
const OBJECT_THROWABLE_LIFETIME_MS = 30_000;
const OBJECT_THROWABLE_HIT_STUN_DURATION_MS = 1000;
const OBJECT_BANANA_FORWARD_SPEED = 100;
const OBJECT_BANANA_UPWARD_SPEED = 12.5;
const OBJECT_BANANA_SPAWN_FORWARD_OFFSET = 2.2;
const OBJECT_BANANA_SPAWN_UP_OFFSET = 1.6;
const OBJECT_GREEN_SHELL_SPEED_MULTIPLIER = 2;
const OBJECT_GREEN_SHELL_MIN_SPEED = 0;
const OBJECT_GREEN_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
const OBJECT_GREEN_SHELL_SPAWN_UP_OFFSET = 0.9;
const OBJECT_RED_SHELL_SPEED_MULTIPLIER = 2;
const OBJECT_RED_SHELL_MIN_SPEED = 0;
const OBJECT_RED_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
const OBJECT_RED_SHELL_SPAWN_UP_OFFSET = 0.9;
const OBJECT_RED_SHELL_TARGET_RADIUS = 30;
const OBJECT_BLUE_SHELL_SPEED_MULTIPLIER = 2;
const OBJECT_BLUE_SHELL_MIN_SPEED = 0;
const OBJECT_BLUE_SHELL_SPAWN_FORWARD_OFFSET = 5.2;
const OBJECT_BLUE_SHELL_SPAWN_UP_OFFSET = 0.9;
const OBJECT_BOMB_SPEED_MULTIPLIER = 2;
const OBJECT_BOMB_MIN_FORWARD_SPEED = 30;
const OBJECT_BOMB_TARGET_DISTANCE = 100;
const OBJECT_BOMB_SPAWN_FORWARD_OFFSET = 3.2;
const OBJECT_BOMB_SPAWN_UP_OFFSET = 2.4;
const OBJECT_BOMB_GRAVITY = 9.81;
const DEFAULT_CHARACTER_PORTRAIT_PATH = 'ui/select/character/mario.png';
const COURSE_POINTS_BY_POSITION = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
const LIVE_SCOREBOARD_FINISH_WAYPOINT_BY_CIRCUIT: Record<CircuitId, number> = {
  kalimari_desert: 12,
  super_bell_subway: 5,
  stadium: 239,
  ds_mario_circuit: 75,
};
const OBJECT_THROWABLE_VALUE_SET = new Set<number>(OBJECT_THROWABLE_VALUES);

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

const resolvePoseForwardVector = (pose: CarPose) => {
  const fallbackForwardX = Number.isFinite(pose.yaw) ? Math.sin(pose.yaw) : 0;
  const fallbackForwardZ = Number.isFinite(pose.yaw) ? Math.cos(pose.yaw) : 1;
  const rawForwardXCandidate = pose.forwardX ?? fallbackForwardX;
  const rawForwardZCandidate = pose.forwardZ ?? fallbackForwardZ;
  const rawForwardX = Number.isFinite(rawForwardXCandidate) ? rawForwardXCandidate : fallbackForwardX;
  const rawForwardZ = Number.isFinite(rawForwardZCandidate) ? rawForwardZCandidate : fallbackForwardZ;
  const rawLength = Math.hypot(rawForwardX, rawForwardZ);
  return {
    forwardX: rawLength > 0.0001 ? rawForwardX / rawLength : fallbackForwardX,
    forwardZ: rawLength > 0.0001 ? rawForwardZ / rawLength : fallbackForwardZ,
  };
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

const findNearestWaypointArrayIndex = (
  position: Vec3,
  waypoints: readonly BotWaypoint[],
) => {
  if (waypoints.length === 0) return null;

  let nearestWaypointArrayIndex: number | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index];
    const dx = waypoint.position[0] - position[0];
    const dy = waypoint.position[1] - position[1];
    const dz = waypoint.position[2] - position[2];
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= nearestDistanceSq) continue;
    nearestDistanceSq = distanceSq;
    nearestWaypointArrayIndex = index;
  }

  return nearestWaypointArrayIndex;
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

const getWaypointAtOffset = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
  offset: number,
) => {
  if (currentWaypointOrder === null || waypoints.length === 0) return null;
  const normalizedIndex =
    ((currentWaypointOrder + offset) % waypoints.length + waypoints.length) % waypoints.length;
  return waypoints[normalizedIndex] ?? null;
};

const getWaypointDirectionXZ = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
  lookaheadOffset: number,
) => {
  const originWaypoint = getWaypointAtOffset(waypoints, currentWaypointOrder, 0);
  if (!originWaypoint) return null;

  const normalizedLookahead = Math.max(1, Math.floor(lookaheadOffset));
  for (let offset = 1; offset <= normalizedLookahead; offset += 1) {
    const nextWaypoint = getWaypointAtOffset(waypoints, currentWaypointOrder, offset);
    if (!nextWaypoint) continue;

    const dx = nextWaypoint.position[0] - originWaypoint.position[0];
    const dz = nextWaypoint.position[2] - originWaypoint.position[2];
    const length = Math.hypot(dx, dz);
    if (length <= 0.0001) continue;

    return {
      x: dx / length,
      z: dz / length,
    };
  }

  return null;
};

const getUpcomingTurnBias = (
  waypoints: readonly BotWaypoint[],
  currentWaypointOrder: number | null,
) => {
  const nearDirection = getWaypointDirectionXZ(waypoints, currentWaypointOrder, BOT_OVERTAKE_DIRECTION_LOOKAHEAD);
  const futureDirection = getWaypointDirectionXZ(
    waypoints,
    currentWaypointOrder,
    BOT_OVERTAKE_FUTURE_TURN_LOOKAHEAD,
  );
  if (!nearDirection || !futureDirection) return 0;
  return nearDirection.x * futureDirection.z - nearDirection.z * futureDirection.x;
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

function createInitialParticipantStunUntil(
  participants: RaceConfig['participants'],
) {
  return participants.reduce<Record<RaceParticipantId, number>>((acc, participant) => {
    acc[participant.id] = 0;
    return acc;
  }, {});
}

function buildParticipantItemStateSnapshot(
  participantId: RaceParticipantId,
  state: {
    objects: Record<RaceParticipantId, number>;
    objectCharges: Record<RaceParticipantId, number>;
    coins: Record<RaceParticipantId, number>;
    thunderDebuffUntil: Record<RaceParticipantId, number>;
    bulletBillUntil: Record<RaceParticipantId, number>;
    stunUntil: Record<RaceParticipantId, number>;
  },
) {
  return {
    heldObject: state.objects[participantId] ?? 0,
    objectCharges: state.objectCharges[participantId] ?? 0,
    coins: state.coins[participantId] ?? 0,
    thunderDebuffUntilTimestampMs: state.thunderDebuffUntil[participantId] ?? 0,
    bulletBillUntilTimestampMs: state.bulletBillUntil[participantId] ?? 0,
    stunUntilTimestampMs: state.stunUntil[participantId] ?? 0,
  };
}

function createTrackCoinActivationMap(spawns: TrackCoinSpawnEntry[]) {
  return spawns.reduce<Record<string, boolean>>((acc, spawn) => {
    acc[spawn.coinId] = true;
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
  networkRaceState = null,
  networkOwnedParticipantIds = [],
  onNetworkSceneReady,
  onNetworkLocalPose,
  onNetworkRaceEvent,
  onNetworkCourseResultValidated,
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
  const initialParticipantStunUntil = useMemo(
    () => createInitialParticipantStunUntil(raceConfig.participants),
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
  const [stunUntilByParticipant, setStunUntilByParticipant] = useState<Record<RaceParticipantId, number>>(
    initialParticipantStunUntil,
  );
  const [activeThrowableObjects, setActiveThrowableObjects] = useState<ThrowableObjectEntry[]>([]);
  const activeThrowableObjectsRef = useRef<ThrowableObjectEntry[]>([]);
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
  const stunUntilByParticipantRef = useRef<Record<RaceParticipantId, number>>(initialParticipantStunUntil);
  const throwableObjectIdCounterRef = useRef(0);
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
  const ownedParticipantDirtyStateRef = useRef<Set<RaceParticipantId>>(new Set());
  const pendingThrowableRemovalIdsRef = useRef<Set<string>>(new Set());
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
  const requiredAssetUrls = useMemo(() => getRaceAssetUrls(raceConfig), [raceConfig]);
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
  const isNetworkRace = networkRaceState !== null;
  const networkOwnedParticipantIdSet = useMemo(
    () => new Set(networkOwnedParticipantIds),
    [networkOwnedParticipantIds],
  );
  const remotePoseByParticipantId = useMemo(() => {
    const map = new Map<RaceParticipantId, CarPose>();
    if (!networkRaceState) return map;
    networkRaceState.participants.forEach((participant) => {
      if (!participant.pose) return;
      map.set(participant.participantId, participant.pose);
    });
    return map;
  }, [networkRaceState]);
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
  const trackCoinSpawnEntries = useMemo<TrackCoinSpawnEntry[]>(
    () =>
      circuit.coinSpawns.map((spawn, index) => ({
        coinId: `${raceConfig.courseId}-coin-${index}`,
        position: [spawn.position[0], spawn.position[1], spawn.position[2]],
        rotation: [spawn.rotation[0], spawn.rotation[1], spawn.rotation[2]],
      })),
    [circuit.coinSpawns, raceConfig.courseId],
  );
  const initialTrackCoins = useMemo(
    () => createTrackCoinActivationMap(trackCoinSpawnEntries),
    [trackCoinSpawnEntries],
  );
  const [activeTrackCoins, setActiveTrackCoins] = useState<Record<string, boolean>>(initialTrackCoins);
  const trackCoinRespawnTimersRef = useRef<Map<string, number>>(new Map());
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
    trackCoinRespawnTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    trackCoinRespawnTimersRef.current.clear();
    setActiveTrackCoins(initialTrackCoins);

    return () => {
      trackCoinRespawnTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      trackCoinRespawnTimersRef.current.clear();
    };
  }, [initialTrackCoins]);

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
    stunUntilByParticipantRef.current = stunUntilByParticipant;
  }, [stunUntilByParticipant]);

  useEffect(() => {
    activeThrowableObjectsRef.current = activeThrowableObjects;
  }, [activeThrowableObjects]);

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
    setStunUntilByParticipant(initialParticipantStunUntil);
    setActiveThrowableObjects([]);
    myObjectByParticipantRef.current = initialParticipantObjects;
    myObjectChargesByParticipantRef.current = initialParticipantObjectCharges;
    thunderDebuffUntilByParticipantRef.current = initialParticipantThunderDebuffUntil;
    bulletBillUntilByParticipantRef.current = initialParticipantBulletBillUntil;
    coinsByParticipantRef.current = initialParticipantCoins;
    stunUntilByParticipantRef.current = initialParticipantStunUntil;
    throwableObjectIdCounterRef.current = 0;
    courseResultSentRef.current = false;
    startCountdownStartedRef.current = false;
    winModeHandledRef.current = false;
    ownedParticipantDirtyStateRef.current.clear();
    pendingThrowableRemovalIdsRef.current.clear();
    gameMode.current = 'run';
  }, [
    initialLapProgress,
    initialParticipantObjectCharges,
    initialParticipantObjects,
    initialParticipantBulletBillUntil,
    initialParticipantCoins,
    initialParticipantStunUntil,
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

  useEffect(() => {
    if (!isNetworkRace || !networkRaceState || !sceneReady) return;
    if (networkRaceState.status !== 'loading') return;
    onNetworkSceneReady?.(networkRaceState.raceId);
  }, [isNetworkRace, networkRaceState, onNetworkSceneReady, sceneReady]);

  useEffect(() => {
    if (!isNetworkRace || !networkRaceState) return;

    if (networkRaceState.sharedState.activeObjectCrateIds) {
      const activeCrates = networkRaceState.sharedState.activeObjectCrateIds;
      setActiveObjectCrates(
        objectCrateSpawnEntries.reduce<Record<string, boolean>>((acc, spawn) => {
          acc[spawn.crateId] = activeCrates.includes(spawn.crateId);
          return acc;
        }, {}),
      );
    }

    if (networkRaceState.sharedState.activeTrackCoinIds) {
      const activeCoins = networkRaceState.sharedState.activeTrackCoinIds;
      setActiveTrackCoins(
        trackCoinSpawnEntries.reduce<Record<string, boolean>>((acc, spawn) => {
          acc[spawn.coinId] = activeCoins.includes(spawn.coinId);
          return acc;
        }, {}),
      );
    }

    const serverThrowableIds = new Set(
      networkRaceState.sharedState.throwableObjects.map((throwableObject) => throwableObject.throwableId),
    );
    pendingThrowableRemovalIdsRef.current.forEach((throwableId) => {
      if (!serverThrowableIds.has(throwableId)) {
        pendingThrowableRemovalIdsRef.current.delete(throwableId);
      }
    });

    setActiveThrowableObjects(
      networkRaceState.sharedState.throwableObjects.filter(
        (throwableObject) => !pendingThrowableRemovalIdsRef.current.has(throwableObject.throwableId),
      ),
    );
  }, [isNetworkRace, networkRaceState, objectCrateSpawnEntries, trackCoinSpawnEntries]);

  useEffect(() => {
    if (!isNetworkRace || !networkRaceState) return;

    const nextLapProgress = createInitialLapProgress(raceConfig.participants);
    const nextObjects = createInitialParticipantObjects(raceConfig.participants);
    const nextObjectCharges = createInitialParticipantObjectCharges(raceConfig.participants);
    const nextThunderDebuffUntil = createInitialParticipantThunderDebuffUntil(raceConfig.participants);
    const nextBulletBillUntil = createInitialParticipantBulletBillUntil(raceConfig.participants);
    const nextCoins = createInitialParticipantCoins(raceConfig.participants);
    const nextStunUntil = createInitialParticipantStunUntil(raceConfig.participants);

    networkRaceState.participants.forEach((participant) => {
      const shouldPreserveOwnedState =
        networkOwnedParticipantIdSet.has(participant.participantId) &&
        ownedParticipantDirtyStateRef.current.has(participant.participantId);

      nextLapProgress[participant.participantId] =
        shouldPreserveOwnedState ?
          { ...(lapProgressRef.current[participant.participantId] ?? participant.lapProgress) }
        : { ...participant.lapProgress };
      nextObjects[participant.participantId] =
        shouldPreserveOwnedState ?
          myObjectByParticipantRef.current[participant.participantId] ?? participant.itemState.heldObject
        : participant.itemState.heldObject;
      nextObjectCharges[participant.participantId] =
        shouldPreserveOwnedState ?
          myObjectChargesByParticipantRef.current[participant.participantId] ?? participant.itemState.objectCharges
        : participant.itemState.objectCharges;
      nextThunderDebuffUntil[participant.participantId] =
        shouldPreserveOwnedState ?
          thunderDebuffUntilByParticipantRef.current[participant.participantId] ??
            participant.itemState.thunderDebuffUntilTimestampMs
        : participant.itemState.thunderDebuffUntilTimestampMs;
      nextBulletBillUntil[participant.participantId] =
        shouldPreserveOwnedState ?
          bulletBillUntilByParticipantRef.current[participant.participantId] ??
            participant.itemState.bulletBillUntilTimestampMs
        : participant.itemState.bulletBillUntilTimestampMs;
      nextCoins[participant.participantId] =
        shouldPreserveOwnedState ?
          coinsByParticipantRef.current[participant.participantId] ?? participant.itemState.coins
        : participant.itemState.coins;
      nextStunUntil[participant.participantId] =
        shouldPreserveOwnedState ?
          stunUntilByParticipantRef.current[participant.participantId] ?? participant.itemState.stunUntilTimestampMs
        : participant.itemState.stunUntilTimestampMs;
    });

    lapProgressRef.current = nextLapProgress;
    myObjectByParticipantRef.current = nextObjects;
    myObjectChargesByParticipantRef.current = nextObjectCharges;
    thunderDebuffUntilByParticipantRef.current = nextThunderDebuffUntil;
    bulletBillUntilByParticipantRef.current = nextBulletBillUntil;
    coinsByParticipantRef.current = nextCoins;
    stunUntilByParticipantRef.current = nextStunUntil;

    setLapProgressByPlayer(nextLapProgress);
    setMyObjectByParticipant(nextObjects);
    setMyObjectChargesByParticipant(nextObjectCharges);
    setThunderDebuffUntilByParticipant(nextThunderDebuffUntil);
    setBulletBillUntilByParticipant(nextBulletBillUntil);
    setCoinsByParticipant(nextCoins);
    setStunUntilByParticipant(nextStunUntil);
  }, [isNetworkRace, networkOwnedParticipantIdSet, networkRaceState, raceConfig.participants]);

  const handlePoseUpdate = useCallback(
    (participantId: RaceParticipantId, pose: CarPose) => {
      const poseRef = poseRefsByParticipant[participantId];
      if (!poseRef) return;
      poseRef.current = pose;
      if (networkRaceState && networkOwnedParticipantIdSet.has(participantId)) {
        onNetworkLocalPose?.(networkRaceState.raceId, participantId, pose, {
          lapProgress: lapProgressRef.current[participantId],
          itemState: buildParticipantItemStateSnapshot(participantId, {
            objects: myObjectByParticipantRef.current,
            objectCharges: myObjectChargesByParticipantRef.current,
            coins: coinsByParticipantRef.current,
            thunderDebuffUntil: thunderDebuffUntilByParticipantRef.current,
            bulletBillUntil: bulletBillUntilByParticipantRef.current,
            stunUntil: stunUntilByParticipantRef.current,
          }),
        });
      }
    },
    [networkOwnedParticipantIdSet, networkRaceState, onNetworkLocalPose, poseRefsByParticipant],
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
    if (isNetworkRace && !networkOwnedParticipantIdSet.has(touch.participantId)) {
      return;
    }

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
      const bulletBillAlreadyHeldByAnotherPlayer = Object.entries(myObjectByParticipantRef.current).some(
        ([participantId, objectValue]) =>
          participantId !== touch.participantId && objectValue === OBJECT_BULLET_BILL_VALUE,
      );
      const bulletBillAlreadyActiveByAnyPlayer = Object.values(bulletBillUntilByParticipantRef.current).some(
        (untilMs) => typeof untilMs === 'number' && untilMs > nowMs,
      );
      const availableValues = OBJECT_AVAILABLE_ITEM_VALUES.filter((value) => {
        if (value === OBJECT_BLUE_SHELL_VALUE) {
          if (!Number.isFinite(collectorPosition)) return false;
          return collectorPosition >= OBJECT_BLUE_SHELL_ELIGIBLE_MIN_POSITION;
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
        : randomValue === OBJECT_TRIPLE_BANANA_VALUE ? OBJECT_TRIPLE_BANANA_INITIAL_CHARGES
        : randomValue === OBJECT_TRIPLE_GREEN_SHELL_VALUE ? OBJECT_TRIPLE_GREEN_SHELL_INITIAL_CHARGES
        : randomValue === OBJECT_TRIPLE_RED_SHELL_VALUE ? OBJECT_TRIPLE_RED_SHELL_INITIAL_CHARGES
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
      ownedParticipantDirtyStateRef.current.add(touch.participantId);
    }

    if (!isNetworkRace) {
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
      }, MULTIPLAYER_OBJECT_CRATE_RESPAWN_MS);

      objectCrateRespawnTimersRef.current.set(crateId, respawnTimer);
    }
    if (networkRaceState) {
      onNetworkRaceEvent?.(networkRaceState.raceId, {
        type: 'object-crate-collected',
        participantId: touch.participantId,
        crateId,
      });
    }
  }, [
    getLiveScoreboardSnapshot,
    isNetworkRace,
    networkOwnedParticipantIdSet,
    networkRaceState,
    onNetworkRaceEvent,
  ]);

  const handleTrackCoinCollected = useCallback((coinId: string, touch: ObjectCrateTouch) => {
    if (isNetworkRace && !networkOwnedParticipantIdSet.has(touch.participantId)) {
      return;
    }

    setActiveTrackCoins((current) => {
      if (!current[coinId]) return current;
      return { ...current, [coinId]: false };
    });

    const currentCoins = coinsByParticipantRef.current[touch.participantId] ?? 0;
    const nextCoins = Math.min(PLAYER_COIN_MAX, Math.max(0, currentCoins) + 1);
    if (nextCoins !== currentCoins) {
      const nextMap = {
        ...coinsByParticipantRef.current,
        [touch.participantId]: nextCoins,
      };
      coinsByParticipantRef.current = nextMap;
      setCoinsByParticipant(nextMap);
      ownedParticipantDirtyStateRef.current.add(touch.participantId);
    }

    if (!isNetworkRace) {
      const existingTimer = trackCoinRespawnTimersRef.current.get(coinId);
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer);
      }

      const respawnTimer = window.setTimeout(() => {
        setActiveTrackCoins((current) => {
          if (current[coinId]) return current;
          return { ...current, [coinId]: true };
        });
        trackCoinRespawnTimersRef.current.delete(coinId);
      }, MULTIPLAYER_TRACK_COIN_RESPAWN_MS);

      trackCoinRespawnTimersRef.current.set(coinId, respawnTimer);
    }
    if (networkRaceState) {
      onNetworkRaceEvent?.(networkRaceState.raceId, {
        type: 'track-coin-collected',
        participantId: touch.participantId,
        coinId,
      });
    }
  }, [isNetworkRace, networkOwnedParticipantIdSet, networkRaceState, onNetworkRaceEvent]);

  const reportThrowableRemoval = useCallback(
    (
      throwableId: string,
      reporterParticipantId: RaceParticipantId | null,
      reason: MultiplayerThrowableRemovalReason,
    ) => {
      if (!networkRaceState || !reporterParticipantId) return;
      if (!networkOwnedParticipantIdSet.has(reporterParticipantId)) return;
      if (pendingThrowableRemovalIdsRef.current.has(throwableId)) return;

      pendingThrowableRemovalIdsRef.current.add(throwableId);
      onNetworkRaceEvent?.(networkRaceState.raceId, {
        type: 'throwable-removed',
        participantId: reporterParticipantId,
        throwableId,
        reason,
      });
    },
    [networkOwnedParticipantIdSet, networkRaceState, onNetworkRaceEvent],
  );

  const removeThrowableObject = useCallback((throwableId: string) => {
    setActiveThrowableObjects((current) => {
      const next = current.filter((entry) => entry.throwableId !== throwableId);
      return next.length === current.length ? current : next;
    });
  }, []);

  const handleThrowableObjectExpired = useCallback(
    (throwableId: string) => {
      const throwableObject =
        activeThrowableObjectsRef.current.find((entry) => entry.throwableId === throwableId) ?? null;
      reportThrowableRemoval(throwableId, throwableObject?.ownerParticipantId ?? null, 'expired');
      removeThrowableObject(throwableId);
    },
    [removeThrowableObject, reportThrowableRemoval],
  );

  const handleThrowableObjectGroundedParticipantHit = useCallback(
    (throwableId: string, participantId: RaceParticipantId, sourceObjectValue: number) => {
      reportThrowableRemoval(throwableId, participantId, 'hit');
      if (
        sourceObjectValue === OBJECT_BANANA_VALUE ||
        sourceObjectValue === OBJECT_TRIPLE_BANANA_VALUE ||
        sourceObjectValue === OBJECT_GREEN_SHELL_VALUE ||
        sourceObjectValue === OBJECT_TRIPLE_GREEN_SHELL_VALUE ||
        sourceObjectValue === OBJECT_RED_SHELL_VALUE ||
        sourceObjectValue === OBJECT_TRIPLE_RED_SHELL_VALUE ||
        sourceObjectValue === OBJECT_BLUE_SHELL_VALUE ||
        sourceObjectValue === OBJECT_BOMB_VALUE
      ) {
        const nowMs = performance.now();
        const nextUntilMs = nowMs + OBJECT_THROWABLE_HIT_STUN_DURATION_MS;
        const currentUntilMs = stunUntilByParticipantRef.current[participantId] ?? 0;
        if (nextUntilMs > currentUntilMs) {
          const nextMap = {
            ...stunUntilByParticipantRef.current,
            [participantId]: nextUntilMs,
          };
          stunUntilByParticipantRef.current = nextMap;
          setStunUntilByParticipant(nextMap);
          if (networkOwnedParticipantIdSet.has(participantId)) {
            ownedParticipantDirtyStateRef.current.add(participantId);
          }
        }
      }
    },
    [networkOwnedParticipantIdSet, reportThrowableRemoval],
  );

  const resolveCurrentPoseForwardVector = useCallback((pose: CarPose) => resolvePoseForwardVector(pose), []);

  const resolveCurrentVehicleSpeed = useCallback(
    (pose: CarPose) => {
      const candidate = pose.speed;
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return Math.max(0, speedProfile.maxForward);
      }
      return Math.max(0, Math.abs(candidate));
    },
    [speedProfile.maxForward],
  );

  const publishThrowableObjectSpawn = useCallback(
    (spawnedObject: ThrowableObjectEntry) => {
      if (
        networkRaceState &&
        networkOwnedParticipantIdSet.has(spawnedObject.ownerParticipantId)
      ) {
        onNetworkRaceEvent?.(networkRaceState.raceId, {
          type: 'throwable-spawned',
          throwable: spawnedObject,
        });
        return;
      }

      setActiveThrowableObjects((current) => {
        if (current.some((entry) => entry.throwableId === spawnedObject.throwableId)) {
          return current;
        }
        return [...current, spawnedObject];
      });
    },
    [networkOwnedParticipantIdSet, networkRaceState, onNetworkRaceEvent],
  );

  const spawnBananaThrowableObject = useCallback(
    (participantId: RaceParticipantId, sourceObjectValue: number) => {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (!pose) return;
      const { forwardX, forwardZ } = resolveCurrentPoseForwardVector(pose);

      const throwableId = `${raceConfig.courseId}-${participantId}-throwable-${throwableObjectIdCounterRef.current}`;
      throwableObjectIdCounterRef.current += 1;

      const spawnedObject: ThrowableObjectEntry = {
        throwableId,
        sourceObjectValue,
        ownerParticipantId: participantId,
        behavior: 'banana',
        modelPath: OBJECT_BANANA_MODEL_PATH,
        spawnPosition: [
          pose.x + forwardX * OBJECT_BANANA_SPAWN_FORWARD_OFFSET,
          pose.y + OBJECT_BANANA_SPAWN_UP_OFFSET,
          pose.z + forwardZ * OBJECT_BANANA_SPAWN_FORWARD_OFFSET,
        ],
        launchVelocity: [
          forwardX * OBJECT_BANANA_FORWARD_SPEED,
          OBJECT_BANANA_UPWARD_SPEED,
          forwardZ * OBJECT_BANANA_FORWARD_SPEED,
        ],
        ttlMs: OBJECT_THROWABLE_LIFETIME_MS,
      };

      publishThrowableObjectSpawn(spawnedObject);
    },
    [poseRefsByParticipant, publishThrowableObjectSpawn, raceConfig.courseId, resolveCurrentPoseForwardVector],
  );

  const spawnGreenShellThrowableObject = useCallback(
    (participantId: RaceParticipantId, sourceObjectValue: number) => {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (!pose) return;
      const { forwardX, forwardZ } = resolveCurrentPoseForwardVector(pose);
      const currentSpeed = resolveCurrentVehicleSpeed(pose);
      const launchSpeed = Math.max(
        OBJECT_GREEN_SHELL_MIN_SPEED,
        currentSpeed * OBJECT_GREEN_SHELL_SPEED_MULTIPLIER,
      );

      const throwableId = `${raceConfig.courseId}-${participantId}-throwable-${throwableObjectIdCounterRef.current}`;
      throwableObjectIdCounterRef.current += 1;

      const spawnedObject: ThrowableObjectEntry = {
        throwableId,
        sourceObjectValue,
        ownerParticipantId: participantId,
        behavior: 'green-shell',
        modelPath: OBJECT_GREEN_SHELL_MODEL_PATH,
        spawnPosition: [
          pose.x + forwardX * OBJECT_GREEN_SHELL_SPAWN_FORWARD_OFFSET,
          pose.y + OBJECT_GREEN_SHELL_SPAWN_UP_OFFSET,
          pose.z + forwardZ * OBJECT_GREEN_SHELL_SPAWN_FORWARD_OFFSET,
        ],
        launchVelocity: [forwardX * launchSpeed, 0, forwardZ * launchSpeed],
        ttlMs: OBJECT_THROWABLE_LIFETIME_MS,
      };

      publishThrowableObjectSpawn(spawnedObject);
    },
    [
      poseRefsByParticipant,
      publishThrowableObjectSpawn,
      raceConfig.courseId,
      resolveCurrentVehicleSpeed,
      resolveCurrentPoseForwardVector,
    ],
  );

  const resolveRedShellDirection = useCallback(
    (position: [number, number, number], ownerParticipantId: RaceParticipantId) => {
      let nearestTargetDistance = Number.POSITIVE_INFINITY;
      let targetDirection: { x: number; z: number } | null = null;

      for (const participant of raceConfig.participants) {
        if (participant.id === ownerParticipantId) continue;
        const pose = poseRefsByParticipant[participant.id]?.current;
        if (!pose) continue;

        const dx = pose.x - position[0];
        const dz = pose.z - position[2];
        const distance = Math.hypot(dx, dz);
        if (distance <= 0.0001 || distance > OBJECT_RED_SHELL_TARGET_RADIUS) continue;
        if (distance >= nearestTargetDistance) continue;

        nearestTargetDistance = distance;
        targetDirection = {
          x: dx / distance,
          z: dz / distance,
        };
      }

      if (targetDirection) return targetDirection;
      if (circuitWaypoints.length === 0) return null;

      let nearestWaypointIndex = 0;
      let nearestWaypointDistanceSq = Number.POSITIVE_INFINITY;
      for (let index = 0; index < circuitWaypoints.length; index += 1) {
        const waypoint = circuitWaypoints[index];
        if (!waypoint) continue;
        const dx = waypoint.position[0] - position[0];
        const dz = waypoint.position[2] - position[2];
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= nearestWaypointDistanceSq) continue;
        nearestWaypointDistanceSq = distanceSq;
        nearestWaypointIndex = index;
      }

      const nextWaypoint = circuitWaypoints[(nearestWaypointIndex + 1) % circuitWaypoints.length];
      if (!nextWaypoint) return null;

      const toWaypointX = nextWaypoint.position[0] - position[0];
      const toWaypointZ = nextWaypoint.position[2] - position[2];
      const toWaypointLength = Math.hypot(toWaypointX, toWaypointZ);
      if (toWaypointLength <= 0.0001) return null;

      return {
        x: toWaypointX / toWaypointLength,
        z: toWaypointZ / toWaypointLength,
      };
    },
    [circuitWaypoints, poseRefsByParticipant, raceConfig.participants],
  );

  const resolveParticipantPose = useCallback(
    (participantId: RaceParticipantId) => poseRefsByParticipant[participantId]?.current ?? null,
    [poseRefsByParticipant],
  );

  const resolveParticipantsWithinRadius = useCallback(
    (position: Vec3, radius: number) => {
      const radiusSq = radius * radius;
      return raceConfig.participants
        .map((participant) => participant.id)
        .filter((participantId) => {
          const pose = poseRefsByParticipant[participantId]?.current;
          if (!pose) return false;

          const dx = pose.x - position[0];
          const dy = pose.y - position[1];
          const dz = pose.z - position[2];
          return dx * dx + dy * dy + dz * dz <= radiusSq;
        });
    },
    [poseRefsByParticipant, raceConfig.participants],
  );

  const resolveBlueShellTargetParticipantId = useCallback(() => {
    const liveRanking = getLiveScoreboardSnapshot();
    return liveRanking[0]?.participantId ?? null;
  }, [getLiveScoreboardSnapshot]);

  const resolveBlueShellGroundDirection = useCallback(
    (
      position: Vec3,
      ownerParticipantId: RaceParticipantId,
      targetParticipantId: RaceParticipantId | null,
    ) => {
      const fallbackTargetParticipantId = targetParticipantId ?? ownerParticipantId;
      const targetPose = poseRefsByParticipant[fallbackTargetParticipantId]?.current;

      if (circuitWaypoints.length === 0) {
        if (!targetPose) return null;

        const dx = targetPose.x - position[0];
        const dz = targetPose.z - position[2];
        const distance = Math.hypot(dx, dz);
        if (distance <= 0.0001) return null;
        return {
          x: dx / distance,
          z: dz / distance,
        };
      }

      const nearestWaypointArrayIndex = findNearestWaypointArrayIndex(position, circuitWaypoints);
      if (nearestWaypointArrayIndex === null) return null;

      let targetWaypointArrayIndex = (nearestWaypointArrayIndex + 1) % circuitWaypoints.length;
      if (targetPose) {
        const targetPoseWaypointArrayIndex = findNearestWaypointArrayIndex(
          [targetPose.x, targetPose.y, targetPose.z],
          circuitWaypoints,
        );
        if (targetPoseWaypointArrayIndex !== null) {
          const stepsAhead =
            (targetPoseWaypointArrayIndex - nearestWaypointArrayIndex + circuitWaypoints.length) %
            circuitWaypoints.length;
          if (stepsAhead <= 2) {
            targetWaypointArrayIndex = targetPoseWaypointArrayIndex;
          }
        }
      }

      const targetWaypoint = circuitWaypoints[targetWaypointArrayIndex];
      if (!targetWaypoint) return null;

      const dx = targetWaypoint.position[0] - position[0];
      const dz = targetWaypoint.position[2] - position[2];
      const distance = Math.hypot(dx, dz);
      if (distance <= 0.0001) return null;

      return {
        x: dx / distance,
        z: dz / distance,
      };
    },
    [circuitWaypoints, poseRefsByParticipant],
  );

  const spawnRedShellThrowableObject = useCallback(
    (participantId: RaceParticipantId, sourceObjectValue: number) => {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (!pose) return;
      const { forwardX, forwardZ } = resolveCurrentPoseForwardVector(pose);
      const currentSpeed = resolveCurrentVehicleSpeed(pose);
      const launchSpeed = Math.max(
        OBJECT_RED_SHELL_MIN_SPEED,
        currentSpeed * OBJECT_RED_SHELL_SPEED_MULTIPLIER,
      );

      const throwableId = `${raceConfig.courseId}-${participantId}-throwable-${throwableObjectIdCounterRef.current}`;
      throwableObjectIdCounterRef.current += 1;

      const spawnedObject: ThrowableObjectEntry = {
        throwableId,
        sourceObjectValue,
        ownerParticipantId: participantId,
        behavior: 'red-shell',
        modelPath: OBJECT_RED_SHELL_MODEL_PATH,
        spawnPosition: [
          pose.x + forwardX * OBJECT_RED_SHELL_SPAWN_FORWARD_OFFSET,
          pose.y + OBJECT_RED_SHELL_SPAWN_UP_OFFSET,
          pose.z + forwardZ * OBJECT_RED_SHELL_SPAWN_FORWARD_OFFSET,
        ],
        launchVelocity: [forwardX * launchSpeed, 0, forwardZ * launchSpeed],
        ttlMs: OBJECT_THROWABLE_LIFETIME_MS,
      };

      publishThrowableObjectSpawn(spawnedObject);
    },
    [
      poseRefsByParticipant,
      publishThrowableObjectSpawn,
      raceConfig.courseId,
      resolveCurrentVehicleSpeed,
      resolveCurrentPoseForwardVector,
    ],
  );

  const spawnBlueShellThrowableObject = useCallback(
    (participantId: RaceParticipantId, sourceObjectValue: number) => {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (!pose) return;
      const { forwardX, forwardZ } = resolveCurrentPoseForwardVector(pose);
      const currentSpeed = resolveCurrentVehicleSpeed(pose);
      const launchSpeed = Math.max(
        OBJECT_BLUE_SHELL_MIN_SPEED,
        currentSpeed * OBJECT_BLUE_SHELL_SPEED_MULTIPLIER,
      );

      const throwableId = `${raceConfig.courseId}-${participantId}-throwable-${throwableObjectIdCounterRef.current}`;
      throwableObjectIdCounterRef.current += 1;

      const spawnedObject: ThrowableObjectEntry = {
        throwableId,
        sourceObjectValue,
        ownerParticipantId: participantId,
        behavior: 'blue-shell',
        modelPath: OBJECT_BLUE_SHELL_MODEL_PATH,
        spawnPosition: [
          pose.x + forwardX * OBJECT_BLUE_SHELL_SPAWN_FORWARD_OFFSET,
          pose.y + OBJECT_BLUE_SHELL_SPAWN_UP_OFFSET,
          pose.z + forwardZ * OBJECT_BLUE_SHELL_SPAWN_FORWARD_OFFSET,
        ],
        launchVelocity: [forwardX * launchSpeed, 0, forwardZ * launchSpeed],
        ttlMs: OBJECT_THROWABLE_LIFETIME_MS,
      };

      publishThrowableObjectSpawn(spawnedObject);
    },
    [
      poseRefsByParticipant,
      publishThrowableObjectSpawn,
      raceConfig.courseId,
      resolveCurrentVehicleSpeed,
      resolveCurrentPoseForwardVector,
    ],
  );

  const spawnBombThrowableObject = useCallback(
    (participantId: RaceParticipantId, sourceObjectValue: number) => {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (!pose) return;

      const { forwardX, forwardZ } = resolveCurrentPoseForwardVector(pose);
      const currentSpeed = resolveCurrentVehicleSpeed(pose);
      const forwardSpeed = Math.max(
        OBJECT_BOMB_MIN_FORWARD_SPEED,
        currentSpeed * OBJECT_BOMB_SPEED_MULTIPLIER,
      );
      const flightTimeSeconds = OBJECT_BOMB_TARGET_DISTANCE / Math.max(0.001, forwardSpeed);
      const upwardSpeed = 0.5 * OBJECT_BOMB_GRAVITY * flightTimeSeconds;

      const throwableId = `${raceConfig.courseId}-${participantId}-throwable-${throwableObjectIdCounterRef.current}`;
      throwableObjectIdCounterRef.current += 1;

      const spawnedObject: ThrowableObjectEntry = {
        throwableId,
        sourceObjectValue,
        ownerParticipantId: participantId,
        behavior: 'bomb',
        modelPath: OBJECT_BOMB_MODEL_PATH,
        spawnPosition: [
          pose.x + forwardX * OBJECT_BOMB_SPAWN_FORWARD_OFFSET,
          pose.y + OBJECT_BOMB_SPAWN_UP_OFFSET,
          pose.z + forwardZ * OBJECT_BOMB_SPAWN_FORWARD_OFFSET,
        ],
        launchVelocity: [
          forwardX * forwardSpeed,
          upwardSpeed,
          forwardZ * forwardSpeed,
        ],
        ttlMs: OBJECT_THROWABLE_LIFETIME_MS,
      };

      publishThrowableObjectSpawn(spawnedObject);
    },
    [
      poseRefsByParticipant,
      publishThrowableObjectSpawn,
      raceConfig.courseId,
      resolveCurrentVehicleSpeed,
      resolveCurrentPoseForwardVector,
    ],
  );

  const handleParticipantObjectUsed = useCallback(
    (participantId: RaceParticipantId, usedObject: number) => {
      const normalizedObject = Number.isFinite(usedObject) ? Math.floor(usedObject) : 0;
      if (networkRaceState && networkOwnedParticipantIdSet.has(participantId)) {
        onNetworkRaceEvent?.(networkRaceState.raceId, {
          type: 'object-used',
          participantId,
          usedObject: normalizedObject,
        });
      }
      if (OBJECT_THROWABLE_VALUE_SET.has(normalizedObject)) {
        if (
          normalizedObject === OBJECT_BANANA_VALUE ||
          normalizedObject === OBJECT_TRIPLE_BANANA_VALUE
        ) {
          spawnBananaThrowableObject(participantId, normalizedObject);
          return;
        }
        if (
          normalizedObject === OBJECT_GREEN_SHELL_VALUE ||
          normalizedObject === OBJECT_TRIPLE_GREEN_SHELL_VALUE
        ) {
          spawnGreenShellThrowableObject(participantId, normalizedObject);
          return;
        }
        if (
          normalizedObject === OBJECT_RED_SHELL_VALUE ||
          normalizedObject === OBJECT_TRIPLE_RED_SHELL_VALUE
        ) {
          spawnRedShellThrowableObject(participantId, normalizedObject);
          return;
        }

        if (normalizedObject === OBJECT_BLUE_SHELL_VALUE) {
          spawnBlueShellThrowableObject(participantId, normalizedObject);
          return;
        }

        if (normalizedObject === OBJECT_BOMB_VALUE) {
          spawnBombThrowableObject(participantId, normalizedObject);
          return;
        }

        console.log(
          `[object][${participantId}] objet jetable ${normalizedObject} utilise mais comportement non implemente.`,
        );
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
        ownedParticipantDirtyStateRef.current.add(participantId);
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
        ownedParticipantDirtyStateRef.current.add(participantId);
      }
    },
    [
      networkOwnedParticipantIdSet,
      networkRaceState,
      onNetworkRaceEvent,
      spawnBananaThrowableObject,
      spawnBombThrowableObject,
      spawnBlueShellThrowableObject,
      spawnGreenShellThrowableObject,
      spawnRedShellThrowableObject,
    ],
  );

  const handleParticipantObjectConsumed = useCallback(
    (participantId: RaceParticipantId, consumedObject: number, consumedUnits = 1) => {
      const normalizedObject = Number.isFinite(consumedObject) ? Math.floor(consumedObject) : 0;
      const consumeCount = Number.isFinite(consumedUnits) ? Math.max(1, Math.floor(consumedUnits)) : 1;
      if (normalizedObject <= 0) return;
      if (networkRaceState && networkOwnedParticipantIdSet.has(participantId)) {
        onNetworkRaceEvent?.(networkRaceState.raceId, {
          type: 'object-consumed',
          participantId,
          consumedObject: normalizedObject,
          consumedUnits: consumeCount,
        });
      }

      const currentObject = myObjectByParticipantRef.current[participantId] ?? 0;
      if (currentObject !== normalizedObject) return;

      if (
        normalizedObject === OBJECT_MUSHROOM_VALUE ||
        normalizedObject === OBJECT_TRIPLE_BANANA_VALUE ||
        normalizedObject === OBJECT_TRIPLE_GREEN_SHELL_VALUE ||
        normalizedObject === OBJECT_TRIPLE_RED_SHELL_VALUE
      ) {
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
      ownedParticipantDirtyStateRef.current.add(participantId);
    },
    [networkOwnedParticipantIdSet, networkRaceState, onNetworkRaceEvent],
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
      setOverlayStep(isNetworkRace && !hasNextCourse ? 'grand-prix-result' : 'course-ranking');
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
      hasNextCourse,
      isNetworkRace,
    ],
  );

  const validateAllLapsFromWinMode = useCallback(() => {
    if (overlayStep !== 'none') return false;

    const localHumanParticipant =
      raceConfig.participants.find(
        (participant) => participant.kind === 'human' && participant.controlMode === 'human' && participant.humanSlotId === 'p1',
      ) ?? humanParticipants[0];
    if (!localHumanParticipant) return false;

    const participantId = localHumanParticipant.id;
    const currentProgress = lapProgressRef.current[participantId];
    if (!currentProgress) return false;

    const nextProgress = {
      ...lapProgressRef.current,
      [participantId]: {
        ...currentProgress,
        lap: 4,
        checkpoint: false,
        finished: true,
        finishTimestamp: currentProgress.finishTimestamp ?? performance.now(),
      },
    };

    lapProgressRef.current = nextProgress;
    setLapProgressByPlayer(nextProgress);
    ownedParticipantDirtyStateRef.current.add(participantId);

    if (isNetworkRace && networkRaceState && networkOwnedParticipantIdSet.has(participantId)) {
      const pose = poseRefsByParticipant[participantId]?.current;
      if (pose) {
        onNetworkLocalPose?.(networkRaceState.raceId, participantId, pose, {
          lapProgress: nextProgress[participantId],
          itemState: buildParticipantItemStateSnapshot(participantId, {
            objects: myObjectByParticipantRef.current,
            objectCharges: myObjectChargesByParticipantRef.current,
            coins: coinsByParticipantRef.current,
            thunderDebuffUntil: thunderDebuffUntilByParticipantRef.current,
            bulletBillUntil: bulletBillUntilByParticipantRef.current,
            stunUntil: stunUntilByParticipantRef.current,
          }),
        });
      }
      return true;
    }

    const allHumansFinished = raceConfig.participants
      .filter((participant) => participant.kind === 'human')
      .every((participant) => nextProgress[participant.id]?.finished);
    if (allHumansFinished) {
      finalizeCourse(nextProgress);
    }
    return true;
  }, [
    finalizeCourse,
    humanParticipants,
    isNetworkRace,
    networkOwnedParticipantIdSet,
    networkRaceState,
    onNetworkLocalPose,
    overlayStep,
    poseRefsByParticipant,
    raceConfig.participants,
  ]);

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

      if (networkRaceState && networkOwnedParticipantIdSet.has(participantId)) {
        onNetworkRaceEvent?.(networkRaceState.raceId, {
          type: 'lap-trigger',
          participantId,
          triggerType,
        });
      }

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
        ownedParticipantDirtyStateRef.current.add(participantId);
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
      ownedParticipantDirtyStateRef.current.add(participantId);

      if (hasFinished && !isNetworkRace) {
        const allHumansFinished = raceConfig.participants
          .filter((participant) => participant.kind === 'human')
          .every((participant) => nextProgress[participant.id]?.finished);
        if (allHumansFinished) {
          finalizeCourse(nextProgress);
        }
      }
    },
    [
      controlsLocked,
      finalizeCourse,
      networkOwnedParticipantIdSet,
      networkRaceState,
      onNetworkRaceEvent,
      overlayStep,
      raceConfig.participants,
      isNetworkRace,
    ],
  );

  const handleAdvanceAfterCourse = useCallback(async () => {
    if (overlayStep !== 'course-ranking') return;
    if (!hasNextCourse) {
      setOverlayStep('grand-prix-result');
      return;
    }

    if (isNetworkRace && networkRaceState) {
      if (!onNetworkCourseResultValidated || menuBusy) return;
      setMenuBusy(true);
      onNetworkCourseResultValidated(networkRaceState.raceId);
      return;
    }

    setMenuBusy(true);
    try {
      await onNextCourse();
    } finally {
      setMenuBusy(false);
    }
  }, [
    hasNextCourse,
    isNetworkRace,
    menuBusy,
    networkRaceState,
    onNetworkCourseResultValidated,
    onNextCourse,
    overlayStep,
  ]);

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
  const livePositionByParticipant = useMemo(() => {
    const positions = new Map<RaceParticipantId, number>();
    for (const entry of liveScoreboard) {
      positions.set(entry.participantId, entry.position);
    }
    return positions;
  }, [liveScoreboard]);
  const botDrivingTacticalStateByParticipant = useMemo<Record<RaceParticipantId, BotDrivingTacticalState>>(() => {
    const tacticalStateByParticipant = {} as Record<RaceParticipantId, BotDrivingTacticalState>;
    const waypointOrderByParticipant = new Map<RaceParticipantId, number | null>();

    for (const participant of raceConfig.participants) {
      const participantId = participant.id;
      const pose = poseRefsByParticipant[participantId]?.current ?? null;
      const currentWaypointIndex = findNearestWaypointIndex(pose, circuitWaypoints);
      waypointOrderByParticipant.set(
        participantId,
        currentWaypointIndex === null ? null : (waypointOrderByIndex.get(currentWaypointIndex) ?? null),
      );
    }

    for (const participant of raceConfig.participants) {
      const participantId = participant.id;
      const pose = poseRefsByParticipant[participantId]?.current ?? null;
      const currentPosition = livePositionByParticipant.get(participantId) ?? null;
      const currentWaypointOrder = waypointOrderByParticipant.get(participantId) ?? null;
      const trackDirection = getWaypointDirectionXZ(
        circuitWaypoints,
        currentWaypointOrder,
        BOT_OVERTAKE_DIRECTION_LOOKAHEAD,
      );

      if (!pose || currentPosition === null || !trackDirection) {
        tacticalStateByParticipant[participantId] = {
          overtakeTargetDistance: null,
          desiredLaneOffset: null,
        };
        continue;
      }

      const rightX = trackDirection.z;
      const rightZ = -trackDirection.x;
      let bestCandidate:
        | {
            distance: number;
            lateralOffset: number;
          }
        | null = null;

      for (const otherParticipant of raceConfig.participants) {
        if (otherParticipant.id === participantId) continue;

        const otherPosition = livePositionByParticipant.get(otherParticipant.id) ?? null;
        if (otherPosition === null || otherPosition >= currentPosition) continue;

        const otherPose = poseRefsByParticipant[otherParticipant.id]?.current ?? null;
        if (!otherPose) continue;

        const dx = otherPose.x - pose.x;
        const dy = otherPose.y - pose.y;
        const dz = otherPose.z - pose.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > BOT_OVERTAKE_MAX_DISTANCE) continue;

        const forwardProgress = dx * trackDirection.x + dz * trackDirection.z;
        if (forwardProgress <= 0.5) continue;

        const otherWaypointOrder = waypointOrderByParticipant.get(otherParticipant.id) ?? null;
        if (currentWaypointOrder !== null && otherWaypointOrder !== null && circuitWaypoints.length > 0) {
          const waypointSteps =
            (otherWaypointOrder - currentWaypointOrder + circuitWaypoints.length) % circuitWaypoints.length;
          if (waypointSteps > BOT_OVERTAKE_MAX_WAYPOINT_STEPS && distance > BOT_OVERTAKE_MAX_DISTANCE * 0.45) {
            continue;
          }
        }

        const lateralOffset = dx * rightX + dz * rightZ;
        const score = distance + Math.abs(lateralOffset) * 0.25;
        if (bestCandidate && score >= bestCandidate.distance + Math.abs(bestCandidate.lateralOffset) * 0.25) {
          continue;
        }

        bestCandidate = {
          distance,
          lateralOffset,
        };
      }

      if (!bestCandidate) {
        tacticalStateByParticipant[participantId] = {
          overtakeTargetDistance: null,
          desiredLaneOffset: null,
        };
        continue;
      }

      const turnBias = getUpcomingTurnBias(circuitWaypoints, currentWaypointOrder);
      let laneSign = 0;
      if (Math.abs(bestCandidate.lateralOffset) > BOT_OVERTAKE_LATERAL_DEADZONE) {
        laneSign = bestCandidate.lateralOffset > 0 ? -1 : 1;
      } else if (turnBias > BOT_OVERTAKE_TURN_BIAS_THRESHOLD) {
        laneSign = 1;
      } else if (turnBias < -BOT_OVERTAKE_TURN_BIAS_THRESHOLD) {
        laneSign = -1;
      } else {
        laneSign = currentPosition % 2 === 0 ? 1 : -1;
      }

      const distanceT = 1 - Math.min(1, bestCandidate.distance / BOT_OVERTAKE_MAX_DISTANCE);
      const laneOffsetMagnitude =
        BOT_OVERTAKE_LANE_OFFSET_MIN +
        (BOT_OVERTAKE_LANE_OFFSET_MAX - BOT_OVERTAKE_LANE_OFFSET_MIN) * distanceT;

      tacticalStateByParticipant[participantId] = {
        overtakeTargetDistance: bestCandidate.distance,
        desiredLaneOffset: laneSign * laneOffsetMagnitude,
      };
    }

    return tacticalStateByParticipant;
  }, [
    circuitWaypoints,
    livePositionByParticipant,
    poseRefsByParticipant,
    raceConfig.participants,
    waypointOrderByIndex,
  ]);
  const botItemTacticalStateByParticipant = useMemo<Record<RaceParticipantId, BotItemTacticalState>>(() => {
    const tacticalStateByParticipant = {} as Record<RaceParticipantId, BotItemTacticalState>;
    const leaderParticipantId = liveScoreboard[0]?.participantId ?? null;
    const leaderPose = leaderParticipantId ? (poseRefsByParticipant[leaderParticipantId]?.current ?? null) : null;

    for (const participant of raceConfig.participants) {
      const participantId = participant.id;
      const pose = poseRefsByParticipant[participantId]?.current;
      const currentPosition = livePositionByParticipant.get(participantId) ?? null;

      if (!pose) {
        tacticalStateByParticipant[participantId] = {
          currentPosition,
          leaderDistance: null,
          nearestOpponentAheadDistance: null,
          nearestOpponentBehindDistance: null,
          straightAheadTargetDistance: null,
          straightBehindTargetDistance: null,
        };
        continue;
      }

      const { forwardX, forwardZ } = resolvePoseForwardVector(pose);
      const rightX = forwardZ;
      const rightZ = -forwardX;
      let leaderDistance: number | null = null;
      if (leaderPose && leaderParticipantId && leaderParticipantId !== participantId) {
        leaderDistance = Math.hypot(
          leaderPose.x - pose.x,
          leaderPose.y - pose.y,
          leaderPose.z - pose.z,
        );
      }

      let nearestOpponentAheadDistance: number | null = null;
      let nearestOpponentBehindDistance: number | null = null;
      let straightAheadTargetDistance: number | null = null;
      let straightBehindTargetDistance: number | null = null;

      for (const otherParticipant of raceConfig.participants) {
        if (otherParticipant.id === participantId) continue;
        const otherPose = poseRefsByParticipant[otherParticipant.id]?.current;
        if (!otherPose) continue;

        const dx = otherPose.x - pose.x;
        const dy = otherPose.y - pose.y;
        const dz = otherPose.z - pose.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance <= 0.0001) continue;

        const otherPosition = livePositionByParticipant.get(otherParticipant.id) ?? null;
        if (currentPosition !== null && otherPosition !== null) {
          if (otherPosition < currentPosition) {
            nearestOpponentAheadDistance =
              nearestOpponentAheadDistance === null ? distance : Math.min(nearestOpponentAheadDistance, distance);
          } else if (otherPosition > currentPosition) {
            nearestOpponentBehindDistance =
              nearestOpponentBehindDistance === null ? distance : Math.min(nearestOpponentBehindDistance, distance);
          }
        }

        const forwardDot = dx * forwardX + dz * forwardZ;
        const lateralDistance = Math.abs(dx * rightX + dz * rightZ);
        const laneTolerance = Math.max(4, distance * 0.18);

        if (
          currentPosition !== null &&
          otherPosition !== null &&
          otherPosition < currentPosition &&
          forwardDot > 0 &&
          lateralDistance <= laneTolerance
        ) {
          straightAheadTargetDistance =
            straightAheadTargetDistance === null ? distance : Math.min(straightAheadTargetDistance, distance);
        }

        if (
          currentPosition !== null &&
          otherPosition !== null &&
          otherPosition > currentPosition &&
          forwardDot < 0 &&
          lateralDistance <= laneTolerance
        ) {
          straightBehindTargetDistance =
            straightBehindTargetDistance === null ? distance : Math.min(straightBehindTargetDistance, distance);
        }
      }

      tacticalStateByParticipant[participantId] = {
        currentPosition,
        leaderDistance,
        nearestOpponentAheadDistance,
        nearestOpponentBehindDistance,
        straightAheadTargetDistance,
        straightBehindTargetDistance,
      };
    }

    return tacticalStateByParticipant;
  }, [livePositionByParticipant, liveScoreboard, poseRefsByParticipant, raceConfig.participants]);
  const isCourseRankingVisible = overlayStep === 'course-ranking';
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
  const courseResultDescription =
    isNetworkRace && hasNextCourse ?
      menuBusy ?
        'Resultats valides. En attente de la validation des autres joueurs.'
      : 'Attends que tous les joueurs aient termine, puis valide pour lancer la course suivante.'
    : hasNextCourse ?
      'Passage automatique a la course suivante dans 10 secondes.'
    : 'Affichage du resultat final du Grand Prix dans 10 secondes.';
  const courseResultActionLabel =
    hasNextCourse ?
      isNetworkRace ?
        menuBusy ?
          'En attente des joueurs...'
        : 'Course suivante'
      : menuBusy || isAdvancingCourse ?
        'Chargement...'
      : 'Course suivante'
    : 'Resultat final';

  useEffect(() => {
    if (isNetworkRace) return;
    if (!sceneReady || isLoadingOverlayActive || overlayStep !== 'none') return;
    if (startCountdownStartedRef.current) return;

    const delayTimer = window.setTimeout(() => {
      if (startCountdownStartedRef.current) return;
      startCountdownStartedRef.current = true;
      setStartCountdownValue(START_COUNTDOWN_INITIAL);
    }, START_COUNTDOWN_DELAY_AFTER_LOADING_MS);

    return () => window.clearTimeout(delayTimer);
  }, [isLoadingOverlayActive, isNetworkRace, overlayStep, sceneReady]);

  useEffect(() => {
    if (!sceneReady || isLoadingOverlayActive || overlayStep !== 'none') return;

    const timerId = window.setInterval(() => {
      setLiveScoreboardTick((prev) => (prev + 1) % 1_000_000);
    }, LIVE_SCOREBOARD_REFRESH_MS);
    return () => window.clearInterval(timerId);
  }, [isLoadingOverlayActive, overlayStep, sceneReady]);

  useEffect(() => {
    if (!isNetworkRace || !networkRaceState || !sceneReady || isLoadingOverlayActive) return;

    if (networkRaceState.status === 'loading') {
      setControlsLocked(true);
      setStartCountdownValue(null);
      return;
    }

    if (networkRaceState.status === 'countdown') {
      const syncCountdown = () => {
        const countdownStartAt = networkRaceState.countdownStartAt ?? Date.now();
        const countdownEndAt = countdownStartAt + MULTIPLAYER_START_COUNTDOWN_MS;
        const now = Date.now();
        if (now < countdownStartAt) {
          setStartCountdownValue(null);
          return;
        }
        const remainingMs = Math.max(0, countdownEndAt - now);
        const nextValue = Math.min(START_COUNTDOWN_INITIAL, Math.max(1, Math.ceil(remainingMs / 1000)));
        setStartCountdownValue(nextValue);
      };
      syncCountdown();
      const countdownSyncTimer = window.setInterval(syncCountdown, 80);
      return () => window.clearInterval(countdownSyncTimer);
    }

    if (networkRaceState.status === 'running') {
      setControlsLocked(false);
      const elapsedSinceRaceStartMs =
        networkRaceState.startedAt ? Math.max(0, Date.now() - networkRaceState.startedAt) : Number.POSITIVE_INFINITY;
      if (elapsedSinceRaceStartMs <= NETWORK_START_GO_HOLD_MS) {
        setStartCountdownValue(0);
      } else {
        setStartCountdownValue(null);
      }
      return;
    }

    if (networkRaceState.status === 'finished') {
      setControlsLocked(true);
      setStartCountdownValue(null);
    }
  }, [isLoadingOverlayActive, isNetworkRace, networkRaceState, sceneReady]);

  useEffect(() => {
    if (!isNetworkRace || !networkRaceState) return;
    if (networkRaceState.status !== 'finished') return;
    finalizeCourse(lapProgressRef.current);
  }, [finalizeCourse, isNetworkRace, networkRaceState]);

  useEffect(() => {
    if (isNetworkRace) return;
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
  }, [isNetworkRace, startCountdownValue]);

  useEffect(() => {
    if (overlayStep !== 'course-ranking' || isNetworkRace) return;
    const autoAdvanceTimer = window.setTimeout(() => {
      void handleAdvanceAfterCourse();
    }, COURSE_RESULT_OVERLAY_MS);
    return () => window.clearTimeout(autoAdvanceTimer);
  }, [handleAdvanceAfterCourse, isNetworkRace, overlayStep]);

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
            <p className="mt-4 text-sm font-semibold text-white/80">
              {courseResultDescription}
            </p>
            <button
              type="button"
              className="mt-5 w-full rounded-lg border border-white/35 bg-white/15 px-4 py-2 text-sm font-black uppercase tracking-widest transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleAdvanceAfterCourse}
              disabled={menuBusy || isAdvancingCourse}
            >
              {courseResultActionLabel}
            </button>
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
              {isNetworkRace ? 'Quitter le lobby' : 'Retour au Menu'}
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

            {trackCoinSpawnEntries.map((spawn) =>
              activeTrackCoins[spawn.coinId] ? (
                <ObjectCrate
                  key={spawn.coinId}
                  crateId={spawn.coinId}
                  position={spawn.position}
                  rotation={spawn.rotation}
                  modelPath={TRACK_COIN_MODEL_PATH}
                  colliderHalfExtents={TRACK_COIN_COLLIDER_HALF_EXTENTS}
                  onCollected={handleTrackCoinCollected}
                />
              ) : null,
            )}

            {activeThrowableObjects.map((throwableObject) => (
              <ThrowableObject
                key={throwableObject.throwableId}
                throwableId={throwableObject.throwableId}
                sourceObjectValue={throwableObject.sourceObjectValue}
                ownerParticipantId={throwableObject.ownerParticipantId}
                behavior={throwableObject.behavior}
                modelPath={throwableObject.modelPath}
                spawnPosition={throwableObject.spawnPosition}
                launchVelocity={throwableObject.launchVelocity}
                ttlMs={throwableObject.ttlMs}
                resolveRedShellDirection={resolveRedShellDirection}
                resolveBlueShellTargetParticipantId={resolveBlueShellTargetParticipantId}
                resolveBlueShellGroundDirection={resolveBlueShellGroundDirection}
                resolveParticipantPose={resolveParticipantPose}
                resolveParticipantsWithinRadius={resolveParticipantsWithinRadius}
                onExpired={handleThrowableObjectExpired}
                onGroundedParticipantHit={handleThrowableObjectGroundedParticipantHit}
              />
            ))}

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
                remotePose={remotePoseByParticipantId.get(participant.id) ?? null}
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
                stunUntilTimestampMs={stunUntilByParticipant[participant.id] ?? 0}
                botItemTacticalState={botItemTacticalStateByParticipant[participant.id] ?? null}
                botDrivingTacticalState={botDrivingTacticalStateByParticipant[participant.id] ?? null}
                objectItemMaxValue={OBJECT_ITEM_MAX_VALUE}
                miniObjectModelPaths={RACE_ATTACHABLE_MODEL_URLS}
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
