const STORAGE_KEY = "ack-games:racing-map:v1";
const MAP_VERSION = 1;

export const racingTrackShapeConfig = {
  minHalfWidthScale: 0.4,
  curvatureRadiusFactor: 4,
  widthSmoothingPasses: 8
};

export const racingObstaclePrefabs = [
  {
    type: "crate",
    label: "箱子",
    width: 2.6,
    depth: 1.8,
    height: 1.4,
    color: "#ba6a2b"
  },
  {
    type: "barrier",
    label: "护栏块",
    width: 4.2,
    depth: 1.1,
    height: 1.0,
    color: "#d7dee8"
  },
  {
    type: "cone",
    label: "锥桶组",
    width: 2.2,
    depth: 1.4,
    height: 0.9,
    color: "#f46f34"
  }
];

const defaultMap = {
  version: MAP_VERSION,
  name: "F1 练习场",
  startProgress: 0.02,
  track: {
    width: 14,
    samples: 520,
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
  },
  obstacles: []
};

export function cloneRacingMap(map) {
  return JSON.parse(JSON.stringify(normalizeRacingMap(map)));
}

export function getDefaultRacingMap() {
  return cloneRacingMap(defaultMap);
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

export function getObstaclePrefab(type) {
  return racingObstaclePrefabs.find((prefab) => prefab.type === type) ?? racingObstaclePrefabs[0];
}

export function createObstacleFromPrefab(type, x = 0, z = 0) {
  const prefab = getObstaclePrefab(type);
  return {
    id: createEntityId(prefab.type),
    type: prefab.type,
    x,
    z,
    rotation: 0,
    width: prefab.width,
    depth: prefab.depth,
    height: prefab.height,
    color: prefab.color
  };
}

function normalizeRacingMap(rawMap) {
  const rawTrack = rawMap?.track ?? {};
  const fallbackTrack = defaultMap.track;
  const fallbackPointCount = fallbackTrack.controlPoints.length;
  const controlPoints = Array.isArray(rawTrack.controlPoints)
    ? rawTrack.controlPoints
      .map(normalizeControlPoint)
      .filter(Boolean)
    : [];

  return {
    version: MAP_VERSION,
    name: typeof rawMap?.name === "string" && rawMap.name.trim() ? rawMap.name.trim() : defaultMap.name,
    startProgress: clampNumber(rawMap?.startProgress, 0, 0.999, defaultMap.startProgress),
    track: {
      width: clampNumber(rawTrack.width, 10, 18, fallbackTrack.width),
      samples: clampInt(rawTrack.samples, 240, 720, fallbackTrack.samples),
      controlPoints: controlPoints.length >= Math.min(4, fallbackPointCount)
        ? controlPoints
        : fallbackTrack.controlPoints.map((point) => [...point])
    },
    obstacles: Array.isArray(rawMap?.obstacles)
      ? rawMap.obstacles.map(normalizeObstacle).filter(Boolean)
      : []
  };
}

function normalizeControlPoint(point) {
  if (!Array.isArray(point) || point.length < 2) {
    return null;
  }

  const x = Number(point[0]);
  const z = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  return [roundCoordinate(x), roundCoordinate(z)];
}

function normalizeObstacle(rawObstacle) {
  const prefab = getObstaclePrefab(rawObstacle?.type);
  const x = Number(rawObstacle?.x);
  const z = Number(rawObstacle?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  return {
    id: typeof rawObstacle?.id === "string" && rawObstacle.id ? rawObstacle.id : createEntityId(prefab.type),
    type: prefab.type,
    x: roundCoordinate(x),
    z: roundCoordinate(z),
    rotation: roundCoordinate(clampNumber(rawObstacle?.rotation, -Math.PI * 2, Math.PI * 2, 0)),
    width: roundCoordinate(clampNumber(rawObstacle?.width, 0.6, 12, prefab.width)),
    depth: roundCoordinate(clampNumber(rawObstacle?.depth, 0.6, 12, prefab.depth)),
    height: roundCoordinate(clampNumber(rawObstacle?.height, 0.4, 6, prefab.height)),
    color: typeof rawObstacle?.color === "string" && rawObstacle.color ? rawObstacle.color : prefab.color
  };
}

function createEntityId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(numeric, min), max);
}

function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}
