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
import type {
  CcLevel,
  GameScreen,
  GrandPrixId,
  HumanPlayerSlotId,
  PlayerLoadoutSelection,
  RaceMode,
} from '../types/game';
import { GaragePreview } from './GaragePreview';
import { MenuParticleField } from './MenuParticleField';

type MenuScreen = Exclude<GameScreen, 'race'>;
type MenuMotionState = 'home' | 'home-exit' | 'submenu' | 'submenu-exit';
type ExitMotionState = Extract<MenuMotionState, 'home-exit' | 'submenu-exit'>;
type StableMotionState = Extract<MenuMotionState, 'home' | 'submenu'>;

const HOME_PANEL_TRANSITION_MS = 420;
const HUMAN_SLOT_ORDER: HumanPlayerSlotId[] = ['p1', 'p2', 'p3', 'p4'];

type GameMenuProps = {
  screen: MenuScreen;
  mode: RaceMode | null;
  cc: CcLevel | null;
  humanCount: number | null;
  humanLoadoutsBySlot: Partial<Record<HumanPlayerSlotId, PlayerLoadoutSelection>>;
  activeLoadout: PlayerLoadoutSelection | null;
  activeHumanSlot: HumanPlayerSlotId;
  selectedGrandPrixId: GrandPrixId | null;
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

export function GameMenu({
  screen,
  mode,
  cc,
  humanCount,
  humanLoadoutsBySlot,
  activeLoadout,
  activeHumanSlot,
  selectedGrandPrixId,
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
}: GameMenuProps) {
  const [heroFailed, setHeroFailed] = useState(false);
  const [motionState, setMotionState] = useState<MenuMotionState>(() =>
    screen === 'home' ? 'home' : 'submenu',
  );
  const transitionTimerRef = useRef<number | null>(null);
  const transitionSourceScreenRef = useRef<MenuScreen>(screen);
  const currentPlayerLabel = getHumanLabel(activeHumanSlot);
  const selectedHumanSlots = getSelectedHumanSlots(humanCount);
  const isTransitioning = motionState === 'home-exit' || motionState === 'submenu-exit';
  const displayedScreen = isTransitioning ? transitionSourceScreenRef.current : screen;
  const showBack = displayedScreen !== 'home';

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

  const clearTransitionTimer = () => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
  };

  useEffect(() => () => clearTransitionTimer(), []);
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

    if (screen === 'characters' && activeHumanSlot !== 'p1') {
      onBack();
      return;
    }

    if (screen === 'config' || screen === 'cc') {
      runBackwardTransitionToHome(onBack);
      return;
    }

    if (screen === 'playercount' || screen === 'characters' || screen === 'circuit') {
      runBackwardTransitionToSubmenu(onBack);
      return;
    }

    onBack();
  };

  return (
    <div className="mk-menu-screen">
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
            <div className="mk-card">
              <h2>Configuration manette</h2>
              <p>Mode configuration avancee bientot disponible.</p>
              <div className="mk-mapping-grid">
                <div>
                  <strong>P1 clavier:</strong> ZQSD (+ W/A toleres)
                </div>
                <div>
                  <strong>P2 clavier:</strong> Fleches directionnelles
                </div>
                <div>
                  <strong>P3 clavier:</strong> IJKL
                </div>
                <div>
                  <strong>P4 clavier:</strong> Numpad 8/4/5/6
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
                <h2>{mode === 'solo' ? 'Joueur 1 - Selection' : `${currentPlayerLabel} - Selection`}</h2>
                <p>Choisis un personnage, un vehicule et un type de roues.</p>

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

          {displayedScreen === 'circuit' && (
            <div className="mk-card mk-card--animated mk-grand-prix-card">
              <h2>Selection du Grand Prix</h2>
              <p>Choisis une coupe puis confirme pour lancer la premiere course.</p>

              <div className="mk-gp-cups-section">
                <div className="mk-gp-cups-scroll">
                  <div className="mk-gp-cups-grid">
                    {GRAND_PRIX_ORDER.map((grandPrixId) => {
                      const cup = GRAND_PRIXS[grandPrixId];
                      if (!cup) return null;

                      return (
                        <button
                          key={grandPrixId}
                          type="button"
                          className={`mk-gp-cup-btn ${selectedGrandPrixId === grandPrixId ? 'is-active' : ''}`}
                          onClick={() => onSelectGrandPrix(grandPrixId)}
                          aria-pressed={selectedGrandPrixId === grandPrixId}
                          aria-label={cup.label}
                          title={cup.label}
                        >
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
                disabled={!selectedGrandPrixId || isCheckingAssets}
              >
                {isCheckingAssets ? 'Verification des assets...' : 'Confirmer le Grand Prix'}
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
