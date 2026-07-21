import { defaultRacingCarId, getRacingCarById } from "./racing-car-config.js";
import {
  isChallengeCarUnlocked,
  loadChallengeUnlockState
} from "./racing-coastal-challenges.mjs";
import {
  DEFAULT_RACING_DIFFICULTY,
  normalizeRacingDifficulty
} from "./racing-opponent-difficulty.mjs";

const STORAGE_KEY = "ack-games:racing-start-config:v1";
const START_CONFIG_VERSION = 4;

export const RACING_CAMERA_MODES = Object.freeze({
  CHASE: "chase",
  HOOD: "hood"
});

export const RACING_COASTAL_PLAY_MODES = Object.freeze({
  ISLAND_TOUR: "island-tour",
  FREE_CRUISE: "free-cruise"
});

const DEFAULT_COASTAL_PLAY_MODE = RACING_COASTAL_PLAY_MODES.ISLAND_TOUR;

function normalizeCameraMode(cameraMode) {
  if (cameraMode === "cockpit") {
    return RACING_CAMERA_MODES.HOOD;
  }
  return Object.values(RACING_CAMERA_MODES).includes(cameraMode)
    ? cameraMode
    : RACING_CAMERA_MODES.CHASE;
}

function normalizeCarId(carId) {
  const resolved = typeof carId === "string" && getRacingCarById(carId)?.id === carId
    ? carId
    : defaultRacingCarId;
  if (!isChallengeCarUnlocked(resolved, loadChallengeUnlockState())) {
    return defaultRacingCarId;
  }
  return resolved;
}

function normalizeForcedOpponentCarId(carId) {
  return typeof carId === "string" && getRacingCarById(carId)?.id === carId
    ? carId
    : null;
}

export function normalizeCoastalPlayMode(coastalPlayMode) {
  return Object.values(RACING_COASTAL_PLAY_MODES).includes(coastalPlayMode)
    ? coastalPlayMode
    : DEFAULT_COASTAL_PLAY_MODE;
}

export function getDefaultRacingStartConfig() {
  return {
    version: START_CONFIG_VERSION,
    playerCarId: defaultRacingCarId,
    cameraMode: RACING_CAMERA_MODES.CHASE,
    coastalPlayMode: DEFAULT_COASTAL_PLAY_MODE,
    difficulty: DEFAULT_RACING_DIFFICULTY,
    forcedOpponentCarId: null
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
    cameraMode: normalizeCameraMode(rawConfig.cameraMode),
    coastalPlayMode: normalizeCoastalPlayMode(rawConfig.coastalPlayMode),
    difficulty: normalizeRacingDifficulty(rawConfig.difficulty),
    forcedOpponentCarId: normalizeForcedOpponentCarId(rawConfig.forcedOpponentCarId)
  };
}
