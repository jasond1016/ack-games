const defaultCarModelUrl = new URL(
  "./assets/cars/2008-aston-martin-009-aston-martin-racing-dbr9/source/2008 Aston Martin 009 Aston Martin Racing DBR9.glb",
  import.meta.url
).href;

export const racingCarConfig = {
  // Replace this with your own high-detail GLB/GLTF once it lives in the repo.
  modelUrl: defaultCarModelUrl,
  targetLength: 4.72,
  visualScale: 2,
  collisionScale: 2,
  trackWidthOverride: 24,
  modelRotationDegrees: 180,
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
