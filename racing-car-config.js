const defaultCarModelUrl = new URL(
  "./assets/cars/lamborghini_aventador_lp720-4_50th_anniversary/lamborghini_aventador_lp720-4_50th_anniversary.glb",
  import.meta.url
).href;

export const racingCarConfig = {
  // Replace this with your own high-detail GLB/GLTF once it lives in the repo.
  modelUrl: defaultCarModelUrl,
  targetLength: 4.78,
  visualScale: 2,
  collisionScale: 2,
  trackWidthOverride: 24,
  cameraFov: 54,
  cameraFollowDistance: 10.6,
  cameraHeight: 5.7,
  cameraLookAhead: 4.8,
  cameraTargetHeight: 1.45,
  cameraFollowTightness: 4.8,
  modelRotationDegrees: 0,
  groundOffset: 0.02,
  allowTint: false,
  toneMappingExposure: 0.78,
  backgroundColor: 0x8eb7df,
  fogColor: 0x8eb7df,
  hemisphereIntensity: 0.65,
  sunIntensity: 1.55,
  bodyNamePatterns: ["body", "paint", "carpaint", "bodywork", "coachwork", "chassis"],
  glassNamePatterns: ["glass", "window", "windscreen", "windshield"],
  bodyEnvMapIntensity: 0.5,
  detailEnvMapIntensity: 0.52,
  glassEnvMapIntensity: 0.6,
  bodyRoughnessFloor: 0.76,
  bodyMetalnessCeiling: 0.08,
  glassRoughnessFloor: 0.24,
  glassMetalnessCeiling: 0.04
};
