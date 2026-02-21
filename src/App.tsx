import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CommandBubble from './components/CommandBubble';
import { GameMenu } from './components/GameMenu';
import { Scene } from './components/Scene';
import {
  CHARACTERS,
  VEHICLES,
  WHEELS,
  WHEEL_SIZE_HEIGHT_PROFILES,
  cycleIndex,
  getCatalogItemById,
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
  scheduleAllKnownModelCacheClear,
  scheduleGLTFAssetCacheClear,
} from './utils/raceAssetMemory';

type GrandPrixProgressState = {
  grandPrixId: GrandPrixId;
  currentCourseIndex: number;
  courseResults: CourseRaceResult[];
};

const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];

async function checkAssetAvailability(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
  } catch {
    // fallback GET handled below
  }

  try {
    const get = await fetch(url, { method: 'GET' });
    return get.ok;
  } catch {
    return false;
  }
}

async function getMissingAssetUrls(urls: string[]) {
  const deduplicated = Array.from(new Set(urls));
  const checks = await Promise.all(
    deduplicated.map(async (modelPath) => ({
      modelPath,
      exists: await checkAssetAvailability(modelPath),
    })),
  );

  return checks.filter((entry) => !entry.exists).map((entry) => entry.modelPath);
}

function getHumanSlots(humanCount: number) {
  return HUMAN_SLOT_ORDER.slice(0, Math.min(Math.max(humanCount, 1), MAX_LOCAL_HUMANS));
}

function getHumanDisplayName(slot: HumanPlayerSlotId) {
  return `Joueur ${HUMAN_SLOT_ORDER.indexOf(slot) + 1}`;
}

function createRandomLoadoutSelection(): PlayerLoadoutSelection {
  const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] ?? CHARACTERS[0];
  const vehicle = VEHICLES[Math.floor(Math.random() * VEHICLES.length)] ?? VEHICLES[0];
  const wheel = WHEELS[Math.floor(Math.random() * WHEELS.length)] ?? WHEELS[0];

  return {
    characterId: character?.id ?? '',
    vehicleId: vehicle?.id ?? '',
    wheelId: wheel?.id ?? '',
  };
}

function shuffleParticipants(participants: RaceParticipantConfig[]) {
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled;
}

export function App() {
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
  const loadedRaceAssetUrlsRef = useRef<Set<string>>(new Set());
  const pendingCacheClearCancelRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      pendingCacheClearCancelRef.current?.();
      pendingCacheClearCancelRef.current = null;
    },
    [],
  );

  const activeLoadout = humanLoadoutsBySlot[activeHumanSlot] ?? null;

  const isMultiplayerRace = useMemo(
    () => screen === 'race' && (raceConfig?.humanCount ?? 1) > 1,
    [raceConfig?.humanCount, screen],
  );

  const selectedGrandPrix =
    selectedGrandPrixId ? GRAND_PRIXS[selectedGrandPrixId] : null;

  const grandPrixStandings = useMemo<GrandPrixStanding[]>(() => {
    if (!grandPrixProgress || !raceConfig) return [];

    const orderedResults = [...grandPrixProgress.courseResults].sort(
      (a, b) => a.courseIndex - b.courseIndex,
    );

    const standings = raceConfig.participants.map((participant) => {
      const coursePositions = orderedResults.map((result) => {
        const participantEntry = result.ranking.find(
          (entry) => entry.participantId === participant.id,
        );
        return participantEntry?.position ?? raceConfig.participants.length;
      });
      const totalPosition = coursePositions.reduce((sum, value) => sum + value, 0);
      return {
        participantId: participant.id,
        displayName: participant.displayName,
        totalPosition,
        coursePositions,
      };
    });

    standings.sort((left, right) => {
      if (left.totalPosition !== right.totalPosition) {
        return left.totalPosition - right.totalPosition;
      }
      const leftLast = left.coursePositions[left.coursePositions.length - 1] ?? Number.MAX_SAFE_INTEGER;
      const rightLast = right.coursePositions[right.coursePositions.length - 1] ?? Number.MAX_SAFE_INTEGER;
      if (leftLast !== rightLast) return leftLast - rightLast;
      return left.participantId.localeCompare(right.participantId);
    });

    return standings;
  }, [grandPrixProgress, raceConfig]);

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

    if (completedGrandPrix) {
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
    setSelectedGrandPrixId(null);
    setErrorMessage(null);
    setIsCheckingAssets(false);
    setRaceConfig(null);
    setGrandPrixProgress(null);
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

      if (mode === 'multi') {
        setScreen('playercount');
        return;
      }

      setScreen('cc');
      return;
    }

    if (screen === 'circuit') {
      setGrandPrixProgress(null);
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
    setCc(null);
    setHumanCount(nextMode === 'solo' ? 1 : null);
    setHumanLoadoutsBySlot({});
    setSelectedGrandPrixId(null);
    setErrorMessage(null);
    setActiveHumanSlot('p1');
    setRaceConfig(null);
    setGrandPrixProgress(null);
    setScreen('cc');
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

    setScreen('circuit');
  };

  const handleSelectGrandPrix = (grandPrixId: GrandPrixId) => {
    setSelectedGrandPrixId(grandPrixId);
    setGrandPrixProgress(null);
    setErrorMessage(null);
  };

  const buildRaceConfigForCourseIndex = useCallback(
    (courseIndex: number): RaceConfig | null => {
      if (!mode || !cc || !selectedGrandPrixId || !humanCount) return null;

      const currentGrandPrix = GRAND_PRIXS[selectedGrandPrixId];
      const selectedCourse = currentGrandPrix?.courses[courseIndex];
      const selectedCircuit = selectedCourse?.circuitId;
      if (!selectedCourse || !selectedCircuit || !(selectedCircuit in CIRCUITS)) {
        return null;
      }

      const circuitConfig = CIRCUITS[selectedCircuit];

      const humanSlots = getHumanSlots(humanCount);
      const humanParticipants: RaceParticipantConfig[] = [];
      for (const slot of humanSlots) {
        const loadout = humanLoadoutsBySlot[slot];
        if (!loadout) return null;

        const character = getCatalogItemById(CHARACTERS, loadout.characterId);
        const vehicle = getCatalogItemById(VEHICLES, loadout.vehicleId);
        const wheel = getCatalogItemById(WHEELS, loadout.wheelId);
        const wheelProfile = WHEEL_SIZE_HEIGHT_PROFILES[wheel.size];

        humanParticipants.push({
          id: `human-${slot}`,
          displayName: getHumanDisplayName(slot),
          kind: 'human',
          humanSlotId: slot,
          controlMode: 'human',
          loadout,
          vehicleModel: vehicle.model,
          vehicleScale: vehicle.scale,
          characterModel: character.model,
          characterScale: character.scale,
          wheelModel: wheel.model,
          wheelScale: wheel.scale,
          characterMount: vehicle.characterMount,
          wheelMounts: vehicle.wheelMounts,
          chassisLift: wheelProfile.chassisLift,
          driverLift: wheelProfile.driverLift,
          spawn: [0, 0, 0],
          spawnRotation: [0, 0, 0],
          keyBindings: PLAYER_KEY_BINDINGS[slot],
        });
      }

      const desiredParticipantCount = Math.max(
        humanParticipants.length,
        PERF_PROFILE.simulateBots ?
          Math.min(TOTAL_RACE_PARTICIPANTS, Math.max(humanCount, PERF_PROFILE.maxRaceParticipants))
        : humanParticipants.length,
      );
      if (circuitConfig.spawnSlots.length < desiredParticipantCount) {
        return null;
      }

      const botParticipants: RaceParticipantConfig[] = Array.from(
        { length: desiredParticipantCount - humanParticipants.length },
        (_, index) => {
          const loadout = createRandomLoadoutSelection();
          const character = getCatalogItemById(CHARACTERS, loadout.characterId);
          const vehicle = getCatalogItemById(VEHICLES, loadout.vehicleId);
          const wheel = getCatalogItemById(WHEELS, loadout.wheelId);
          const wheelProfile = WHEEL_SIZE_HEIGHT_PROFILES[wheel.size];
          return {
            id: `bot-${index + 1}`,
            displayName: `Bot ${index + 1}`,
            kind: 'bot',
            controlMode: 'autopilot',
            loadout,
            vehicleModel: vehicle.model,
            vehicleScale: vehicle.scale,
            characterModel: character.model,
            characterScale: character.scale,
            wheelModel: wheel.model,
            wheelScale: wheel.scale,
            characterMount: vehicle.characterMount,
            wheelMounts: vehicle.wheelMounts,
            chassisLift: wheelProfile.chassisLift,
            driverLift: wheelProfile.driverLift,
            spawn: [0, 0, 0],
            spawnRotation: [0, 0, 0],
          };
        },
      );

      const participantPool =
        PERF_PROFILE.simulateBots ?
          shuffleParticipants([...humanParticipants, ...botParticipants])
        : [...humanParticipants];
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
        humanCount,
        cc,
        circuit: selectedCircuit,
        grandPrixId: selectedGrandPrixId,
        courseId: selectedCourse.id,
        courseLabel: selectedCourse.label,
        courseIndex,
        totalCourses: currentGrandPrix.courses.length,
        participants,
      };
    },
    [cc, humanCount, humanLoadoutsBySlot, mode, selectedGrandPrixId],
  );

  const launchCourseAtIndex = useCallback(
    async (courseIndex: number) => {
      const nextRaceConfig = buildRaceConfigForCourseIndex(courseIndex);
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

  const handleConfirmGrandPrix = async () => {
    if (!mode || !cc || !selectedGrandPrixId || !humanCount) {
      setErrorMessage('Selection incomplete avant lancement.');
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
    if (!selectedCup || selectedCup.courses.length === 0) {
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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
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
          errorMessage={errorMessage}
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
        />
      )}

      {screen === 'race' ? <CommandBubble isMultiplayerRace={isMultiplayerRace} /> : null}
    </div>
  );
}
