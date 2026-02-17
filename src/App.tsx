import { useCallback, useMemo, useState } from 'react';
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
  PLAYER_KEY_BINDINGS,
} from './config/raceCatalog';
import { gameMode } from './state/gamemode';
import type {
  CcLevel,
  CircuitId,
  CourseRaceResult,
  GameScreen,
  GrandPrixId,
  GrandPrixStanding,
  PlayerId,
  PlayerLoadoutSelection,
  RaceConfig,
  RaceMode,
} from './types/game';

type GrandPrixProgressState = {
  grandPrixId: GrandPrixId;
  currentCourseIndex: number;
  courseResults: CourseRaceResult[];
};

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

function getCircuitAssetUrls(circuitId: CircuitId) {
  const circuit = CIRCUITS[circuitId];
  return [
    circuit.road.model,
    circuit.ext.model,
    circuit.antiGravIn?.model,
    circuit.antiGravOut?.model,
    circuit.booster?.model,
    circuit.lapStart?.model,
    circuit.lapCheckpoint?.model,
  ].filter((modelPath): modelPath is string => Boolean(modelPath));
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

export function App() {
  const [screen, setScreen] = useState<GameScreen>('home');
  const [mode, setMode] = useState<RaceMode | null>(null);
  const [cc, setCc] = useState<CcLevel | null>(null);
  const [p1Loadout, setP1Loadout] = useState<PlayerLoadoutSelection | null>(null);
  const [p2Loadout, setP2Loadout] = useState<PlayerLoadoutSelection | null>(null);
  const [activeCharacterPlayer, setActiveCharacterPlayer] = useState<PlayerId>('p1');
  const [selectedGrandPrixId, setSelectedGrandPrixId] = useState<GrandPrixId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCheckingAssets, setIsCheckingAssets] = useState(false);
  const [raceConfig, setRaceConfig] = useState<RaceConfig | null>(null);
  const [grandPrixProgress, setGrandPrixProgress] = useState<GrandPrixProgressState | null>(null);

  const activeLoadout = activeCharacterPlayer === 'p1' ? p1Loadout : p2Loadout;

  const isMultiplayerRace = useMemo(
    () => screen === 'race' && raceConfig?.mode === 'multi',
    [raceConfig?.mode, screen],
  );

  const selectedGrandPrix =
    selectedGrandPrixId ? GRAND_PRIXS[selectedGrandPrixId] : null;

  const grandPrixStandings = useMemo<GrandPrixStanding[]>(() => {
    if (!grandPrixProgress || !raceConfig) return [];

    const orderedResults = [...grandPrixProgress.courseResults].sort(
      (a, b) => a.courseIndex - b.courseIndex,
    );

    const standings = raceConfig.players.map((player) => {
      const coursePositions = orderedResults.map((result) => {
        const playerEntry = result.ranking.find((entry) => entry.playerId === player.id);
        return playerEntry?.position ?? raceConfig.players.length;
      });
      const totalPosition = coursePositions.reduce((sum, value) => sum + value, 0);
      return {
        playerId: player.id,
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
      return left.playerId.localeCompare(right.playerId);
    });

    return standings;
  }, [grandPrixProgress, raceConfig]);

  const resetToHome = () => {
    setScreen('home');
    setMode(null);
    setCc(null);
    setP1Loadout(null);
    setP2Loadout(null);
    setActiveCharacterPlayer('p1');
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
      setGrandPrixProgress(null);
      setScreen('home');
      return;
    }

    if (screen === 'characters') {
      if (mode === 'multi' && activeCharacterPlayer === 'p2') {
        setP2Loadout(null);
        setActiveCharacterPlayer('p1');
        return;
      }
      setScreen('cc');
      return;
    }

    if (screen === 'circuit') {
      setGrandPrixProgress(null);
      setScreen('characters');
      setActiveCharacterPlayer(mode === 'multi' ? 'p2' : 'p1');
    }
  };

  const handleSelectMode = (nextMode: RaceMode) => {
    setMode(nextMode);
    setCc(null);
    setP1Loadout(null);
    setP2Loadout(null);
    setSelectedGrandPrixId(null);
    setErrorMessage(null);
    setActiveCharacterPlayer('p1');
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
    setP1Loadout(getDefaultLoadoutSelection());
    setP2Loadout(null);
    setSelectedGrandPrixId(GRAND_PRIX_ORDER[0] ?? null);
    setGrandPrixProgress(null);
    setErrorMessage(null);
    setActiveCharacterPlayer('p1');
    setScreen('characters');
  };

  const updateActiveLoadout = (
    updater: (current: PlayerLoadoutSelection) => PlayerLoadoutSelection,
  ) => {
    setErrorMessage(null);
    setSelectedGrandPrixId(GRAND_PRIX_ORDER[0] ?? null);
    setGrandPrixProgress(null);

    if (activeCharacterPlayer === 'p1') {
      setP1Loadout((current) => updater(current ?? getDefaultLoadoutSelection()));
      return;
    }

    setP2Loadout((current) => updater(current ?? getDefaultLoadoutSelection()));
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
    if (!mode) return;

    setErrorMessage(null);
    setSelectedGrandPrixId((current) => current ?? GRAND_PRIX_ORDER[0] ?? null);

    if (mode === 'solo') {
      if (!p1Loadout) {
        setErrorMessage('Selection joueur 1 incomplete.');
        return;
      }
      setActiveCharacterPlayer('p1');
      setScreen('circuit');
      return;
    }

    if (activeCharacterPlayer === 'p1') {
      if (!p1Loadout) {
        setErrorMessage('Selection joueur 1 incomplete.');
        return;
      }
      setP2Loadout((current) => current ?? getDefaultLoadoutSelection());
      setActiveCharacterPlayer('p2');
      return;
    }

    if (!p2Loadout) {
      setErrorMessage('Selection joueur 2 incomplete.');
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
      if (!mode || !cc || !selectedGrandPrixId || !p1Loadout) return null;

      const currentGrandPrix = GRAND_PRIXS[selectedGrandPrixId];
      const selectedCourse = currentGrandPrix?.courses[courseIndex];
      const selectedCircuit = selectedCourse?.circuitId;
      if (!selectedCourse || !selectedCircuit || !(selectedCircuit in CIRCUITS)) {
        return null;
      }

      if (mode === 'multi' && !p2Loadout) return null;

      const p1Character = getCatalogItemById(CHARACTERS, p1Loadout.characterId);
      const p1Vehicle = getCatalogItemById(VEHICLES, p1Loadout.vehicleId);
      const p1Wheel = getCatalogItemById(WHEELS, p1Loadout.wheelId);
      const circuitConfig = CIRCUITS[selectedCircuit];
      const p1WheelProfile = WHEEL_SIZE_HEIGHT_PROFILES[p1Wheel.size];

      const players: RaceConfig['players'] = [
        {
          id: 'p1',
          loadout: p1Loadout,
          vehicleModel: p1Vehicle.model,
          vehicleScale: p1Vehicle.scale,
          characterModel: p1Character.model,
          characterScale: p1Character.scale,
          wheelModel: p1Wheel.model,
          wheelScale: p1Wheel.scale,
          characterMount: p1Vehicle.characterMount,
          wheelMounts: p1Vehicle.wheelMounts,
          chassisLift: p1WheelProfile.chassisLift,
          driverLift: p1WheelProfile.driverLift,
          spawn: mode === 'multi' ? circuitConfig.spawns.p1 : circuitConfig.spawns.solo,
          spawnRotation:
            mode === 'multi' ? circuitConfig.spawnRotations.p1 : circuitConfig.spawnRotations.solo,
          keyBindings: PLAYER_KEY_BINDINGS.p1,
        },
      ];

      if (mode === 'multi' && p2Loadout) {
        const p2Character = getCatalogItemById(CHARACTERS, p2Loadout.characterId);
        const p2Vehicle = getCatalogItemById(VEHICLES, p2Loadout.vehicleId);
        const p2Wheel = getCatalogItemById(WHEELS, p2Loadout.wheelId);
        const p2WheelProfile = WHEEL_SIZE_HEIGHT_PROFILES[p2Wheel.size];
        players.push({
          id: 'p2',
          loadout: p2Loadout,
          vehicleModel: p2Vehicle.model,
          vehicleScale: p2Vehicle.scale,
          characterModel: p2Character.model,
          characterScale: p2Character.scale,
          wheelModel: p2Wheel.model,
          wheelScale: p2Wheel.scale,
          characterMount: p2Vehicle.characterMount,
          wheelMounts: p2Vehicle.wheelMounts,
          chassisLift: p2WheelProfile.chassisLift,
          driverLift: p2WheelProfile.driverLift,
          spawn: circuitConfig.spawns.p2,
          spawnRotation: circuitConfig.spawnRotations.p2,
          keyBindings: PLAYER_KEY_BINDINGS.p2,
        });
      }

      return {
        mode,
        cc,
        circuit: selectedCircuit,
        grandPrixId: selectedGrandPrixId,
        courseId: selectedCourse.id,
        courseLabel: selectedCourse.label,
        courseIndex,
        totalCourses: currentGrandPrix.courses.length,
        players,
      };
    },
    [cc, mode, p1Loadout, p2Loadout, selectedGrandPrixId],
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
        const requiredAssetUrls = [
          ...getCircuitAssetUrls(nextRaceConfig.circuit),
          ...nextRaceConfig.players.flatMap((player) => [
            player.characterModel,
            player.vehicleModel,
            player.wheelModel,
          ]),
        ];

        const missingAssets = await getMissingAssetUrls(requiredAssetUrls);
        if (missingAssets.length > 0) {
          setErrorMessage(`Assets manquants: ${missingAssets.join(', ')}`);
          return false;
        }

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
    if (!mode || !cc || !selectedGrandPrixId || !p1Loadout) {
      setErrorMessage('Selection incomplete avant lancement.');
      return;
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

    if (mode === 'multi' && !p2Loadout) {
      setErrorMessage('Le joueur 2 doit confirmer sa selection.');
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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {screen === 'race' && raceConfig ? (
        <Scene
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
          p1Loadout={p1Loadout}
          p2Loadout={p2Loadout}
          activeLoadout={activeLoadout}
          activeCharacterPlayer={activeCharacterPlayer}
          selectedGrandPrixId={selectedGrandPrix?.id ?? selectedGrandPrixId}
          errorMessage={errorMessage}
          isCheckingAssets={isCheckingAssets}
          onBack={handleBack}
          onSelectMode={handleSelectMode}
          onOpenConfig={handleOpenConfig}
          onSelectCc={handleSelectCc}
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
