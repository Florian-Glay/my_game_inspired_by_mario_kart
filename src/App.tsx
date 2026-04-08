import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  BOT_NETWORK_POSE_PUBLISH_INTERVAL_MS,
  HUMAN_NETWORK_POSE_PUBLISH_INTERVAL_MS,
  ONLINE_PLAYER_NAME_STORAGE_KEY,
} from './app/appConstants';
import {
  createRandomLoadoutSelection,
  createResolvedParticipantConfig,
  getHumanDisplayName,
  getHumanSlots,
  getMissingAssetUrls,
  getStoredOnlinePlayerName,
  shuffleParticipants,
} from './app/appHelpers';
import { computeGrandPrixStandings } from './app/grandPrixStandings';
import type { GrandPrixProgressState } from './app/appTypes';
import CommandBubble from './components/CommandBubble';
import { GameMenu } from './components/GameMenu';
import { Scene } from './components/Scene';
import {
  CHARACTERS,
  VEHICLES,
  WHEELS,
  cycleIndex,
  getDefaultLoadoutSelection,
} from './config/garageCatalog';
import {
  CIRCUITS,
  GRAND_PRIX_ORDER,
  GRAND_PRIXS,
  MAX_LOCAL_HUMANS,
  PLAYER_KEY_BINDINGS,
  TOTAL_RACE_PARTICIPANTS,
} from './config/raceCatalog';
import { PERF_PROFILE } from './config/performanceProfile';
import { clearDragRegistry } from './state/dragRegistry';
import { gameMode } from './state/gamemode';
import {
  acknowledgeServerRaceResult,
  connectMultiplayerClient,
  createServerLobby,
  getMultiplayerStateSnapshot,
  joinServerLobby,
  joinServerLobbyByCode,
  leaveServerLobby,
  markServerRaceLoaded,
  publishServerRacePose,
  sendServerRaceEvent,
  startServerRace,
  subscribeToMultiplayerState,
  updateServerLobbyProfile,
} from './state/multiplayerClient';
import { clearSurfaceTriggerRegistry } from './state/surfaceTriggerRegistry';
import type {
  CcLevel,
  CourseRaceResult,
  GameScreen,
  GrandPrixId,
  GrandPrixStanding,
  HumanPlayerSlotId,
  PlayerLoadoutSelection,
  RaceConfig,
  RaceMode,
  RaceParticipantConfig,
} from './types/game';
import {
  clearGLTFAssetCacheEntries,
  getRaceAssetUrls,
  preloadGLTFAssetCacheEntries,
  scheduleAllKnownModelCacheClear,
  scheduleGLTFAssetCacheClear,
} from './utils/raceAssetMemory';

type RendererPerformanceSample = {
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
  lines: number;
  points: number;
};

type PerformanceOverlayStats = {
  fps: number | null;
  jsHeapUsedMb: number | null;
  jsHeapTotalMb: number | null;
  jsHeapLimitMb: number | null;
  jsHeapUsagePercent: number | null;
  deviceRamGb: number | null;
  gpuGeometries: number | null;
  gpuTextures: number | null;
  gpuPrograms: number | null;
  gpuDrawCalls: number | null;
  gpuTriangles: number | null;
  gpuLines: number | null;
  gpuPoints: number | null;
};

type BrowserPerformanceMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

const MB_IN_BYTES = 1024 * 1024;
const PERFORMANCE_OVERLAY_SAMPLE_INTERVAL_MS = 500;

function readDeviceRamGb(): number | null {
  if (typeof navigator === 'undefined') return null;
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatStatNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return value.toFixed(digits);
}

function formatStatInteger(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${Math.round(value)}`;
}

export function App() {
  const multiplayerSnapshot = useSyncExternalStore(
    subscribeToMultiplayerState,
    getMultiplayerStateSnapshot,
    getMultiplayerStateSnapshot,
  );
  const [screen, setScreen] = useState<GameScreen>('home');
  const [mode, setMode] = useState<RaceMode | null>(null);
  const [cc, setCc] = useState<CcLevel | null>(null);
  const [humanCount, setHumanCount] = useState<number | null>(null);
  const [humanLoadoutsBySlot, setHumanLoadoutsBySlot] = useState<
    Partial<Record<HumanPlayerSlotId, PlayerLoadoutSelection>>
  >({});
  const [activeHumanSlot, setActiveHumanSlot] = useState<HumanPlayerSlotId>('p1');
  const [selectedGrandPrixId, setSelectedGrandPrixId] = useState<GrandPrixId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCheckingAssets, setIsCheckingAssets] = useState(false);
  const [raceConfig, setRaceConfig] = useState<RaceConfig | null>(null);
  const [grandPrixProgress, setGrandPrixProgress] = useState<GrandPrixProgressState | null>(null);
  const [onlinePlayerNameInput, setOnlinePlayerNameInput] = useState(() => getStoredOnlinePlayerName());
  const [onlinePlayerName, setOnlinePlayerName] = useState<string | null>(() => {
    const storedName = getStoredOnlinePlayerName().trim();
    return storedName.length > 0 ? storedName : null;
  });
  const [selectedOnlineLobbyId, setSelectedOnlineLobbyId] = useState<string | null>(null);
  const [onlineLobbyCodeInput, setOnlineLobbyCodeInput] = useState('');
  const [isPerformanceOverlayEnabled, setIsPerformanceOverlayEnabled] = useState(false);
  const [performanceOverlayStats, setPerformanceOverlayStats] = useState<PerformanceOverlayStats>({
    fps: null,
    jsHeapUsedMb: null,
    jsHeapTotalMb: null,
    jsHeapLimitMb: null,
    jsHeapUsagePercent: null,
    deviceRamGb: readDeviceRamGb(),
    gpuGeometries: null,
    gpuTextures: null,
    gpuPrograms: null,
    gpuDrawCalls: null,
    gpuTriangles: null,
    gpuLines: null,
    gpuPoints: null,
  });
  const loadedRaceAssetUrlsRef = useRef<Set<string>>(new Set());
  const pendingCacheClearCancelRef = useRef<(() => void) | null>(null);
  const handledOnlineRaceTokenRef = useRef<string | null>(null);
  const reportedOnlineRaceLoadedIdRef = useRef<string | null>(null);
  const pendingOnlineLobbyEntryRef = useRef(false);
  const lastPublishedNetworkPoseAtRef = useRef<Map<string, number>>(new Map());

  useEffect(
    () => () => {
      pendingCacheClearCancelRef.current?.();
      pendingCacheClearCancelRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trimmedName = onlinePlayerNameInput.trim();
    if (trimmedName.length > 0) {
      window.localStorage.setItem(ONLINE_PLAYER_NAME_STORAGE_KEY, trimmedName);
      return;
    }
    window.localStorage.removeItem(ONLINE_PLAYER_NAME_STORAGE_KEY);
  }, [onlinePlayerNameInput]);

  useEffect(() => {
    connectMultiplayerClient();
  }, []);

  useEffect(() => {
    if (screen !== 'race' || !isPerformanceOverlayEnabled) return;

    let animationFrameId = 0;
    let frameCount = 0;
    let lastSampleAt = performance.now();

    const tick = () => {
      frameCount += 1;
      const now = performance.now();
      const elapsedMs = now - lastSampleAt;

      if (elapsedMs >= PERFORMANCE_OVERLAY_SAMPLE_INTERVAL_MS) {
        const nextFps = (frameCount * 1000) / elapsedMs;
        frameCount = 0;
        lastSampleAt = now;

        const memory = (performance as Performance & { memory?: BrowserPerformanceMemory }).memory;
        const usedJsHeapMb =
          memory && Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize / MB_IN_BYTES : null;
        const totalJsHeapMb =
          memory && Number.isFinite(memory.totalJSHeapSize) ? memory.totalJSHeapSize / MB_IN_BYTES : null;
        const jsHeapLimitMb =
          memory && Number.isFinite(memory.jsHeapSizeLimit) ? memory.jsHeapSizeLimit / MB_IN_BYTES : null;
        const jsHeapUsagePercent =
          usedJsHeapMb !== null && jsHeapLimitMb && jsHeapLimitMb > 0 ?
            (usedJsHeapMb / jsHeapLimitMb) * 100
          : null;

        setPerformanceOverlayStats((current) => ({
          ...current,
          fps: nextFps,
          jsHeapUsedMb: usedJsHeapMb,
          jsHeapTotalMb: totalJsHeapMb,
          jsHeapLimitMb,
          jsHeapUsagePercent,
        }));
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isPerformanceOverlayEnabled, screen]);

  const handleRendererPerformanceSample = useCallback((sample: RendererPerformanceSample) => {
    setPerformanceOverlayStats((current) => ({
      ...current,
      gpuGeometries: sample.geometries,
      gpuTextures: sample.textures,
      gpuPrograms: sample.programs,
      gpuDrawCalls: sample.calls,
      gpuTriangles: sample.triangles,
      gpuLines: sample.lines,
      gpuPoints: sample.points,
    }));
  }, []);

  const activeLoadout = humanLoadoutsBySlot[activeHumanSlot] ?? null;
  const onlineCurrentPlayerLoadout = humanLoadoutsBySlot.p1 ?? getDefaultLoadoutSelection();
  const onlineSessionId = multiplayerSnapshot.sessionId;
  const currentOnlineLobby = multiplayerSnapshot.currentLobby;
  const currentOnlineRace = multiplayerSnapshot.currentRace;
  const selectedOnlineLobby =
    selectedOnlineLobbyId ?
      multiplayerSnapshot.lobbies.find((lobby) => lobby.id === selectedOnlineLobbyId) ?? null
    : null;
  const waitingOnlineLobbies = useMemo(
    () =>
      multiplayerSnapshot.lobbies.filter(
        (lobby) => lobby.status === 'waiting' || lobby.status === 'countdown',
      ),
    [multiplayerSnapshot.lobbies],
  );
  const onlinePlayerPresence = useMemo(
    () =>
      onlinePlayerName ?
        {
          name: onlinePlayerName,
          loadout: onlineCurrentPlayerLoadout,
        }
      : null,
    [onlineCurrentPlayerLoadout, onlinePlayerName],
  );

  const isMultiplayerRace = useMemo(
    () => screen === 'race' && (mode === 'online' || (raceConfig?.humanCount ?? 1) > 1),
    [mode, raceConfig?.humanCount, screen],
  );
  const isOnlineRace = useMemo(
    () => screen === 'race' && mode === 'online',
    [mode, screen],
  );

  const selectedGrandPrix =
    selectedGrandPrixId ? GRAND_PRIXS[selectedGrandPrixId] : null;
  const isCurrentOnlineLobbyHost =
    currentOnlineLobby?.hostSessionId === onlineSessionId;
  const currentOnlineOwnedParticipantIds = useMemo(
    () =>
      currentOnlineRace?.participants
        .filter((participant) => {
          if (participant.sessionId === onlineSessionId) return true;
          return isCurrentOnlineLobbyHost && participant.sessionId.startsWith('bot-');
        })
        .map((participant) => participant.participantId) ?? [],
    [currentOnlineRace?.participants, isCurrentOnlineLobbyHost, onlineSessionId],
  );

  const grandPrixStandings = useMemo<GrandPrixStanding[]>(() => {
    return computeGrandPrixStandings({ grandPrixProgress, raceConfig });
  }, [grandPrixProgress, raceConfig]);

  const clearOnlineLobbyMembership = useCallback(() => {
    if (!currentOnlineLobby) return;
    leaveServerLobby();
  }, [currentOnlineLobby]);

  const resetOnlineFlowState = useCallback(() => {
    setSelectedOnlineLobbyId(null);
    setOnlineLobbyCodeInput('');
    handledOnlineRaceTokenRef.current = null;
    reportedOnlineRaceLoadedIdRef.current = null;
    pendingOnlineLobbyEntryRef.current = false;
    lastPublishedNetworkPoseAtRef.current.clear();
  }, []);

  const resetToHome = () => {
    const completedGrandPrix =
      raceConfig &&
      raceConfig.courseIndex + 1 >= raceConfig.totalCourses &&
      grandPrixProgress?.grandPrixId === raceConfig.grandPrixId &&
      grandPrixProgress.courseResults.length >= raceConfig.totalCourses;

    pendingCacheClearCancelRef.current?.();
    pendingCacheClearCancelRef.current = scheduleAllKnownModelCacheClear({
      chunkSize: 6,
      intervalMs: 8,
    });
    loadedRaceAssetUrlsRef.current.clear();
    clearDragRegistry();
    clearSurfaceTriggerRegistry();
    clearOnlineLobbyMembership();

    if (completedGrandPrix && mode !== 'online') {
      window.setTimeout(() => {
        window.location.reload();
      }, 40);
      return;
    }

    setScreen('home');
    setMode(null);
    setCc(null);
    setHumanCount(null);
    setHumanLoadoutsBySlot({});
    setActiveHumanSlot('p1');
    setErrorMessage(null);
    setIsCheckingAssets(false);
    setRaceConfig(null);
    setGrandPrixProgress(null);
    resetOnlineFlowState();
    gameMode.current = 'run';
  };

  const handleBack = () => {
    setErrorMessage(null);

    if (screen === 'config') {
      setScreen('home');
      return;
    }

    if (screen === 'cc') {
      setMode(null);
      setHumanCount(null);
      setHumanLoadoutsBySlot({});
      setGrandPrixProgress(null);
      setScreen('home');
      return;
    }

    if (screen === 'online-name') {
      setScreen('characters');
      return;
    }

    if (screen === 'online-lobby-menu') {
      setScreen('online-name');
      return;
    }

    if (screen === 'online-lobby-browser') {
      setSelectedOnlineLobbyId(null);
      setScreen('online-lobby-menu');
      return;
    }

    if (screen === 'online-lobby') {
      clearOnlineLobbyMembership();
      resetOnlineFlowState();
      setScreen('online-lobby-menu');
      return;
    }

    if (screen === 'playercount') {
      setHumanCount(null);
      setHumanLoadoutsBySlot({});
      setScreen('cc');
      return;
    }

    if (screen === 'characters') {
      const slots = humanCount ? getHumanSlots(humanCount) : [];
      const activeIndex = slots.indexOf(activeHumanSlot);
      if (activeIndex > 0) {
        const previousSlot = slots[activeIndex - 1];
        if (previousSlot) {
          setActiveHumanSlot(previousSlot);
          return;
        }
      }

      if (mode === 'online') {
        setScreen('home');
        return;
      }

      if (mode === 'multi') {
        setScreen('playercount');
        return;
      }

      setScreen('cc');
      return;
    }

    if (screen === 'circuit') {
      setGrandPrixProgress(null);
      if (mode === 'online') {
        setScreen('online-lobby');
        return;
      }
      setScreen('characters');
      if (humanCount) {
        const slots = getHumanSlots(humanCount);
        const lastSlot = slots[slots.length - 1];
        if (lastSlot) setActiveHumanSlot(lastSlot);
      }
    }
  };

  const handleSelectMode = (nextMode: RaceMode) => {
    setMode(nextMode);
    setCc(nextMode === 'online' ? '150cc' : null);
    setHumanCount(nextMode === 'solo' || nextMode === 'online' ? 1 : null);
    setHumanLoadoutsBySlot(
      nextMode === 'online' ?
        {
          p1: humanLoadoutsBySlot.p1 ?? getDefaultLoadoutSelection(),
        }
      : {},
    );
    setSelectedGrandPrixId(null);
    setErrorMessage(null);
    setActiveHumanSlot('p1');
    setRaceConfig(null);
    setGrandPrixProgress(null);
    resetOnlineFlowState();
    setSelectedGrandPrixId(nextMode === 'online' ? GRAND_PRIX_ORDER[0] ?? null : null);
    setScreen(nextMode === 'online' ? 'characters' : 'cc');
    gameMode.current = 'run';
  };

  const handleOpenConfig = () => {
    setErrorMessage(null);
    setScreen('config');
  };

  const handleSelectCc = (nextCc: CcLevel) => {
    setCc(nextCc);
    setSelectedGrandPrixId(GRAND_PRIX_ORDER[0] ?? null);
    setGrandPrixProgress(null);
    setErrorMessage(null);
    setActiveHumanSlot('p1');

    if (mode === 'solo') {
      setHumanCount(1);
      setHumanLoadoutsBySlot({
        p1: humanLoadoutsBySlot.p1 ?? getDefaultLoadoutSelection(),
      });
      setScreen('characters');
      return;
    }

    setHumanCount(null);
    setHumanLoadoutsBySlot({});
    setScreen('playercount');
  };

  const handleSelectHumanCount = (nextCount: number) => {
    const clampedCount = Math.min(Math.max(nextCount, 2), MAX_LOCAL_HUMANS);
    const slots = getHumanSlots(clampedCount);
    const nextLoadouts: Partial<Record<HumanPlayerSlotId, PlayerLoadoutSelection>> = {};
    for (const slot of slots) {
      nextLoadouts[slot] = humanLoadoutsBySlot[slot] ?? getDefaultLoadoutSelection();
    }

    setHumanCount(clampedCount);
    setHumanLoadoutsBySlot(nextLoadouts);
    setGrandPrixProgress(null);
    setErrorMessage(null);
    setActiveHumanSlot('p1');
    setScreen('characters');
  };

  const updateActiveLoadout = (
    updater: (current: PlayerLoadoutSelection) => PlayerLoadoutSelection,
  ) => {
    setErrorMessage(null);
    setSelectedGrandPrixId(GRAND_PRIX_ORDER[0] ?? null);
    setGrandPrixProgress(null);

    setHumanLoadoutsBySlot((current) => ({
      ...current,
      [activeHumanSlot]: updater(current[activeHumanSlot] ?? getDefaultLoadoutSelection()),
    }));
  };

  const handleCycleCharacter = (direction: -1 | 1) => {
    updateActiveLoadout((current) => {
      const nextCharacter = CHARACTERS[cycleIndex(current.characterId, direction, CHARACTERS)];
      if (!nextCharacter) return current;
      return { ...current, characterId: nextCharacter.id };
    });
  };

  const handleCycleVehicle = (direction: -1 | 1) => {
    updateActiveLoadout((current) => {
      const nextVehicle = VEHICLES[cycleIndex(current.vehicleId, direction, VEHICLES)];
      if (!nextVehicle) return current;
      return { ...current, vehicleId: nextVehicle.id };
    });
  };

  const handleCycleWheel = (direction: -1 | 1) => {
    updateActiveLoadout((current) => {
      const nextWheel = WHEELS[cycleIndex(current.wheelId, direction, WHEELS)];
      if (!nextWheel) return current;
      return { ...current, wheelId: nextWheel.id };
    });
  };

  const handleConfirmLoadout = () => {
    if (!mode || !humanCount) return;

    setErrorMessage(null);
    setSelectedGrandPrixId((current) => current ?? GRAND_PRIX_ORDER[0] ?? null);

    const slots = getHumanSlots(humanCount);
    const currentSlotLoadout = humanLoadoutsBySlot[activeHumanSlot];
    if (!currentSlotLoadout) {
      setErrorMessage(`${getHumanDisplayName(activeHumanSlot)}: selection incomplete.`);
      return;
    }

    const activeIndex = slots.indexOf(activeHumanSlot);
    if (activeIndex < 0) return;

    const nextSlot = slots[activeIndex + 1];
    if (nextSlot) {
      setActiveHumanSlot(nextSlot);
      return;
    }

    if (mode === 'online') {
      setScreen('online-name');
      return;
    }

    setScreen('circuit');
  };

  const handleSelectGrandPrix = (grandPrixId: GrandPrixId) => {
    setSelectedGrandPrixId(grandPrixId);
    setGrandPrixProgress(null);
    setErrorMessage(null);
  };

  const handleConfirmOnlinePlayerName = () => {
    const trimmedName = onlinePlayerNameInput.trim().slice(0, 24);
    if (trimmedName.length === 0) {
      setErrorMessage('Saisis ton nom avant de continuer.');
      return;
    }

    setOnlinePlayerName(trimmedName);
    setOnlinePlayerNameInput(trimmedName);
    setErrorMessage(null);
    setScreen('online-lobby-menu');
  };

  const handleOpenOnlineLobbyBrowser = () => {
    setErrorMessage(null);
    const firstLobby = waitingOnlineLobbies[0] ?? null;
    setSelectedOnlineLobbyId(firstLobby?.id ?? null);
    setOnlineLobbyCodeInput(firstLobby?.code ?? '');
    setScreen('online-lobby-browser');
  };

  const handleCreateOnlineLobby = () => {
    if (!onlinePlayerPresence) {
      setErrorMessage('Confirme ton nom avant de creer un lobby.');
      return;
    }

    createServerLobby(onlinePlayerPresence);
    setSelectedOnlineLobbyId(null);
    pendingOnlineLobbyEntryRef.current = true;
    setErrorMessage(null);
  };

  const handleSelectOnlineLobby = useCallback(
    (lobbyId: string) => {
      setSelectedOnlineLobbyId(lobbyId);
      const lobby = waitingOnlineLobbies.find((entry) => entry.id === lobbyId) ?? null;
      if (lobby) {
        setOnlineLobbyCodeInput(lobby.code);
      }
    },
    [waitingOnlineLobbies],
  );

  const handleJoinSelectedOnlineLobby = () => {
    if (!selectedOnlineLobbyId) {
      setErrorMessage('Choisis un lobby a rejoindre.');
      return;
    }

    if (!onlinePlayerPresence) {
      setErrorMessage('Confirme ton nom avant de rejoindre un lobby.');
      return;
    }

    joinServerLobby(selectedOnlineLobbyId, onlinePlayerPresence);
    pendingOnlineLobbyEntryRef.current = true;
    setErrorMessage(null);
  };

  const handleJoinLobbyByCode = () => {
    const normalizedCode = onlineLobbyCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (normalizedCode.length !== 6) {
      setErrorMessage('Saisis un code lobby a 6 caracteres.');
      return;
    }

    if (!onlinePlayerPresence) {
      setErrorMessage('Confirme ton nom avant de rejoindre un lobby.');
      return;
    }

    joinServerLobbyByCode(normalizedCode, onlinePlayerPresence);
    setOnlineLobbyCodeInput(normalizedCode);
    pendingOnlineLobbyEntryRef.current = true;
    setErrorMessage(null);
  };

  const handleLeaveOnlineLobby = () => {
    clearOnlineLobbyMembership();
    resetOnlineFlowState();
    setErrorMessage(null);
    setScreen('online-lobby-menu');
  };

  const handleLaunchOnlineGrandPrix = useCallback(() => {
    if (!currentOnlineLobby) {
      setErrorMessage('Aucun lobby actif a lancer.');
      return;
    }
    if (!isCurrentOnlineLobbyHost) {
      setErrorMessage('Seul le host peut choisir et lancer le Grand Prix.');
      return;
    }

    setSelectedGrandPrixId((current) => current ?? GRAND_PRIX_ORDER[0] ?? null);
    setGrandPrixProgress(null);
    setErrorMessage(null);
    setScreen('circuit');
  }, [currentOnlineLobby, isCurrentOnlineLobbyHost]);

  useEffect(() => {
    const isOnlineLobbyFlowScreen =
      screen === 'online-lobby' || (screen === 'circuit' && mode === 'online');
    if (!isOnlineLobbyFlowScreen) return;
    if (!onlineSessionId) return;
    if (currentOnlineLobby?.players.some((player) => player.sessionId === onlineSessionId)) {
      return;
    }
    if (multiplayerSnapshot.currentLobbyId && !currentOnlineLobby) return;

    setSelectedOnlineLobbyId(null);
    setScreen('online-lobby-menu');
    setErrorMessage('Le lobby a ete ferme ou tu en as ete retire.');
  }, [currentOnlineLobby, mode, multiplayerSnapshot.currentLobbyId, onlineSessionId, screen]);

  useEffect(() => {
    if (!selectedOnlineLobbyId) return;
    if (selectedOnlineLobby) return;
    setSelectedOnlineLobbyId(waitingOnlineLobbies[0]?.id ?? null);
    setOnlineLobbyCodeInput(waitingOnlineLobbies[0]?.code ?? '');
  }, [selectedOnlineLobby, selectedOnlineLobbyId, waitingOnlineLobbies]);

  useEffect(() => {
    if (!pendingOnlineLobbyEntryRef.current) return;
    if (!currentOnlineLobby || !onlineSessionId) return;
    const isMember = currentOnlineLobby.players.some((player) => player.sessionId === onlineSessionId);
    if (!isMember) return;
    pendingOnlineLobbyEntryRef.current = false;
    setScreen('online-lobby');
  }, [currentOnlineLobby, onlineSessionId]);

  useEffect(() => {
    if (!currentOnlineLobby || !onlinePlayerPresence) return;
    updateServerLobbyProfile(onlinePlayerPresence);
  }, [currentOnlineLobby, onlinePlayerPresence]);

  const buildRaceConfigForCourseIndex = useCallback(
    (courseIndex: number, forcedGrandPrixId?: GrandPrixId): RaceConfig | null => {
      const effectiveGrandPrixId = forcedGrandPrixId ?? selectedGrandPrixId;
      if (!mode || !cc || !effectiveGrandPrixId || !humanCount) return null;

      const currentGrandPrix = GRAND_PRIXS[effectiveGrandPrixId];
      const selectedCourse = currentGrandPrix?.courses[courseIndex];
      const selectedCircuit = selectedCourse?.circuitId;
      if (!selectedCourse || !selectedCircuit || !(selectedCircuit in CIRCUITS)) {
        return null;
      }

      const circuitConfig = CIRCUITS[selectedCircuit];

      const isOnlineMode = mode === 'online';
      const humanParticipants: RaceParticipantConfig[] = [];
      const onlineRace = currentOnlineRace;
      const orderedOnlineParticipants: RaceParticipantConfig[] = [];

      if (isOnlineMode) {
        if (!onlineRace || !onlineSessionId) return null;
        const localOnlinePlayer =
          onlineRace.participants.find((player) => player.sessionId === onlineSessionId) ?? null;
        if (!localOnlinePlayer) return null;

        for (const player of onlineRace.participants) {
          const isLocalPlayer = player.sessionId === onlineSessionId;
          const isBotParticipant = player.sessionId.startsWith('bot-');
          const isBotAuthority = isBotParticipant && isCurrentOnlineLobbyHost;
          orderedOnlineParticipants.push(
            createResolvedParticipantConfig({
              id: player.participantId,
              displayName: player.displayName,
              kind:
                isLocalPlayer ? 'human'
                : isBotParticipant ? 'bot'
                : 'remote',
              ...(isLocalPlayer ? { humanSlotId: 'p1' as const } : {}),
              controlMode:
                isLocalPlayer ? 'human'
                : isBotAuthority ? 'autopilot'
                : 'remote',
              loadout: player.loadout,
              ...(isLocalPlayer ?
                {
                  keyBindings: {
                    ...PLAYER_KEY_BINDINGS.p1,
                    useObject: [' '],
                  },
                }
              : {}),
            }),
          );
        }
      } else {
        const humanSlots = getHumanSlots(humanCount);
        for (const slot of humanSlots) {
          const loadout = humanLoadoutsBySlot[slot];
          if (!loadout) return null;
          const defaultKeyBindings = PLAYER_KEY_BINDINGS[slot];
          const resolvedKeyBindings =
            mode === 'solo' && slot === 'p1' ?
              {
                ...defaultKeyBindings,
                useObject: [' '],
              }
            : defaultKeyBindings;

          humanParticipants.push(
            createResolvedParticipantConfig({
              id: `human-${slot}`,
              displayName: getHumanDisplayName(slot),
              kind: 'human',
              humanSlotId: slot,
              controlMode: 'human',
              loadout,
              keyBindings: resolvedKeyBindings,
            }),
          );
        }
      }

      const desiredParticipantCount =
        isOnlineMode ? orderedOnlineParticipants.length
        : Math.max(
            humanParticipants.length,
            PERF_PROFILE.simulateBots ?
              Math.min(TOTAL_RACE_PARTICIPANTS, Math.max(humanCount, PERF_PROFILE.maxRaceParticipants))
            : humanParticipants.length,
          );
      if (circuitConfig.spawnSlots.length < desiredParticipantCount) {
        return null;
      }

      const previousCourseResult =
        courseIndex > 0 ?
          grandPrixProgress?.courseResults.find((result) => result.courseIndex === courseIndex - 1) ?? null
        : null;

      const participantPool: RaceParticipantConfig[] = (() => {
        // Keep the exact same drivers/karts across GP courses once race 1 has started.
        if (
          courseIndex > 0 &&
          raceConfig &&
          raceConfig.grandPrixId === effectiveGrandPrixId &&
          raceConfig.participants.length === desiredParticipantCount
        ) {
          const previousPositionByParticipant = new Map(
            (previousCourseResult?.ranking ?? []).map((entry) => [entry.participantId, entry.position]),
          );
          const previousOrderByParticipant = new Map(
            raceConfig.participants.map((participant, index) => [participant.id, index]),
          );
          return [...raceConfig.participants].sort((left, right) => {
            const leftPos = previousPositionByParticipant.get(left.id) ?? Number.MAX_SAFE_INTEGER;
            const rightPos = previousPositionByParticipant.get(right.id) ?? Number.MAX_SAFE_INTEGER;
            if (leftPos !== rightPos) return leftPos - rightPos;

            return (
              (previousOrderByParticipant.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
              (previousOrderByParticipant.get(right.id) ?? Number.MAX_SAFE_INTEGER)
            );
          });
        }

        const botParticipants: RaceParticipantConfig[] =
          isOnlineMode ?
            []
          : Array.from({ length: desiredParticipantCount - humanParticipants.length }, (_, index) =>
              createResolvedParticipantConfig({
                id: `bot-${index + 1}`,
                displayName: `Bot ${index + 1}`,
                kind: 'bot',
                controlMode: 'autopilot',
                loadout: createRandomLoadoutSelection(),
              }),
            );

        if (isOnlineMode) {
          return orderedOnlineParticipants;
        }

        // GP race 1: humans start on the last grid slots, bots are randomized on front slots.
        return [...shuffleParticipants(botParticipants), ...humanParticipants];
      })();

      const participants = participantPool.map((participant, index) => {
        const spawnSlot = circuitConfig.spawnSlots[index];
        return {
          ...participant,
          spawn: spawnSlot.position,
          spawnRotation: spawnSlot.rotation,
        };
      });

        return {
          mode,
          humanCount: isOnlineMode ? 1 : humanCount,
          cc,
          circuit: selectedCircuit,
          grandPrixId: effectiveGrandPrixId,
          courseId: selectedCourse.id,
          courseLabel: selectedCourse.label,
          courseIndex,
          totalCourses: isOnlineMode ? onlineRace?.totalCourses ?? 1 : currentGrandPrix.courses.length,
          participants,
        };
      },
    [
      cc,
      currentOnlineRace,
      grandPrixProgress?.courseResults,
      humanCount,
      humanLoadoutsBySlot,
      isCurrentOnlineLobbyHost,
      mode,
      onlineSessionId,
      raceConfig,
      selectedGrandPrixId,
    ],
  );

  const launchCourseAtIndex = useCallback(
    async (courseIndex: number, forcedGrandPrixId?: GrandPrixId) => {
      const nextRaceConfig = buildRaceConfigForCourseIndex(courseIndex, forcedGrandPrixId);
      if (!nextRaceConfig) {
        setErrorMessage('Impossible de preparer la course choisie.');
        return false;
      }

      setIsCheckingAssets(true);
      setErrorMessage(null);
      try {
        const requiredAssetUrls = getRaceAssetUrls(nextRaceConfig);

        const missingAssets = await getMissingAssetUrls(requiredAssetUrls);
        if (missingAssets.length > 0) {
          setErrorMessage(`Assets manquants: ${missingAssets.join(', ')}`);
          return false;
        }

        preloadGLTFAssetCacheEntries(requiredAssetUrls);

        const nextAssetSet = new Set(requiredAssetUrls);
        const staleAssetUrls = Array.from(loadedRaceAssetUrlsRef.current).filter(
          (url) => !nextAssetSet.has(url),
        );
        pendingCacheClearCancelRef.current?.();

        // Clear most stale assets immediately while loading the next course,
        // then finish the remainder asynchronously to avoid long per-frame work.
        const immediateChunkSize = 24;
        const immediateUrls = staleAssetUrls.slice(0, immediateChunkSize);
        const deferredUrls = staleAssetUrls.slice(immediateChunkSize);
        if (immediateUrls.length > 0) {
          clearGLTFAssetCacheEntries(immediateUrls);
        }
        pendingCacheClearCancelRef.current =
          deferredUrls.length > 0 ?
            scheduleGLTFAssetCacheClear(deferredUrls, {
              chunkSize: 6,
              intervalMs: 8,
            })
          : null;

        loadedRaceAssetUrlsRef.current = nextAssetSet;
        setRaceConfig(nextRaceConfig);
        setScreen('race');
        gameMode.current = 'run';
        return true;
      } finally {
        setIsCheckingAssets(false);
      }
    },
    [buildRaceConfigForCourseIndex],
  );

  const handleObservedOnlineRace = useCallback(
    async (onlineRace: NonNullable<typeof currentOnlineRace>) => {
      const raceToken = `${onlineRace.raceId}:${onlineRace.courseIndex}`;
      if (handledOnlineRaceTokenRef.current === raceToken) return;

      const localPlayer =
        onlineSessionId ?
          onlineRace.participants.find((player) => player.sessionId === onlineSessionId) ?? null
        : null;
      if (!localPlayer) {
        setErrorMessage('La course reseau ne contient pas ce joueur.');
        return;
      }

      handledOnlineRaceTokenRef.current = raceToken;
      setMode('online');
      setCc(onlineRace.cc);
      setHumanCount(1);
      setActiveHumanSlot('p1');
      setSelectedGrandPrixId(onlineRace.grandPrixId);
      setHumanLoadoutsBySlot({
        p1: localPlayer.loadout,
      });
      setErrorMessage(null);

      const launched = await launchCourseAtIndex(onlineRace.courseIndex, onlineRace.grandPrixId);
      if (!launched) {
        handledOnlineRaceTokenRef.current = null;
        return;
      }

      setGrandPrixProgress((current) => {
        if (!current || current.grandPrixId !== onlineRace.grandPrixId) {
          return {
            grandPrixId: onlineRace.grandPrixId,
            currentCourseIndex: onlineRace.courseIndex,
            courseResults: [],
          };
        }

        return {
          ...current,
          currentCourseIndex: onlineRace.courseIndex,
        };
      });
    },
    [launchCourseAtIndex, onlineSessionId],
  );

  useEffect(() => {
    if (!currentOnlineRace) return;
    const modeIsOnline = mode === 'online';
    const shouldObserveOnlineRace =
      modeIsOnline || screen === 'online-lobby' || (screen === 'circuit' && modeIsOnline) || screen === 'race';
    if (!shouldObserveOnlineRace) return;
    void handleObservedOnlineRace(currentOnlineRace);
  }, [currentOnlineRace, handleObservedOnlineRace, mode, screen]);

  const handleNetworkSceneReady = useCallback((raceId: string) => {
    if (reportedOnlineRaceLoadedIdRef.current === raceId) return;
    reportedOnlineRaceLoadedIdRef.current = raceId;
    markServerRaceLoaded(raceId);
  }, []);

  const handleNetworkLocalPose = useCallback(
    (
      raceId: string,
      participantId: string,
      pose: Parameters<typeof publishServerRacePose>[2],
      options?: Parameters<typeof publishServerRacePose>[3],
    ) => {
      if (mode !== 'online') return;
      const now = performance.now();
      const lastPublishedAt = lastPublishedNetworkPoseAtRef.current.get(participantId) ?? 0;
      const minIntervalMs =
        participantId.startsWith('bot-') ?
          BOT_NETWORK_POSE_PUBLISH_INTERVAL_MS
        : HUMAN_NETWORK_POSE_PUBLISH_INTERVAL_MS;
      const bypassThrottle = options?.lapProgress?.finished === true;
      if (!bypassThrottle && now - lastPublishedAt < minIntervalMs) return;
      lastPublishedNetworkPoseAtRef.current.set(participantId, now);
      publishServerRacePose(raceId, participantId, pose, options);
    },
    [mode],
  );

  const handleNetworkRaceEvent = useCallback((raceId: string, event: Parameters<typeof sendServerRaceEvent>[1]) => {
    sendServerRaceEvent(raceId, event);
  }, []);

  const handleNetworkCourseResultValidated = useCallback((raceId: string) => {
    acknowledgeServerRaceResult(raceId);
  }, []);

  const handleConfirmGrandPrix = async () => {
    if (!mode || !cc || !selectedGrandPrixId || !humanCount) {
      setErrorMessage('Selection incomplete avant lancement.');
      return;
    }

    if (mode === 'online') {
      if (!currentOnlineLobby) {
        setErrorMessage('Aucun lobby actif a lancer.');
        return;
      }
      if (!isCurrentOnlineLobbyHost) {
        setErrorMessage('Seul le host peut choisir et lancer le Grand Prix.');
        return;
      }
      startServerRace(selectedGrandPrixId, '150cc');
      setErrorMessage(null);
      return;
    }

    const requiredSlots = getHumanSlots(humanCount);
    for (const slot of requiredSlots) {
      if (!humanLoadoutsBySlot[slot]) {
        setErrorMessage(`${getHumanDisplayName(slot)} doit confirmer sa selection.`);
        return;
      }
    }

    const selectedCup = GRAND_PRIXS[selectedGrandPrixId];
    if (!selectedCup || !selectedCup.courses[0]) {
      console.warn('[grand-prix] Configuration invalide', {
        grandPrixId: selectedGrandPrixId,
      });
      setErrorMessage('Grand Prix invalide. Verifie la configuration des courses.');
      return;
    }

    const firstCourse = selectedCup.courses[0];
    const selectedCircuit = firstCourse?.circuitId;
    if (!selectedCircuit || !(selectedCircuit in CIRCUITS)) {
      console.warn('[grand-prix] Circuit de depart introuvable', {
        grandPrixId: selectedGrandPrixId,
        firstCourse,
      });
      setErrorMessage('Circuit de depart invalide pour ce Grand Prix.');
      return;
    }

    const launched = await launchCourseAtIndex(0);
    if (!launched) return;

    setGrandPrixProgress({
      grandPrixId: selectedGrandPrixId,
      currentCourseIndex: 0,
      courseResults: [],
    });
  };

  const handleCourseFinished = useCallback((result: CourseRaceResult) => {
    setGrandPrixProgress((current) => {
      if (!current || current.grandPrixId !== result.grandPrixId) return current;
      const alreadyStored = current.courseResults.some(
        (existingResult) => existingResult.courseId === result.courseId,
      );
      if (alreadyStored) return current;

      return {
        ...current,
        courseResults: [...current.courseResults, result].sort(
          (left, right) => left.courseIndex - right.courseIndex,
        ),
      };
    });
  }, []);

  const handleNextCourse = useCallback(async () => {
    const progress = grandPrixProgress;
    if (!progress) return;

    const cup = GRAND_PRIXS[progress.grandPrixId];
    if (!cup) return;

    const nextCourseIndex = progress.currentCourseIndex + 1;
    if (nextCourseIndex >= cup.courses.length) return;

    const launched = await launchCourseAtIndex(nextCourseIndex);
    if (!launched) {
      setScreen('circuit');
      return;
    }

    setGrandPrixProgress((current) => {
      if (!current || current.grandPrixId !== progress.grandPrixId) return current;
      return {
        ...current,
        currentCourseIndex: nextCourseIndex,
      };
    });
  }, [grandPrixProgress, launchCourseAtIndex]);

  const hasNextCourse =
    raceConfig ? raceConfig.courseIndex + 1 < raceConfig.totalCourses : false;
  const effectiveMenuErrorMessage =
    errorMessage ?? (mode === 'online' ? multiplayerSnapshot.connectionError : null);

  const menuScreen: Exclude<GameScreen, 'race'> = screen === 'race' ? 'home' : screen;
  const sceneKey =
    raceConfig ?
      [
        raceConfig.grandPrixId,
        raceConfig.courseId,
        raceConfig.courseIndex,
        raceConfig.circuit,
      ].join('|')
    : 'no-race';
  const showPerformanceOverlay = screen === 'race' && isPerformanceOverlayEnabled;

  return (
    <div className="mk-aspect-shell">
      <div className="mk-aspect-frame">
        <div className="mk-aspect-stage">
          {screen === 'race' && raceConfig ? (
            <Scene
              key={sceneKey}
              raceConfig={raceConfig}
              onRaceBack={resetToHome}
              onCourseFinished={handleCourseFinished}
              onNextCourse={handleNextCourse}
              hasNextCourse={hasNextCourse}
              isAdvancingCourse={isCheckingAssets}
              grandPrixStandings={grandPrixStandings}
              networkRaceState={mode === 'online' ? currentOnlineRace : null}
              networkOwnedParticipantIds={mode === 'online' ? currentOnlineOwnedParticipantIds : []}
              onNetworkSceneReady={handleNetworkSceneReady}
              onNetworkLocalPose={handleNetworkLocalPose}
              onNetworkRaceEvent={handleNetworkRaceEvent}
              onNetworkCourseResultValidated={handleNetworkCourseResultValidated}
              onRendererPerformanceSample={
                showPerformanceOverlay ? handleRendererPerformanceSample : undefined
              }
            />
          ) : (
            <GameMenu
              screen={menuScreen}
              mode={mode}
              cc={cc}
              humanCount={humanCount}
              humanLoadoutsBySlot={humanLoadoutsBySlot}
              activeLoadout={activeLoadout}
              activeHumanSlot={activeHumanSlot}
              selectedGrandPrixId={selectedGrandPrix?.id ?? selectedGrandPrixId}
              onlinePlayerNameInput={onlinePlayerNameInput}
              onlinePlayerName={onlinePlayerName}
              selectedOnlineLobbyId={selectedOnlineLobbyId}
              onlineLobbyCodeInput={onlineLobbyCodeInput}
              waitingOnlineLobbies={waitingOnlineLobbies}
              selectedOnlineLobby={selectedOnlineLobby}
              currentOnlineLobby={currentOnlineLobby}
              isCurrentOnlineLobbyHost={isCurrentOnlineLobbyHost}
              errorMessage={effectiveMenuErrorMessage}
              isCheckingAssets={isCheckingAssets}
              onBack={handleBack}
              onSelectMode={handleSelectMode}
              onOpenConfig={handleOpenConfig}
              onSelectCc={handleSelectCc}
              onSelectHumanCount={handleSelectHumanCount}
              onCycleCharacter={handleCycleCharacter}
              onCycleVehicle={handleCycleVehicle}
              onCycleWheel={handleCycleWheel}
              onConfirmLoadout={handleConfirmLoadout}
              onSelectGrandPrix={handleSelectGrandPrix}
              onConfirmGrandPrix={handleConfirmGrandPrix}
              onChangeOnlinePlayerNameInput={setOnlinePlayerNameInput}
              onConfirmOnlinePlayerName={handleConfirmOnlinePlayerName}
              onOpenOnlineLobbyBrowser={handleOpenOnlineLobbyBrowser}
              onCreateOnlineLobby={handleCreateOnlineLobby}
              onChangeOnlineLobbyCodeInput={setOnlineLobbyCodeInput}
              onSelectOnlineLobby={handleSelectOnlineLobby}
              onJoinSelectedOnlineLobby={handleJoinSelectedOnlineLobby}
              onJoinLobbyByCode={handleJoinLobbyByCode}
              onLaunchOnlineGrandPrix={handleLaunchOnlineGrandPrix}
              onLeaveOnlineLobby={handleLeaveOnlineLobby}
            />
          )}

          {screen === 'race' ?
            <CommandBubble
              isMultiplayerRace={isMultiplayerRace}
              isOnlineRace={isOnlineRace}
              isOnlineRaceHost={Boolean(isCurrentOnlineLobbyHost)}
              onlineRaceId={currentOnlineRace?.raceId ?? null}
              onInfoOverlayChange={setIsPerformanceOverlayEnabled}
            />
          : null}

          {showPerformanceOverlay ? (
            <div className="pointer-events-none absolute left-1/2 top-[clamp(0.5rem,1.2cqh,0.9rem)] z-70 w-[min(94cqw,720px)] -translate-x-1/2 rounded-lg border border-white/35 bg-[#061937]/76 px-[clamp(0.6rem,1.4cqw,1rem)] py-[clamp(0.45rem,1cqh,0.7rem)] text-white backdrop-blur-sm">
              <div className="text-center text-[clamp(0.62rem,1.05cqh,0.74rem)] font-black uppercase tracking-[0.12em] text-white/85">
                Info performance
              </div>
              <div className="mt-[clamp(0.25rem,0.7cqh,0.4rem)] grid grid-cols-2 gap-x-[clamp(0.5rem,1.2cqw,0.9rem)] gap-y-[clamp(0.15rem,0.55cqh,0.3rem)] text-[clamp(0.62rem,1.05cqh,0.8rem)] font-semibold">
                <div>FPS: {formatStatInteger(performanceOverlayStats.fps)}</div>
                <div>
                  RAM appareil: {performanceOverlayStats.deviceRamGb !== null ? `${formatStatInteger(performanceOverlayStats.deviceRamGb)} Go` : '--'}
                </div>
                <div>
                  RAM jeu (heap): {formatStatNumber(performanceOverlayStats.jsHeapUsedMb)} / {formatStatNumber(performanceOverlayStats.jsHeapTotalMb)} Mo
                </div>
                <div>
                  Charge RAM jeu: {formatStatNumber(performanceOverlayStats.jsHeapUsagePercent)}%
                </div>
                <div>
                  Limite heap: {formatStatNumber(performanceOverlayStats.jsHeapLimitMb)} Mo
                </div>
                <div>
                  Mem. graphique: tex {formatStatInteger(performanceOverlayStats.gpuTextures)} / geo {formatStatInteger(performanceOverlayStats.gpuGeometries)} / prog {formatStatInteger(performanceOverlayStats.gpuPrograms)}
                </div>
                <div>
                  Draw calls: {formatStatInteger(performanceOverlayStats.gpuDrawCalls)}
                </div>
                <div>
                  Triangles/frame: {formatStatInteger(performanceOverlayStats.gpuTriangles)}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
