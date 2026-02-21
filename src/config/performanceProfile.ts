export type RacePerformanceProfile = {
  dpr: [number, number];
  cameraNear: number;
  cameraFar: number;
  clipPlaneOffset: number;
  enableCameraClipPlane: boolean;
  cullFrameStride: number;
  cullBatchDivisor: number;
  simulateBots: boolean;
  maxRaceParticipants: number;
  forceFrontSideOpaque: boolean;
  disableShadowsOnStatic: boolean;
  debugGroundContact: boolean;
};

export const PERF_PROFILE: RacePerformanceProfile = {
  dpr: [1, 1.25],
  cameraNear: 0.1,
  cameraFar: 2000,
  clipPlaneOffset: 0.25,
  enableCameraClipPlane: false,
  cullFrameStride: 2,
  cullBatchDivisor: 4,
  simulateBots: true,
  maxRaceParticipants: 12,
  forceFrontSideOpaque: true,
  disableShadowsOnStatic: true,
  debugGroundContact: false,
};
