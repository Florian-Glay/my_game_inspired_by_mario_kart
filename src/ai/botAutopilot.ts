import type { CarPose } from '../types/game';

export type BotAutopilotInput = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
};

type ComputeBotAutopilotInputArgs = {
  participantId: string;
  pose: CarPose | null;
};

// Stub intentionally kept minimal: bots stay immobile until custom AI is implemented.
export function computeBotAutopilotInput(
  _args: ComputeBotAutopilotInputArgs,
): BotAutopilotInput {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
  };
}
