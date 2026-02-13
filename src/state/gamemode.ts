export type GameMode = 'run' | 'free' | 'coor';

// Mutable shared state for game mode
export const gameMode: { current: GameMode } = { current: 'run' };
