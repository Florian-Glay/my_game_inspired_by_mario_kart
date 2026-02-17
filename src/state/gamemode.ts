export type GameMode = 'run' | 'free' | 'coor' | 'win';

// Mutable shared state for game mode
export const gameMode: { current: GameMode } = { current: 'run' };
