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
  sunShadowBias: 0,
  sunShadowNormalBias: 0.03,
  bodyNamePatterns: ["body", "paint", "carpaint", "bodywork", "coachwork", "chassis"],
  bodySmoothingNamePatterns: ["body", "paint", "carpaint", "bodywork", "coachwork"],
  glassNamePatterns: ["glass", "window", "windscreen", "windshield"],
  bodyEnvMapIntensity: 0.5,
  detailEnvMapIntensity: 0.52,
  glassEnvMapIntensity: 0.6,
  bodyReceiveShadow: false,
  smoothBodyGeometry: true,
  bodySmoothingCreaseAngleDegrees: 60,
  preserveBodyMaterialProperties: true,
  bodyRoughnessFloor: null,
  bodyMetalnessCeiling: null,
  glassRoughnessFloor: 0.24,
  glassMetalnessCeiling: 0.04
};
