import { useMemo, useState } from 'react';
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
  GameScreen,
  GrandPrixId,
  PlayerId,
  PlayerLoadoutSelection,
  RaceConfig,
  RaceMode,
} from './types/game';

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

  const activeLoadout = activeCharacterPlayer === 'p1' ? p1Loadout : p2Loadout;

  const isMultiplayerRace = useMemo(
    () => screen === 'race' && raceConfig?.mode === 'multi',
    [raceConfig?.mode, screen],
  );

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
    setErrorMessage(null);
    setActiveCharacterPlayer('p1');
    setScreen('characters');
  };

  const updateActiveLoadout = (
    updater: (current: PlayerLoadoutSelection) => PlayerLoadoutSelection,
  ) => {
    setErrorMessage(null);
    setSelectedGrandPrixId(GRAND_PRIX_ORDER[0] ?? null);

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
    setErrorMessage(null);
  };

  const handleConfirmGrandPrix = async () => {
    if (!mode || !cc || !selectedGrandPrixId || !p1Loadout) {
      setErrorMessage('Selection incomplete avant lancement.');
      return;
    }

    const selectedGrandPrix = GRAND_PRIXS[selectedGrandPrixId];
    if (!selectedGrandPrix || selectedGrandPrix.courses.length !== 4) {
      console.warn('[grand-prix] Configuration invalide', {
        grandPrixId: selectedGrandPrixId,
      });
      setErrorMessage('Grand Prix invalide. Verifie la configuration des courses.');
      return;
    }

    const firstCourse = selectedGrandPrix.courses[0];
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

    setIsCheckingAssets(true);
    setErrorMessage(null);

    try {
      const p1Character = getCatalogItemById(CHARACTERS, p1Loadout.characterId);
      const p1Vehicle = getCatalogItemById(VEHICLES, p1Loadout.vehicleId);
      const p1Wheel = getCatalogItemById(WHEELS, p1Loadout.wheelId);

      const requiredAssetUrls = [
        ...getCircuitAssetUrls(selectedCircuit),
        p1Character.model,
        p1Vehicle.model,
        p1Wheel.model,
      ];

      let p2Character = p1Character;
      let p2Vehicle = p1Vehicle;
      let p2Wheel = p1Wheel;
      if (mode === 'multi' && p2Loadout) {
        p2Character = getCatalogItemById(CHARACTERS, p2Loadout.characterId);
        p2Vehicle = getCatalogItemById(VEHICLES, p2Loadout.vehicleId);
        p2Wheel = getCatalogItemById(WHEELS, p2Loadout.wheelId);
        requiredAssetUrls.push(p2Character.model, p2Vehicle.model, p2Wheel.model);
      }

      const missingAssets = await getMissingAssetUrls(requiredAssetUrls);
      if (missingAssets.length > 0) {
        setErrorMessage(`Assets manquants: ${missingAssets.join(', ')}`);
        return;
      }

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
          spawnRotation: mode === 'multi' ? circuitConfig.spawnRotations.p1 : circuitConfig.spawnRotations.solo,
          keyBindings: PLAYER_KEY_BINDINGS.p1,
        },
      ];

      if (mode === 'multi' && p2Loadout) {
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

      setRaceConfig({
        mode,
        cc,
        circuit: selectedCircuit,
        players,
      });
      setScreen('race');
      gameMode.current = 'run';
    } finally {
      setIsCheckingAssets(false);
    }
  };

  const menuScreen: Exclude<GameScreen, 'race'> = screen === 'race' ? 'home' : screen;

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {screen === 'race' && raceConfig ? (
        <Scene raceConfig={raceConfig} onRaceBack={resetToHome} />
      ) : (
        <GameMenu
          screen={menuScreen}
          mode={mode}
          cc={cc}
          p1Loadout={p1Loadout}
          p2Loadout={p2Loadout}
          activeLoadout={activeLoadout}
          activeCharacterPlayer={activeCharacterPlayer}
          selectedGrandPrixId={selectedGrandPrixId}
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
