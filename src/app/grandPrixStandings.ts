import type { GrandPrixStanding, RaceConfig } from '../types/game';
import type { GrandPrixProgressState } from './appTypes';
import { getGrandPrixPointsForPosition } from './appHelpers';

type ComputeGrandPrixStandingsInput = {
  grandPrixProgress: GrandPrixProgressState | null;
  raceConfig: RaceConfig | null;
};

export function computeGrandPrixStandings({
  grandPrixProgress,
  raceConfig,
}: ComputeGrandPrixStandingsInput): GrandPrixStanding[] {
  if (!grandPrixProgress || !raceConfig) return [];

  const orderedResults = [...grandPrixProgress.courseResults].sort(
    (a, b) => a.courseIndex - b.courseIndex,
  );

  const standings = raceConfig.participants.map((participant) => {
    const courseScores = orderedResults.map((result) => {
      const participantEntry = result.ranking.find(
        (entry) => entry.participantId === participant.id,
      );
      const position = participantEntry?.position ?? raceConfig.participants.length;
      return getGrandPrixPointsForPosition(position);
    });
    const totalScore = courseScores.reduce<number>((sum, value) => sum + value, 0);
    return {
      participantId: participant.id,
      displayName: participant.displayName,
      totalScore,
      courseScores,
    };
  });

  standings.sort((left, right) => {
    if (left.totalScore !== right.totalScore) {
      return right.totalScore - left.totalScore;
    }
    const leftLast = left.courseScores[left.courseScores.length - 1] ?? Number.MIN_SAFE_INTEGER;
    const rightLast = right.courseScores[right.courseScores.length - 1] ?? Number.MIN_SAFE_INTEGER;
    if (leftLast !== rightLast) return rightLast - leftLast;
    return left.participantId.localeCompare(right.participantId);
  });

  return standings;
}
