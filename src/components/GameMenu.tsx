import { useEffect, useRef, useState } from 'react';
import {
  CHARACTERS,
  VEHICLES,
  WHEELS,
  getCatalogItemById,
} from '../config/garageCatalog';
import {
  CC_ORDER,
  GRAND_PRIX_ORDER,
  GRAND_PRIXS,
  HERO_IMAGE_PATH,
  MAX_LOCAL_HUMANS,
} from '../config/raceCatalog';
import {
  MULTIPLAYER_MAX_PLAYERS,
  type MultiplayerLobbyState,
} from '../../shared/multiplayerProtocol';
import type {
  CcLevel,
  GameScreen,
  GrandPrixId,
  HumanPlayerSlotId,
  PlayerLoadoutSelection,
  RaceMode,
} from '../types/game';
import {
  GAMEPAD_AXIS_LEFT_X,
  GAMEPAD_AXIS_LEFT_Y,
  GAMEPAD_BUTTON_A,
  GAMEPAD_BUTTON_B,
  getConnectedGamepads,
  isGamepadButtonPressed,
  readGamepadAxis,
} from '../utils/gamepad';
import {
  getGrandPrixTrophyAssetPath,
  type GrandPrixTrophyProgress,
} from '../state/grandPrixTrophies';
import { GaragePreview } from './GaragePreview';
import { MenuParticleField } from './MenuParticleField';

type MenuScreen = Exclude<GameScreen, 'race'>;
type MenuMotionState = 'home' | 'home-exit' | 'submenu' | 'submenu-exit';
type ExitMotionState = Extract<MenuMotionState, 'home-exit' | 'submenu-exit'>;
type StableMotionState = Extract<MenuMotionState, 'home' | 'submenu'>;

const HOME_PANEL_TRANSITION_MS = 420;
const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];
const ONLINE_NAME_MAX_LENGTH = 24;
const MENU_NAV_REPEAT_INITIAL_MS = 260;
const MENU_NAV_REPEAT_MS = 150;

type MenuNavDirection = 'up' | 'down' | 'left' | 'right';

const VIRTUAL_KEYBOARD_ROWS = [
  ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
  ['W', 'X', 'C', 'V', 'B', 'N'],
] as const;

type GameMenuProps = {
  screen: MenuScreen;
  mode: RaceMode | null;
  cc: CcLevel | null;
  humanCount: number | null;
  humanLoadoutsBySlot: Partial<Record<HumanPlayerSlotId, PlayerLoadoutSelection>>;
  activeLoadout: PlayerLoadoutSelection | null;
  activeHumanSlot: HumanPlayerSlotId;
  selectedGrandPrixId: GrandPrixId | null;
  grandPrixTrophyProgress: GrandPrixTrophyProgress;
  onlinePlayerNameInput: string;
  onlinePlayerName: string | null;
  selectedOnlineLobbyId: string | null;
  onlineLobbyCodeInput: string;
  waitingOnlineLobbies: MultiplayerLobbyState[];
  selectedOnlineLobby: MultiplayerLobbyState | null;
  currentOnlineLobby: MultiplayerLobbyState | null;
  isCurrentOnlineLobbyHost: boolean;
  errorMessage: string | null;
  isCheckingAssets: boolean;
  onBack: () => void;
  onSelectMode: (mode: RaceMode) => void;
  onOpenConfig: () => void;
  onSelectCc: (cc: CcLevel) => void;
  onSelectHumanCount: (count: number) => void;
  onCycleCharacter: (direction: -1 | 1) => void;
  onCycleVehicle: (direction: -1 | 1) => void;
  onCycleWheel: (direction: -1 | 1) => void;
  onConfirmLoadout: () => void;
  onSelectGrandPrix: (grandPrixId: GrandPrixId) => void;
  onConfirmGrandPrix: () => void;
  onChangeOnlinePlayerNameInput: (value: string) => void;
  onConfirmOnlinePlayerName: () => void;
  onOpenOnlineLobbyBrowser: () => void;
  onCreateOnlineLobby: () => void;
  onChangeOnlineLobbyCodeInput: (value: string) => void;
  onSelectOnlineLobby: (lobbyId: string) => void;
  onJoinSelectedOnlineLobby: () => void;
  onJoinLobbyByCode: () => void;
  onLaunchOnlineGrandPrix: () => void;
  onLeaveOnlineLobby: () => void;
};

type GarageSectionCardProps = {
  title: string;
  subtitle?: string;
  imageSrc?: string;
  imageAlt: string;
  label?: string;
  previousItem?: GarageNeighborItem;
  nextItem?: GarageNeighborItem;
  emphasis?: 'normal' | 'large';
  onPrev: () => void;
  onNext: () => void;
};

type GarageNeighborItem = {
  label?: string;
  imageSrc?: string;
  imageAlt: string;
};

type SlideDirection = 'left' | 'right' | null;
const SECTION_SLIDE_MS = 260;

type CatalogPreviewItem = {
  id: string;
  label: string;
  thumbnail: string;
};

function getHumanLabel(slot: HumanPlayerSlotId) {
  return `Joueur ${HUMAN_SLOT_ORDER.indexOf(slot) + 1}`;
}

function getLobbyTitle(lobby: MultiplayerLobbyState | null) {
  if (!lobby) return 'Aucun lobby selectionne';
  return `Lobby ${lobby.code}`;
}

function getSelectedHumanSlots(humanCount: number | null) {
  if (!humanCount) return [];
  const clamped = Math.min(Math.max(humanCount, 1), MAX_LOCAL_HUMANS);
  return HUMAN_SLOT_ORDER.slice(0, clamped);
}

function getAdjacentCatalogItems<T extends CatalogPreviewItem>(
  items: readonly T[],
  selectedId: string | null | undefined,
) {
  if (items.length === 0) {
    return {
      previous: null,
      next: null,
    } as const;
  }

  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const previousIndex = (safeIndex - 1 + items.length) % items.length;
  const nextIndex = (safeIndex + 1) % items.length;

  return {
    previous: items[previousIndex] ?? null,
    next: items[nextIndex] ?? null,
  } as const;
}

function getSortedNavigableElements(root: HTMLElement | null) {
  if (!root) return [];

  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  ).filter((element) => {
    if (!element.isConnected) return false;
    if (element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (element.closest('[aria-hidden="true"]')) return false;
    return true;
  });

  return candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    if (Math.abs(leftRect.top - rightRect.top) > 8) {
      return leftRect.top - rightRect.top;
    }
    return leftRect.left - rightRect.left;
  });
}

function GarageSectionCard({
  title,
  subtitle,
  imageSrc,
  imageAlt,
  label,
  previousItem,
  nextItem,
  emphasis = 'normal',
  onPrev,
  onNext,
}: GarageSectionCardProps) {
  const [slideDirection, setSlideDirection] = useState<SlideDirection>(null);
  const [slideToken, setSlideToken] = useState(0);
  const slideTimerRef = useRef<number | null>(null);

  const clearSlideTimer = () => {
    if (slideTimerRef.current !== null) {
      window.clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
    }
  };

  useEffect(() => () => clearSlideTimer(), []);

  const runSlide = (direction: Exclude<SlideDirection, null>, action: () => void) => {
    clearSlideTimer();
    setSlideDirection(direction);
    setSlideToken((previous) => previous + 1);
    action();
    slideTimerRef.current = window.setTimeout(() => {
      slideTimerRef.current = null;
      setSlideDirection(null);
    }, SECTION_SLIDE_MS);
  };

  const trackClass =
    slideDirection === 'left' ? 'is-enter-from-left'
    : slideDirection === 'right' ? 'is-enter-from-right'
    : '';

  return (
    <div className={`mk-garage-section ${emphasis === 'large' ? 'mk-garage-section--vehicle' : ''}`}>
      <div className="mk-garage-section-head">
        <span className="mk-garage-section-title">{title}</span>
        {subtitle ? <span className="mk-garage-section-subtitle">{subtitle}</span> : null}
      </div>

      <button
        type="button"
        className="mk-garage-scroll-btn"
        onClick={() => runSlide('left', onPrev)}
        aria-label={`Precedent ${title}`}
      >
        ◀
      </button>

      <div className="mk-garage-item-card">
        <div
          key={`${slideToken}-${label ?? 'none'}-${imageSrc ?? 'empty'}`}
          className={`mk-garage-item-content ${trackClass}`}
        >
          <div className="mk-garage-side-preview">
            {previousItem?.imageSrc ? (
              <img
                src={previousItem.imageSrc}
                alt={previousItem.imageAlt}
                className="mk-garage-side-preview-image"
              />
            ) : (
              <div
                className="mk-garage-side-preview-image mk-garage-side-preview-image--fallback"
                aria-hidden
              />
            )}
          </div>

          <div className="mk-garage-item-track">
            {imageSrc ? (
              <img src={imageSrc} alt={imageAlt} className="mk-garage-item-image" />
            ) : (
              <div className="mk-garage-item-image mk-garage-item-image--fallback" aria-hidden />
            )}
            <span className="mk-garage-item-label">{label ?? 'Aucun element'}</span>
          </div>

          <div className="mk-garage-side-preview">
            {nextItem?.imageSrc ? (
              <img src={nextItem.imageSrc} alt={nextItem.imageAlt} className="mk-garage-side-preview-image" />
            ) : (
              <div
                className="mk-garage-side-preview-image mk-garage-side-preview-image--fallback"
                aria-hidden
              />
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="mk-garage-scroll-btn"
        onClick={() => runSlide('right', onNext)}
        aria-label={`Suivant ${title}`}
      >
        ▶
      </button>
    </div>
  );
}

function OnlineLobbyMemberList({ lobby }: { lobby: MultiplayerLobbyState | null }) {
  if (!lobby) {
    return <div className="mk-online-empty">Selectionne un lobby pour voir les joueurs.</div>;
  }

  return (
    <div className="mk-online-members">
      {lobby.players.map((player, index) => (
        <div key={`${lobby.id}-${player.sessionId}`} className="mk-online-member-row">
          <span className="mk-online-member-rank">#{index + 1}</span>
          <span className="mk-online-member-name">{player.displayName}</span>
          <span className="mk-online-member-meta">
            {player.sessionId === lobby.hostSessionId ? 'Host' : 'Pilote'}
            {player.connected ? '' : ' hors ligne'}
          </span>
        </div>
      ))}
    </div>
  );
}

export function GameMenu({
  screen,
  mode,
  cc,
  humanCount,
  humanLoadoutsBySlot,
  activeLoadout,
  activeHumanSlot,
  selectedGrandPrixId,
  grandPrixTrophyProgress,
  onlinePlayerNameInput,
  onlinePlayerName,
  selectedOnlineLobbyId,
  onlineLobbyCodeInput,
  waitingOnlineLobbies,
  selectedOnlineLobby,
  currentOnlineLobby,
  isCurrentOnlineLobbyHost,
  errorMessage,
  isCheckingAssets,
  onBack,
  onSelectMode,
  onOpenConfig,
  onSelectCc,
  onSelectHumanCount,
  onCycleCharacter,
  onCycleVehicle,
  onCycleWheel,
  onConfirmLoadout,
  onSelectGrandPrix,
  onConfirmGrandPrix,
  onChangeOnlinePlayerNameInput,
  onConfirmOnlinePlayerName,
  onOpenOnlineLobbyBrowser,
  onCreateOnlineLobby,
  onChangeOnlineLobbyCodeInput,
  onSelectOnlineLobby,
  onJoinSelectedOnlineLobby,
  onJoinLobbyByCode,
  onLaunchOnlineGrandPrix,
  onLeaveOnlineLobby,
}: GameMenuProps) {
  const [heroFailed, setHeroFailed] = useState(false);
  const [onlineCountdownNow, setOnlineCountdownNow] = useState(() => Date.now());
  const [isVirtualKeyboardOpen, setIsVirtualKeyboardOpen] = useState(false);
  const [connectedGamepadCount, setConnectedGamepadCount] = useState(0);
  const [motionState, setMotionState] = useState<MenuMotionState>(() =>
    screen === 'home' ? 'home' : 'submenu',
  );
  const transitionTimerRef = useRef<number | null>(null);
  const transitionSourceScreenRef = useRef<MenuScreen>(screen);
  const menuInteractiveRootRef = useRef<HTMLDivElement | null>(null);
  const navElementsRef = useRef<HTMLElement[]>([]);
  const selectedNavIndexRef = useRef(0);
  const selectedNavElementRef = useRef<HTMLElement | null>(null);
  const navigationDirectionRef = useRef<MenuNavDirection | null>(null);
  const lastDirectionMoveAtRef = useRef(0);
  const lastDirectionBeganAtRef = useRef(0);
  const wasAButtonPressedRef = useRef(false);
  const wasBButtonPressedRef = useRef(false);
  const backActionRef = useRef<() => void>(() => undefined);
  const activateSelectedActionRef = useRef<() => void>(() => undefined);
  const displayedScreenRef = useRef<MenuScreen>(screen);
  const isVirtualKeyboardOpenRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const currentPlayerLabel = getHumanLabel(activeHumanSlot);
  const selectedHumanSlots = getSelectedHumanSlots(humanCount);
  const isTransitioning = motionState === 'home-exit' || motionState === 'submenu-exit';
  const displayedScreen = isTransitioning ? transitionSourceScreenRef.current : screen;
  const showBack = displayedScreen !== 'home';
  const connectedGamepadPlayers = Math.min(connectedGamepadCount, MAX_LOCAL_HUMANS);

  const selectedCharacter = activeLoadout
    ? getCatalogItemById(CHARACTERS, activeLoadout.characterId)
    : null;
  const selectedVehicle = activeLoadout
    ? getCatalogItemById(VEHICLES, activeLoadout.vehicleId)
    : null;
  const selectedWheel = activeLoadout ? getCatalogItemById(WHEELS, activeLoadout.wheelId) : null;
  const adjacentCharacterItems = getAdjacentCatalogItems(CHARACTERS, activeLoadout?.characterId);
  const adjacentVehicleItems = getAdjacentCatalogItems(VEHICLES, activeLoadout?.vehicleId);
  const adjacentWheelItems = getAdjacentCatalogItems(WHEELS, activeLoadout?.wheelId);
  const selectedGrandPrix = selectedGrandPrixId ? GRAND_PRIXS[selectedGrandPrixId] : null;
  const selectedGrandPrixCourses = selectedGrandPrix?.courses ?? [];
  const displayedGrandPrixCourses =
    selectedGrandPrixCourses.length === 4 ?
      selectedGrandPrixCourses
    : Array.from({ length: 4 }, (_, index) => ({
        id: `fallback-course-${index + 1}`,
        origin: 'N/A',
        label: `Course ${index + 1}`,
        previewImage: HERO_IMAGE_PATH,
        circuitId: 'ds_mario_circuit' as const,
      }));
  const onlineCountdownSeconds =
    currentOnlineLobby?.autoStartAt ?
      Math.max(0, Math.ceil((currentOnlineLobby.autoStartAt - onlineCountdownNow) / 1000))
    : 0;

  const clearTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  useEffect(() => () => clearTransitionTimer(), []);
  useEffect(() => {
    if (!currentOnlineLobby?.autoStartAt) return;
    setOnlineCountdownNow(Date.now());
    const countdownTimer = window.setInterval(() => {
      setOnlineCountdownNow(Date.now());
    }, 250);
    return () => window.clearInterval(countdownTimer);
  }, [currentOnlineLobby?.autoStartAt]);
  useEffect(() => {
    if (!isTransitioning) {
      transitionSourceScreenRef.current = screen;
    }
  }, [isTransitioning, screen]);

  useEffect(() => {
    if (screen === 'home') {
      setMotionState((previousState) =>
        previousState === 'submenu-exit' ? previousState : 'home',
      );
      return;
    }
    setMotionState((previousState) => (previousState === 'home-exit' ? previousState : 'submenu'));
  }, [screen]);

  useEffect(() => {
    const updateGamepadCount = () => {
      setConnectedGamepadCount(getConnectedGamepads().length);
    };

    updateGamepadCount();
    const timer = window.setInterval(updateGamepadCount, 350);
    window.addEventListener('gamepadconnected', updateGamepadCount);
    window.addEventListener('gamepaddisconnected', updateGamepadCount);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('gamepadconnected', updateGamepadCount);
      window.removeEventListener('gamepaddisconnected', updateGamepadCount);
    };
  }, []);

  useEffect(() => {
    if (displayedScreen !== 'online-name' && isVirtualKeyboardOpen) {
      setIsVirtualKeyboardOpen(false);
    }
  }, [displayedScreen, isVirtualKeyboardOpen]);

  const setSelectedNavigation = (elements: HTMLElement[], nextIndex: number) => {
    const shouldHighlight = connectedGamepadPlayers > 0;
    if (elements.length === 0) {
      selectedNavIndexRef.current = 0;
      selectedNavElementRef.current = null;
      return;
    }

    const normalizedIndex = ((nextIndex % elements.length) + elements.length) % elements.length;
    selectedNavIndexRef.current = normalizedIndex;
    selectedNavElementRef.current = elements[normalizedIndex] ?? null;

    elements.forEach((element, elementIndex) => {
      element.classList.toggle(
        'is-gamepad-selected',
        shouldHighlight && elementIndex === normalizedIndex,
      );
    });
  };

  const syncNavigation = (resetToTop: boolean) => {
    const elements = getSortedNavigableElements(menuInteractiveRootRef.current);
    navElementsRef.current = elements;
    if (elements.length === 0) {
      selectedNavElementRef.current = null;
      selectedNavIndexRef.current = 0;
      return;
    }

    if (resetToTop) {
      setSelectedNavigation(elements, 0);
      return;
    }

    const selectedElement = selectedNavElementRef.current;
    const selectedIndex =
      selectedElement ? elements.indexOf(selectedElement) : -1;
    if (selectedIndex >= 0) {
      setSelectedNavigation(elements, selectedIndex);
      return;
    }

    const fallbackIndex = Math.min(
      Math.max(selectedNavIndexRef.current, 0),
      elements.length - 1,
    );
    setSelectedNavigation(elements, fallbackIndex);
  };

  const moveNavigation = (direction: MenuNavDirection) => {
    if (isTransitioningRef.current) return;
    syncNavigation(false);
    const elements = navElementsRef.current;
    if (elements.length <= 1) return;

    const offset = direction === 'up' || direction === 'left' ? -1 : 1;
    const nextIndex = selectedNavIndexRef.current + offset;
    setSelectedNavigation(elements, nextIndex);
    selectedNavElementRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  };

  const runScreenTransition = (
    exitState: ExitMotionState,
    stableState: StableMotionState,
    action: () => void,
  ) => {
    if (isTransitioning) return;

    clearTransitionTimer();
    transitionSourceScreenRef.current = screen;
    setMotionState(exitState);
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      action();
      setMotionState(stableState);
    }, HOME_PANEL_TRANSITION_MS);
  };

  const runForwardTransition = (action: () => void) => {
    if (screen === 'home') {
      runScreenTransition('home-exit', 'submenu', action);
      return;
    }
    runScreenTransition('submenu-exit', 'submenu', action);
  };
  const runBackwardTransitionToHome = (action: () => void) =>
    runScreenTransition('submenu-exit', 'home', action);
  const runBackwardTransitionToSubmenu = (action: () => void) =>
    runScreenTransition('submenu-exit', 'submenu', action);

  const canAdvanceToCircuit =
    selectedHumanSlots.length > 0 &&
    selectedHumanSlots[selectedHumanSlots.length - 1] === activeHumanSlot &&
    selectedHumanSlots.every((slot) => Boolean(humanLoadoutsBySlot[slot]));

  const handleConfirmLoadoutClick = () => {
    if (canAdvanceToCircuit) {
      runForwardTransition(onConfirmLoadout);
      return;
    }
    onConfirmLoadout();
  };

  const handleBackClick = () => {
    if (isTransitioning) return;

    if (displayedScreen === 'online-name' && isVirtualKeyboardOpen) {
      setIsVirtualKeyboardOpen(false);
      return;
    }

    if (screen === 'characters' && activeHumanSlot !== 'p1') {
      onBack();
      return;
    }

    if (screen === 'config' || screen === 'cc') {
      runBackwardTransitionToHome(onBack);
      return;
    }

    if (
      screen === 'playercount' ||
      screen === 'characters' ||
      screen === 'circuit' ||
      screen === 'online-name' ||
      screen === 'online-lobby-menu' ||
      screen === 'online-lobby-browser' ||
      screen === 'online-lobby'
    ) {
      runBackwardTransitionToSubmenu(onBack);
      return;
    }

    onBack();
  };

  const handleVirtualKeyboardInsert = (value: string) => {
    const normalizedValue = value.toUpperCase();
    const nextValue = `${onlinePlayerNameInput}${normalizedValue}`.slice(0, ONLINE_NAME_MAX_LENGTH);
    onChangeOnlinePlayerNameInput(nextValue);
  };

  const handleVirtualKeyboardBackspace = () => {
    if (onlinePlayerNameInput.length === 0) return;
    onChangeOnlinePlayerNameInput(onlinePlayerNameInput.slice(0, -1));
  };

  const handleVirtualKeyboardClear = () => {
    onChangeOnlinePlayerNameInput('');
  };

  const handleVirtualKeyboardValidate = () => {
    runForwardTransition(onConfirmOnlinePlayerName);
    setIsVirtualKeyboardOpen(false);
  };

  const activateSelectedElement = () => {
    if (isTransitioningRef.current) return;

    if (displayedScreenRef.current === 'online-name' && !isVirtualKeyboardOpenRef.current) {
      setIsVirtualKeyboardOpen(true);
      return;
    }

    syncNavigation(false);
    const selectedElement = selectedNavElementRef.current;
    if (!selectedElement) return;

    if (selectedElement instanceof HTMLInputElement) {
      selectedElement.focus();
      return;
    }

    selectedElement.click();
  };

  backActionRef.current = handleBackClick;
  activateSelectedActionRef.current = activateSelectedElement;

  useEffect(() => {
    displayedScreenRef.current = displayedScreen;
    isVirtualKeyboardOpenRef.current = isVirtualKeyboardOpen;
    isTransitioningRef.current = isTransitioning;
  }, [displayedScreen, isTransitioning, isVirtualKeyboardOpen]);

  const navigationResetContextRef = useRef('');
  useEffect(() => {
    const resetContext = `${displayedScreen}:${isVirtualKeyboardOpen ? 'vk-open' : 'vk-closed'}`;
    const shouldReset = navigationResetContextRef.current !== resetContext;
    navigationResetContextRef.current = resetContext;

    const animationFrame = window.requestAnimationFrame(() => {
      syncNavigation(shouldReset);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    activeHumanSlot,
    connectedGamepadPlayers,
    displayedScreen,
    errorMessage,
    humanCount,
    isTransitioning,
    isVirtualKeyboardOpen,
    onlineLobbyCodeInput,
    onlinePlayerNameInput,
    selectedGrandPrixId,
    selectedOnlineLobbyId,
    waitingOnlineLobbies,
  ]);

  useEffect(() => {
    let animationFrame = 0;

    const tick = () => {
      const gamepad = getConnectedGamepads()[0] ?? null;

      if (!gamepad) {
        navigationDirectionRef.current = null;
        lastDirectionMoveAtRef.current = 0;
        lastDirectionBeganAtRef.current = 0;
        wasAButtonPressedRef.current = false;
        wasBButtonPressedRef.current = false;
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      const nowMs = performance.now();
      const axisX = readGamepadAxis(gamepad, GAMEPAD_AXIS_LEFT_X, 0.55);
      const axisY = readGamepadAxis(gamepad, GAMEPAD_AXIS_LEFT_Y, 0.55);
      let direction: MenuNavDirection | null = null;

      if (Math.abs(axisY) >= Math.abs(axisX) && axisY !== 0) {
        direction = axisY < 0 ? 'up' : 'down';
      } else if (axisX !== 0) {
        direction = axisX < 0 ? 'left' : 'right';
      }

      if (direction) {
        if (navigationDirectionRef.current !== direction) {
          navigationDirectionRef.current = direction;
          lastDirectionBeganAtRef.current = nowMs;
          lastDirectionMoveAtRef.current = nowMs;
          moveNavigation(direction);
        } else {
          const repeatDelayMs =
            nowMs - lastDirectionBeganAtRef.current < MENU_NAV_REPEAT_INITIAL_MS ?
              MENU_NAV_REPEAT_INITIAL_MS
            : MENU_NAV_REPEAT_MS;
          if (nowMs - lastDirectionMoveAtRef.current >= repeatDelayMs) {
            lastDirectionMoveAtRef.current = nowMs;
            moveNavigation(direction);
          }
        }
      } else {
        navigationDirectionRef.current = null;
        lastDirectionMoveAtRef.current = 0;
        lastDirectionBeganAtRef.current = 0;
      }

      const aPressed = isGamepadButtonPressed(gamepad.buttons[GAMEPAD_BUTTON_A]);
      const bPressed = isGamepadButtonPressed(gamepad.buttons[GAMEPAD_BUTTON_B]);

      if (aPressed && !wasAButtonPressedRef.current) {
        activateSelectedActionRef.current();
      }

      if (bPressed && !wasBButtonPressedRef.current) {
        if (displayedScreenRef.current === 'online-name' && isVirtualKeyboardOpenRef.current) {
          setIsVirtualKeyboardOpen(false);
        } else {
          backActionRef.current();
        }
      }

      wasAButtonPressedRef.current = aPressed;
      wasBButtonPressedRef.current = bPressed;
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="mk-menu-screen" ref={menuInteractiveRootRef}>
      <div className="mk-menu-background" />
      <MenuParticleField />
      <div
        className={`mk-menu-overlay mk-menu-overlay--${motionState} ${displayedScreen === 'characters' ? 'mk-menu-overlay--garage' : ''} ${
          isTransitioning ? 'is-transitioning' : ''
        }`}
      >
        {showBack ? (
          <button
            type="button"
            className="mk-back-btn"
            onClick={handleBackClick}
            disabled={isTransitioning}
          >
            Retour
          </button>
        ) : null}

        <section className="mk-menu-panel">
          {displayedScreen === 'home' && (
            <div className="mk-menu-list mk-menu-list--animated">
              <button
                type="button"
                className="mk-main-btn"
                onClick={() => runForwardTransition(() => onSelectMode('solo'))}
              >
                <span className="mk-main-btn-icon">
                  <img src="ui/solo.png" alt="solo" />
                </span>
                <span className="mk-main-btn-label">SOLO</span>
              </button>
              <button
                type="button"
                className="mk-main-btn"
                onClick={() => runForwardTransition(() => onSelectMode('multi'))}
              >
                <span className="mk-main-btn-icon">
                  <img src="ui/multi.png" alt="multi" />
                </span>
                <span className="mk-main-btn-label">MULTIPLAYER</span>
              </button>
              <button
                type="button"
                className="mk-main-btn"
                onClick={() => runForwardTransition(() => onSelectMode('online'))}
              >
                <span className="mk-main-btn-icon">
                  <img src="ui/multi.png" alt="online" />
                </span>
                <span className="mk-main-btn-label">MULTIPLAYER ONLINE</span>
              </button>
              <button
                type="button"
                className="mk-main-btn"
                onClick={() => runForwardTransition(onOpenConfig)}
              >
                <span className="mk-main-btn-icon">
                  <img src="ui/vollant.png" alt="volant" />
                </span>
                <span className="mk-main-btn-label">CONFIG MANETTE</span>
              </button>
            </div>
          )}

          {displayedScreen === 'config' && (
            <div className="mk-card mk-config-panel">
              <h2>Configuration manette</h2>
              <p>Resume des commandes clavier et manette detectee.</p>

              <div className="mk-config-box">
                <h3>Commandes clavier (4 joueurs)</h3>
                <div className="mk-mapping-grid">
                  <div>
                    <strong>Joueur 1:</strong> ZQSD (+ W/A), objet: E
                  </div>
                  <div>
                    <strong>Joueur 2:</strong> Fleches directionnelles, objet: Shift
                  </div>
                  <div>
                    <strong>Joueur 3:</strong> IJKL, objet: O
                  </div>
                  <div>
                    <strong>Joueur 4:</strong> Numpad 8/4/5/6, objet: Numpad 7
                  </div>
                </div>
              </div>

              <div className="mk-config-box">
                <h3>Commandes manette (1 joueur)</h3>
                <div className="mk-mapping-grid">
                  <div>
                    <strong>Menu:</strong> Joystick gauche pour choisir, A pour valider, B pour retour
                  </div>
                  <div>
                    <strong>Course:</strong> Joystick gauche pour orienter
                  </div>
                  <div>
                    <strong>Course:</strong> A avance, B recule
                  </div>
                  <div>
                    <strong>Course:</strong> Gachette droite derapage, gachette gauche objet
                  </div>
                </div>
              </div>

              <div className="mk-config-box">
                <h3>Joueurs manette detectes</h3>
                <p className="mk-config-count">
                  {connectedGamepadPlayers} joueur{connectedGamepadPlayers > 1 ? 's' : ''} manette
                </p>
                <div className="mk-config-wheel-row">
                  {connectedGamepadPlayers > 0 ?
                    Array.from({ length: connectedGamepadPlayers }, (_, index) => (
                      <div key={`wheel-player-${index + 1}`} className="mk-config-wheel-card">
                        <img src="ui/vollant.png" alt={`volant joueur ${index + 1}`} />
                        <span>Joueur {index + 1}</span>
                      </div>
                    ))
                  : <div className="mk-online-empty">Aucune manette connectee.</div>}
                </div>
              </div>
            </div>
          )}

          {displayedScreen === 'cc' && (
            <div className="mk-menu-list mk-menu-list--animated">
              {CC_ORDER.map((ccValue) => (
                <button
                  key={ccValue}
                  type="button"
                  className={`mk-main-btn ${cc === ccValue ? 'is-active' : ''}`}
                  onClick={() => runForwardTransition(() => onSelectCc(ccValue))}
                >
                  <span className="mk-main-btn-icon">
                    <img src={`ui/${ccValue}.png`} alt={ccValue} />
                  </span>
                  <span className="mk-main-btn-label">{ccValue}</span>
                </button>
              ))}
            </div>
          )}

          {displayedScreen === 'playercount' && (
            <div className="mk-menu-list mk-menu-list--animated">
              {[2, 3, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`mk-main-btn ${humanCount === count ? 'is-active' : ''}`}
                  onClick={() => runForwardTransition(() => onSelectHumanCount(count))}
                >
                  <span className="mk-main-btn-icon">
                    <img src="ui/multi.png" alt={`${count} joueurs`} />
                  </span>
                  <span className="mk-main-btn-label">{count} JOUEURS</span>
                </button>
              ))}
            </div>
          )}

          {displayedScreen === 'characters' && (
            <div className="mk-garage-layout mk-card--animated">
              <div className="mk-garage-selector mk-card">
                <h2>
                  {mode === 'solo' ? 'Joueur 1 - Selection'
                  : mode === 'online' ? 'Mode Online - Selection'
                  : `${currentPlayerLabel} - Selection`}
                </h2>
                <p>
                  {mode === 'online' ?
                    'Choisis ton personnage, ton vehicule et tes roues. Le host choisira ensuite le Grand Prix avant le lancement.'
                  : 'Choisis un personnage, un vehicule et un type de roues.'}
                </p>

                <div className="mk-character-tags">
                  {selectedHumanSlots.map((slot) => (
                    <span key={slot} className={`mk-tag ${slot}`}>
                      {getHumanLabel(slot)} {humanLoadoutsBySlot[slot] ? 'pret' : 'en cours'}
                    </span>
                  ))}
                </div>

                <div className="mk-garage-sections">
                  <GarageSectionCard
                    title="Personnage"
                    imageSrc={selectedCharacter?.thumbnail}
                    imageAlt={selectedCharacter?.label ?? 'Personnage'}
                    label={selectedCharacter?.label}
                    previousItem={{
                      label: adjacentCharacterItems.previous?.label,
                      imageSrc: adjacentCharacterItems.previous?.thumbnail,
                      imageAlt: adjacentCharacterItems.previous?.label ?? 'Personnage precedent',
                    }}
                    nextItem={{
                      label: adjacentCharacterItems.next?.label,
                      imageSrc: adjacentCharacterItems.next?.thumbnail,
                      imageAlt: adjacentCharacterItems.next?.label ?? 'Personnage suivant',
                    }}
                    onPrev={() => onCycleCharacter(-1)}
                    onNext={() => onCycleCharacter(1)}
                  />

                  <GarageSectionCard
                    title="Vehicule"
                    emphasis="large"
                    imageSrc={selectedVehicle?.thumbnail}
                    imageAlt={selectedVehicle?.label ?? 'Vehicule'}
                    label={selectedVehicle?.label}
                    previousItem={{
                      label: adjacentVehicleItems.previous?.label,
                      imageSrc: adjacentVehicleItems.previous?.thumbnail,
                      imageAlt: adjacentVehicleItems.previous?.label ?? 'Vehicule precedent',
                    }}
                    nextItem={{
                      label: adjacentVehicleItems.next?.label,
                      imageSrc: adjacentVehicleItems.next?.thumbnail,
                      imageAlt: adjacentVehicleItems.next?.label ?? 'Vehicule suivant',
                    }}
                    onPrev={() => onCycleVehicle(-1)}
                    onNext={() => onCycleVehicle(1)}
                  />

                  <GarageSectionCard
                    title="Roues"
                    subtitle={selectedWheel ? `Taille: ${selectedWheel.size}` : undefined}
                    imageSrc={selectedWheel?.thumbnail}
                    imageAlt={selectedWheel?.label ?? 'Roues'}
                    label={selectedWheel?.label}
                    previousItem={{
                      label: adjacentWheelItems.previous?.label,
                      imageSrc: adjacentWheelItems.previous?.thumbnail,
                      imageAlt: adjacentWheelItems.previous?.label ?? 'Roues precedentes',
                    }}
                    nextItem={{
                      label: adjacentWheelItems.next?.label,
                      imageSrc: adjacentWheelItems.next?.thumbnail,
                      imageAlt: adjacentWheelItems.next?.label ?? 'Roues suivantes',
                    }}
                    onPrev={() => onCycleWheel(-1)}
                    onNext={() => onCycleWheel(1)}
                  />
                </div>

                <div className="mk-garage-footer">
                  <button
                    type="button"
                    className="mk-confirm-btn mk-garage-confirm-btn"
                    onClick={handleConfirmLoadoutClick}
                  >
                    Confirmer la selection
                  </button>

                  {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
                </div>
              </div>
            </div>
          )}

          {displayedScreen === 'online-name' && (
            <div className="mk-card mk-card--animated">
              <h2>Nom du joueur</h2>
              <p>Entre ton nom avant de creer ou rejoindre un lobby.</p>

              <form
                className="mk-online-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runForwardTransition(onConfirmOnlinePlayerName);
                }}
              >
                <input
                  type="text"
                  value={onlinePlayerNameInput}
                  onChange={(event) => onChangeOnlinePlayerNameInput(event.currentTarget.value)}
                  placeholder="Ton nom"
                  maxLength={ONLINE_NAME_MAX_LENGTH}
                  className="mk-online-input"
                />
                <button type="submit" className="mk-confirm-btn">
                  Confirmer le nom
                </button>
              </form>

              {!isVirtualKeyboardOpen ? (
                <button
                  type="button"
                  className="mk-confirm-btn mk-confirm-btn--ghost"
                  onClick={() => setIsVirtualKeyboardOpen(true)}
                >
                  Ouvrir le clavier virtuel
                </button>
              ) : (
                <div className="mk-virtual-keyboard">
                  <div className="mk-virtual-keyboard-title">Clavier virtuel</div>

                  <div className="mk-virtual-keyboard-grid">
                    {VIRTUAL_KEYBOARD_ROWS.flatMap((row) => row).map((keyValue) => (
                      <button
                        key={`virtual-key-${keyValue}`}
                        type="button"
                        className="mk-virtual-key"
                        onClick={() => handleVirtualKeyboardInsert(keyValue)}
                      >
                        {keyValue}
                      </button>
                    ))}
                  </div>

                  <div className="mk-virtual-keyboard-actions">
                    <button
                      type="button"
                      className="mk-virtual-key mk-virtual-key--wide"
                      onClick={() => handleVirtualKeyboardInsert(' ')}
                    >
                      Espace
                    </button>
                    <button
                      type="button"
                      className="mk-virtual-key mk-virtual-key--wide"
                      onClick={handleVirtualKeyboardBackspace}
                    >
                      Suppr
                    </button>
                    <button
                      type="button"
                      className="mk-virtual-key mk-virtual-key--wide"
                      onClick={handleVirtualKeyboardClear}
                    >
                      Effacer
                    </button>
                  </div>

                  <button
                    type="button"
                    className="mk-confirm-btn mk-virtual-keyboard-confirm"
                    onClick={handleVirtualKeyboardValidate}
                  >
                    Valider
                  </button>
                </div>
              )}

              {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
            </div>
          )}

          {displayedScreen === 'online-lobby-menu' && (
            <div className="mk-card mk-card--animated">
              <h2>Multiplayer Online</h2>
              <p>
                {onlinePlayerName ?
                  `${onlinePlayerName}, choisis si tu veux rejoindre un lobby ou en creer un nouveau.`
                : 'Choisis si tu veux rejoindre un lobby ou en creer un nouveau.'}
              </p>

              <div className="mk-menu-list mk-menu-list--animated mk-online-menu-actions">
                <button
                  type="button"
                  className="mk-main-btn"
                  onClick={() => runForwardTransition(onOpenOnlineLobbyBrowser)}
                >
                  <span className="mk-main-btn-icon">
                    <img src="ui/multi.png" alt="rejoindre" />
                  </span>
                  <span className="mk-main-btn-label">REJOINDRE UN LOBBY</span>
                </button>
                <button
                  type="button"
                  className="mk-main-btn"
                  onClick={() => runForwardTransition(onCreateOnlineLobby)}
                >
                  <span className="mk-main-btn-icon">
                    <img src="ui/150cc.png" alt="creer" />
                  </span>
                  <span className="mk-main-btn-label">CREER UN LOBBY</span>
                </button>
              </div>

              {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
            </div>
          )}

          {displayedScreen === 'online-lobby-browser' && (
            <div className="mk-card mk-card--animated mk-online-browser">
              <h2>Lobbies en attente</h2>
              <p>Selectionne un lobby pour voir les joueurs deja presents.</p>

              <div className="mk-online-browser-grid">
                <div className="mk-online-lobby-list">
                  {waitingOnlineLobbies.length > 0 ?
                    waitingOnlineLobbies.map((lobby) => (
                      <button
                        key={lobby.id}
                        type="button"
                        className={`mk-online-lobby-btn ${selectedOnlineLobbyId === lobby.id ? 'is-active' : ''}`}
                        onClick={() => onSelectOnlineLobby(lobby.id)}
                      >
                        <span className="mk-online-lobby-title">{getLobbyTitle(lobby)}</span>
                        <span className="mk-online-lobby-meta">
                          {lobby.code} · {lobby.players.length}/{MULTIPLAYER_MAX_PLAYERS} joueurs
                        </span>
                      </button>
                    ))
                  : <div className="mk-online-empty">Aucun lobby en attente pour le moment.</div>}
                </div>

                <div className="mk-online-lobby-panel">
                  <div className="mk-online-lobby-heading">
                    {getLobbyTitle(selectedOnlineLobby)}
                  </div>
                  <OnlineLobbyMemberList lobby={selectedOnlineLobby} />
                </div>
              </div>

              <form
                className="mk-online-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  runForwardTransition(onJoinLobbyByCode);
                }}
              >
                <input
                  type="text"
                  value={onlineLobbyCodeInput}
                  onChange={(event) => onChangeOnlineLobbyCodeInput(event.currentTarget.value.toUpperCase())}
                  placeholder="Code du lobby"
                  maxLength={6}
                  className="mk-online-input"
                />
                <button type="submit" className="mk-confirm-btn">
                  Rejoindre par code
                </button>
              </form>

              <button
                type="button"
                className="mk-confirm-btn"
                onClick={() => runForwardTransition(onJoinSelectedOnlineLobby)}
                disabled={!selectedOnlineLobby}
              >
                Rejoindre ce lobby
              </button>

              {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
            </div>
          )}

          {displayedScreen === 'online-lobby' && (
            <div className="mk-card mk-card--animated mk-online-lobby-card">
              <h2>{getLobbyTitle(currentOnlineLobby)}</h2>
              <p>Le host choisit la coupe, puis lance le Grand Prix en 150cc.</p>

              <div className="mk-online-summary-grid">
                <div className="mk-online-summary-pill">
                  Joueurs: {currentOnlineLobby?.players.length ?? 0}/{MULTIPLAYER_MAX_PLAYERS}
                </div>
                <div className="mk-online-summary-pill">Code: {currentOnlineLobby?.code ?? '------'}</div>
                <div className="mk-online-summary-pill">Grand Prix: selection host</div>
                <div className="mk-online-summary-pill">150cc</div>
              </div>

              {currentOnlineLobby?.status === 'countdown' ? (
                <div className="mk-online-countdown">
                  Lobby complet. Depart automatique dans {onlineCountdownSeconds}s.
                </div>
              ) : null}

              <OnlineLobbyMemberList lobby={currentOnlineLobby} />

              <div className="mk-online-actions">
                <button
                  type="button"
                  className="mk-confirm-btn"
                  onClick={onLaunchOnlineGrandPrix}
                  disabled={!isCurrentOnlineLobbyHost}
                >
                  {isCurrentOnlineLobbyHost ? 'Choisir et lancer le Grand Prix' : 'En attente du host'}
                </button>
                <button type="button" className="mk-confirm-btn mk-confirm-btn--ghost" onClick={onLeaveOnlineLobby}>
                  Quitter le lobby
                </button>
              </div>

              {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
            </div>
          )}

          {displayedScreen === 'circuit' && (
            <div className="mk-card mk-card--animated mk-grand-prix-card">
              <h2>{mode === 'online' ? 'Selection du Grand Prix Online' : 'Selection du Grand Prix'}</h2>
              <p>
                {mode === 'online' ?
                  isCurrentOnlineLobbyHost ?
                    'Choisis une coupe puis lance le Grand Prix pour tout le lobby.'
                  : 'Seul le host peut choisir la coupe. En attente de sa selection.'
                : 'Choisis une coupe puis confirme pour lancer la premiere course.'}
              </p>

              <div className="mk-gp-cups-section">
                <div className="mk-gp-cups-scroll">
                  <div className="mk-gp-cups-grid">
                    {GRAND_PRIX_ORDER.map((grandPrixId) => {
                      const cup = GRAND_PRIXS[grandPrixId];
                      if (!cup) return null;
                      const trophyRank = grandPrixTrophyProgress[grandPrixId] ?? null;
                      const trophyAssetPath =
                        trophyRank ?
                          getGrandPrixTrophyAssetPath({
                            cupId: grandPrixId,
                            rank: trophyRank,
                          })
                        : null;

                      return (
                        <button
                          key={grandPrixId}
                          type="button"
                          className={`mk-gp-cup-btn ${selectedGrandPrixId === grandPrixId ? 'is-active' : ''}`}
                          onClick={() => onSelectGrandPrix(grandPrixId)}
                          aria-pressed={selectedGrandPrixId === grandPrixId}
                          aria-label={cup.label}
                          disabled={mode === 'online' && !isCurrentOnlineLobbyHost}
                        >
                          {trophyAssetPath ? (
                            <img
                              src={trophyAssetPath}
                              alt={`Trophee ${trophyRank === 1 ? 'or' : trophyRank === 2 ? 'argent' : 'bronze'} ${cup.label}`}
                              className="mk-gp-cup-trophy-badge"
                            />
                          ) : null}
                          <img
                            src={cup.badgeImage}
                            alt={cup.badgeAlt}
                            className="mk-gp-cup-image"
                            onError={(event) => {
                              event.currentTarget.src = HERO_IMAGE_PATH;
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mk-gp-courses-section">
                <div className="mk-gp-courses-scroll">
                  <div className="mk-gp-courses-row" key={selectedGrandPrixId ?? 'no-grand-prix'}>
                    {displayedGrandPrixCourses.map((course) => (
                      <article key={course.id} className="mk-gp-course-card">
                        <img
                          src={course.previewImage}
                          alt={course.label}
                          className="mk-gp-course-image"
                          onError={(event) => {
                            event.currentTarget.src = HERO_IMAGE_PATH;
                          }}
                        />
                        <div className="mk-gp-course-meta">
                          <span className="mk-gp-course-origin">{course.origin}</span>
                          <span className="mk-gp-course-label">{course.label}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mk-gp-selected-name">
                {selectedGrandPrix ? selectedGrandPrix.label : 'Aucun Grand Prix'}
              </div>

              <button
                type="button"
                className="mk-confirm-btn mk-gp-confirm-btn"
                onClick={onConfirmGrandPrix}
                disabled={!selectedGrandPrixId || isCheckingAssets || (mode === 'online' && !isCurrentOnlineLobbyHost)}
              >
                {mode === 'online' ?
                  isCurrentOnlineLobbyHost ?
                    'Lancer le Grand Prix'
                  : 'En attente du host'
                : isCheckingAssets ?
                  'Verification des assets...'
                : 'Confirmer le Grand Prix'}
              </button>

              {errorMessage ? <div className="mk-error">{errorMessage}</div> : null}
            </div>
          )}
        </section>

        <aside className={`mk-hero-panel ${displayedScreen === 'characters' ? 'mk-hero-panel--garage' : ''}`}>
          {displayedScreen === 'characters' ? (
            <GaragePreview loadout={activeLoadout} />
          ) : heroFailed ? (
            <div className="mk-hero-fallback">
              <div className="mk-hero-fallback-label">Hero image manquante</div>
            </div>
          ) : (
            <img
              src={HERO_IMAGE_PATH}
              alt="Mario Kart Hero"
              className="mk-hero-image"
              onError={() => setHeroFailed(true)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
