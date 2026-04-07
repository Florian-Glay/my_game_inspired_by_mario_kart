import type { CourseRaceResult, GrandPrixId } from '../types/game';

export type GrandPrixProgressState = {
  grandPrixId: GrandPrixId;
  currentCourseIndex: number;
  courseResults: CourseRaceResult[];
};
