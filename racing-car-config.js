import { racingDeploymentConfig } from "./racing-deployment-config.js";
import { racingModelManifest } from "./racing-model-manifest.js";

function createCarAssetUrls(carId, relativePath) {
  const manifestEntry = racingModelManifest[carId];
  const cleanPath = relativePath.replace(/^\.\/assets\/cars\//, "");
  const modelPath = racingDeploymentConfig.useHashedModelAssets
    ? manifestEntry?.objectKey ?? cleanPath
    : cleanPath;
  const previewModelPath = racingDeploymentConfig.useHashedModelAssets
    ? manifestEntry?.previewObjectKey ?? modelPath
    : cleanPath;
  const buildModelUrl = (assetPath) => {
    const url = new URL(assetPath, racingDeploymentConfig.modelAssetBaseUrl);
    if (racingDeploymentConfig.modelAssetVersion) url.searchParams.set("v", racingDeploymentConfig.modelAssetVersion);
    return url.href;
  };
  return {
    modelSourcePath: cleanPath,
    modelUrl: buildModelUrl(modelPath),
    previewModelUrl: buildModelUrl(previewModelPath),
    thumbnailUrl: new URL(manifestEntry?.thumbnailUrl ?? `./assets/car-thumbnails/${carId}.webp`, import.meta.url).href
  };
}

export const racingSceneConfig = {
  drivingFeelPreset: "arcade",
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
  toneMappingExposure: 0.9,
  backgroundColor: 0x80acd4,
  fogColor: 0x9ebbd0,
  hemisphereIntensity: 0.72,
  sunIntensity: 1.85,
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
      grassTuftCount: 220,
      rockCount: 42,
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
      grassTuftMinSpacing: 1.8,
      rockMinSpacing: 6.5,
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
    ...createCarAssetUrls("aventador",
      "./assets/cars/lamborghini_aventador_lp720-4_50th_anniversary/lamborghini_aventador_lp720-4_50th_anniversary.glb"
    ),
    targetLength: 4.78,
    modelRotationDegrees: 0
  },
  {
    id: "urus-se",
    make: "Lamborghini",
    name: "Urus SE",
    tag: "高性能 SUV",
    summary: "插混高性能 SUV，车身更高更重，提供与超跑完全不同的视觉轮廓。",
    accentColor: "#b66a2d",
    ...createCarAssetUrls("urus-se",
      "./assets/cars/2025_lamborghini_urus_se.glb"
    ),
    targetLength: 5.12,
    modelRotationDegrees: 0
  },
  {
    id: "miura-p400",
    make: "Lamborghini",
    name: "Miura P400",
    tag: "经典超跑",
    summary: "60 年代中置经典，车身低平，用来补充现有车库的年代层次。",
    accentColor: "#c08b2f",
    ...createCarAssetUrls("miura-p400",
      "./assets/cars/1968_lamborghini_miura_p400.glb"
    ),
    targetLength: 4.37,
    modelRotationDegrees: 0
  },
  {
    id: "countach-lpi-800-4",
    make: "Lamborghini",
    name: "Countach LPI 800-4",
    tag: "复古新生代",
    summary: "现代化 Countach 复刻，棱角轮廓鲜明，适合作为高辨识度公路超跑。",
    accentColor: "#d1d5db",
    ...createCarAssetUrls("countach-lpi-800-4",
      "./assets/cars/2022_lamborghini_countach_lpi_800-4.optimized.glb"
    ),
    targetLength: 4.87,
    modelRotationDegrees: 0
  },
  {
    id: "dbr9",
    make: "Aston Martin Racing",
    name: "DBR9",
    tag: "GT 赛道车",
    summary: "耐力赛风格的 GT 赛车，用来和默认参赛车形成明确外观差异。",
    accentColor: "#0f8b8d",
    ...createCarAssetUrls("dbr9",
      "./assets/cars/2008-aston-martin-009-aston-martin-racing-dbr9/source/2008 Aston Martin 009 Aston Martin Racing DBR9.glb"
    ),
    targetLength: 4.72,
    modelRotationDegrees: 180
  },
  {
    id: "bolide",
    make: "Bugatti",
    name: "Bolide",
    tag: "赛道原型车",
    summary: "极端低矮的赛道机器，适合作为高阶参赛车补充现有车库。",
    accentColor: "#2f72d6",
    defaultPaintColor: "#2f72d6",
    tintIncludePatterns: ["paint", "material", "rimcolor"],
    ...createCarAssetUrls("bolide",
      "./assets/cars/bugatti_bolide.glb"
    ),
    targetLength: 4.76,
    modelRotationDegrees: 0
  },
  {
    id: "centodieci",
    make: "Bugatti",
    name: "Centodieci",
    tag: "限量超跑",
    summary: "向 EB110 致敬的限量 Bugatti，低矮楔形轮廓适合作为车库里的稀有旗舰车型。",
    accentColor: "#f4f4f0",
    ...createCarAssetUrls("centodieci",
      "./assets/cars/2020_bugatti_centodieci.glb"
    ),
    targetLength: 4.54,
    modelRotationDegrees: 0
  },
  {
    id: "revuelto",
    make: "Lamborghini",
    name: "Revuelto",
    tag: "旗舰混动",
    summary: "新一代 V12 旗舰超跑，适合作为当前兰博基尼车系的顶级公路车型。",
    accentColor: "#63b64d",
    ...createCarAssetUrls("revuelto",
      "./assets/cars/free_lamborghini_revuelto.glb"
    ),
    targetLength: 4.95,
    modelRotationDegrees: 0
  },
  {
    id: "aventador-classic",
    make: "Lamborghini",
    name: "Aventador",
    tag: "V12 超跑",
    summary: "标准版 Aventador，作为现有 50th 纪念版之外的另一种 V12 轮廓选择。",
    accentColor: "#ef7d33",
    ...createCarAssetUrls("aventador-classic",
      "./assets/cars/lamborghini_aventador.glb"
    ),
    targetLength: 4.78,
    modelRotationDegrees: 0
  },
  {
    id: "countach-5000qv",
    make: "Lamborghini",
    name: "Countach 5000 QV",
    tag: "经典楔形",
    summary: "80 年代楔形超跑代表，适合补充更纯粹的复古兰博基尼风格。",
    accentColor: "#f5f0e8",
    ...createCarAssetUrls("countach-5000qv",
      "./assets/cars/lamborghini_countach_5000qv__www.vecarz.com.glb"
    ),
    targetLength: 4.14,
    modelRotationDegrees: 0
  },
  {
    id: "huracan-sto",
    make: "Lamborghini",
    name: "Huracan STO",
    tag: "赛道街车",
    summary: "更偏赛道取向的 Huracan 版本，用来填补 GT 赛车和公路超跑之间的视觉区间。",
    accentColor: "#2d8dbf",
    ...createCarAssetUrls("huracan-sto",
      "./assets/cars/lamborghini_huracan_sto_2020.glb"
    ),
    targetLength: 4.55,
    modelRotationDegrees: 0
  },
  {
    id: "terzo-millennio",
    make: "Lamborghini",
    name: "Terzo Millennio",
    tag: "概念车",
    summary: "未来感极强的概念车型，用来提供与量产车完全不同的造型语言。",
    accentColor: "#4ab3c3",
    ...createCarAssetUrls("terzo-millennio",
      "./assets/cars/lamborghini_terzo.glb"
    ),
    targetLength: 4.73,
    modelRotationDegrees: 0
  },
  {
    id: "veneno",
    make: "Lamborghini",
    name: "Veneno",
    tag: "极端超跑",
    summary: "夸张空气动力学外观的限量超跑，适合作为车库里的视觉焦点车型。",
    accentColor: "#9aa3ad",
    ...createCarAssetUrls("veneno",
      "./assets/cars/lamborghini_venevo.glb"
    ),
    targetLength: 5.02,
    modelRotationDegrees: 0
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
