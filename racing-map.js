import {
  TRACK_MAX_WIDTH,
  TRACK_MIN_WIDTH,
  TRACK_SHAPES,
  clampInt,
  clampNumber,
  normalizeControlPoint,
  normalizeLoopStartProgress,
  validateRacingMap
} from "./racing-track.js";

const STORAGE_KEY = "ack-games:racing-map:v2";
const MAP_VERSION = 2;
const DEFAULT_LOOP_START_PROGRESS = 0.02;

const defaultMap = {
  version: MAP_VERSION,
  name: "F1 练习场",
  track: {
    shape: TRACK_SHAPES.LOOP,
    width: 14,
    samples: 520,
    startPosition: {
      progress: DEFAULT_LOOP_START_PROGRESS
    },
    controlPoints: [
      [-78, -54],
      [-28, -70],
      [34, -64],
      [78, -32],
      [68, 0],
      [48, 18],
      [64, 42],
      [18, 68],
      [-44, 62],
      [-82, 24],
      [-58, 6],
      [-82, -22]
    ]
  }
};

export function cloneRacingMap(map) {
  return JSON.parse(JSON.stringify(normalizeRacingMap(map)));
}

export function getDefaultRacingMap() {
  return cloneRacingMap(defaultMap);
}

export function createLoopStartPosition(progress = DEFAULT_LOOP_START_PROGRESS) {
  return {
    progress: normalizeLoopStartProgress(progress, DEFAULT_LOOP_START_PROGRESS)
  };
}

export function loadActiveRacingMap() {
  if (typeof localStorage === "undefined") {
    return getDefaultRacingMap();
  }

  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) {
      return getDefaultRacingMap();
    }

    return normalizeRacingMap(JSON.parse(serialized));
  } catch (error) {
    console.warn("Failed to load racing map from storage.", error);
    return getDefaultRacingMap();
  }
}

export function saveActiveRacingMap(map) {
  const normalized = normalizeRacingMap(map);

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.warn("Failed to save racing map to storage.", error);
    }
  }

  return cloneRacingMap(normalized);
}

export function resetActiveRacingMap() {
  return saveActiveRacingMap(getDefaultRacingMap());
}

export function exportRacingMap(map) {
  return JSON.stringify(normalizeRacingMap(map), null, 2);
}

export function importRacingMap(serialized) {
  return normalizeRacingMap(JSON.parse(serialized));
}

export function normalizeRacingMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object") {
    throw new Error("地图必须是对象。");
  }

  if ("obstacles" in rawMap) {
    throw new Error("地图 JSON 不再支持 obstacles。");
  }

  if ("startProgress" in rawMap) {
    throw new Error("地图 JSON 不再支持顶层 startProgress。");
  }

  const rawTrack = rawMap.track;
  if (!rawTrack || typeof rawTrack !== "object") {
    throw new Error("地图必须包含 track。");
  }

  const shape = rawTrack.shape;
  if (shape !== TRACK_SHAPES.LOOP && shape !== TRACK_SHAPES.OPEN) {
    throw new Error("赛道形态必须是 open 或 loop。");
  }

  if (!Array.isArray(rawTrack.controlPoints)) {
    throw new Error("赛道必须提供控制点数组。");
  }

  const controlPoints = rawTrack.controlPoints.map(normalizeControlPoint);
  if (controlPoints.some((point) => point == null)) {
    throw new Error("控制点必须是有效坐标。");
  }

  if (shape === TRACK_SHAPES.OPEN && rawTrack.startPosition != null) {
    throw new Error("开放赛道不能包含起跑位置配置。");
  }

  const normalized = {
    version: MAP_VERSION,
    name: typeof rawMap.name === "string" && rawMap.name.trim()
      ? rawMap.name.trim()
      : defaultMap.name,
    track: {
      shape,
      width: clampNumber(rawTrack.width, TRACK_MIN_WIDTH, TRACK_MAX_WIDTH, defaultMap.track.width),
      samples: clampInt(rawTrack.samples, 240, 720, defaultMap.track.samples),
      controlPoints
    }
  };

  if (shape === TRACK_SHAPES.LOOP) {
    normalized.track.startPosition = createLoopStartPosition(rawTrack.startPosition?.progress);
  }

  const validation = validateRacingMap(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return normalized;
}
