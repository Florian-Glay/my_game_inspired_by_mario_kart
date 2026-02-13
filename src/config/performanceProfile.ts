export type RacePerformanceProfile = {
  dpr: [number, number];
  cameraNear: number;
  cameraFar: number;
  clipPlaneOffset: number;
  enableCameraClipPlane: boolean;
  cullFrameStride: number;
  forceFrontSideOpaque: boolean;
  disableShadowsOnStatic: boolean;
  debugGroundContact: boolean;
};

export const PERF_PROFILE: RacePerformanceProfile = {
  dpr: [0.5, 0.9],
  cameraNear: 0.1,
  cameraFar: 2000,
  clipPlaneOffset: 0.25,
  enableCameraClipPlane: false,
  cullFrameStride: 2,
  forceFrontSideOpaque: true,
  disableShadowsOnStatic: true,
  debugGroundContact: false,
};
