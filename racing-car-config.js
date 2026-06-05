function createCarModelUrl(relativePath) {
  return new URL(relativePath, import.meta.url).href;
}

export const racingSceneConfig = {
  visualScale: 2,
  collisionScale: 2,
  trackWidthOverride: 24,
  cameraFov: 54,
  cameraFollowDistance: 10.6,
  cameraHeight: 5.7,
  cameraLookAhead: 4.8,
  cameraTargetHeight: 1.45,
  cameraFollowTightness: 4.8,
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
  glassMetalnessCeiling: 0.04,
  environment: {
    ground: {
      nearFieldSize: 320,
      farFieldSize: 460,
      nearFieldSegments: 28,
      farFieldSegments: 16,
      shoulderInnerOffset: 1.8,
      shoulderOuterOffset: 6.4,
      nearFieldColor: 0x6f9d57,
      farFieldColor: 0x90aa77,
      shoulderColor: 0xa48d63,
      soilColor: 0x8a7351,
      nearUndulation: 0.55,
      farUndulation: 1.1
    },
    foliage: {
      placementSamples: 96,
      nearTreeCount: 30,
      farTreeCount: 120,
      shrubCount: 68,
      nearTreeBandMin: 18,
      nearTreeBandMax: 42,
      farTreeBandMin: 36,
      farTreeBandMax: 112,
      shrubBandMin: 8,
      shrubBandMax: 18,
      placementJitter: 7,
      nearTreeMinSpacing: 11,
      farTreeMinSpacing: 8,
      shrubMinSpacing: 4.6,
      maxAttempts: 1400
    },
    backdrop: {
      radiusPadding: 78,
      ridgeSegments: 36,
      ridgeHeightMin: 16,
      ridgeHeightMax: 36,
      innerTreeCount: 36,
      innerTreeHeightMin: 14,
      innerTreeHeightMax: 28
    },
    roadsideProps: {
      reflectorSpacing: 5,
      sponsorBoardCount: 8,
      tireStackCount: 8
    }
  }
};

export const defaultRacingCarId = "aventador";

export const racingCarCatalog = [
  {
    id: "aventador",
    make: "Lamborghini",
    name: "Aventador LP720-4 50th",
    tag: "中置超跑",
    summary: "线条低矮的公路超跑，作为当前默认参赛车提供。",
    accentColor: "#d64545",
    modelUrl: createCarModelUrl(
      "./assets/cars/lamborghini_aventador_lp720-4_50th_anniversary/lamborghini_aventador_lp720-4_50th_anniversary.glb"
    ),
    targetLength: 4.78,
    modelRotationDegrees: 0
  },
  {
    id: "dbr9",
    make: "Aston Martin Racing",
    name: "DBR9",
    tag: "GT 赛道车",
    summary: "耐力赛风格的 GT 赛车，用来和默认参赛车形成明确外观差异。",
    accentColor: "#0f8b8d",
    modelUrl: createCarModelUrl(
      "./assets/cars/2008-aston-martin-009-aston-martin-racing-dbr9/source/2008 Aston Martin 009 Aston Martin Racing DBR9.glb"
    ),
    targetLength: 4.72,
    modelRotationDegrees: 180
  }
];

export function getRacingCarById(carId) {
  return racingCarCatalog.find((car) => car.id === carId) ?? racingCarCatalog[0];
}

export function getDefaultOpponentRacingCarId(playerCarId) {
  return racingCarCatalog.find((car) => car.id !== playerCarId)?.id ?? getRacingCarById(playerCarId).id;
}

export const racingCarConfig = {
  ...racingSceneConfig,
  ...getRacingCarById(defaultRacingCarId)
};
