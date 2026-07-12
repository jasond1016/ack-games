import { defaultRacingCarId, getRacingCarById } from "./racing-car-config.js";

const STORAGE_KEY = "ack-games:racing-start-config:v1";
const START_CONFIG_VERSION = 2;

export const RACING_CAMERA_MODES = Object.freeze({
  CHASE: "chase",
  HOOD: "hood"
});

function normalizeCameraMode(cameraMode) {
  if (cameraMode === "cockpit") {
    return RACING_CAMERA_MODES.HOOD;
  }
  return Object.values(RACING_CAMERA_MODES).includes(cameraMode)
    ? cameraMode
    : RACING_CAMERA_MODES.CHASE;
}

function normalizeCarId(carId) {
  return typeof carId === "string" && getRacingCarById(carId)?.id === carId
    ? carId
    : defaultRacingCarId;
}

export function getDefaultRacingStartConfig() {
  return {
    version: START_CONFIG_VERSION,
    playerCarId: defaultRacingCarId,
    cameraMode: RACING_CAMERA_MODES.CHASE
  };
}

export function loadActiveRacingStartConfig() {
  if (typeof localStorage === "undefined") {
    return getDefaultRacingStartConfig();
  }

  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) {
      return getDefaultRacingStartConfig();
    }

    return normalizeRacingStartConfig(JSON.parse(serialized));
  } catch (error) {
    console.warn("Failed to load racing start config from storage.", error);
    return getDefaultRacingStartConfig();
  }
}

export function saveActiveRacingStartConfig(config) {
  const normalized = normalizeRacingStartConfig(config);

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.warn("Failed to save racing start config to storage.", error);
    }
  }

  return { ...normalized };
}

function normalizeRacingStartConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") {
    return getDefaultRacingStartConfig();
  }

  return {
    version: START_CONFIG_VERSION,
    playerCarId: normalizeCarId(rawConfig.playerCarId),
    cameraMode: normalizeCameraMode(rawConfig.cameraMode)
  };
}
