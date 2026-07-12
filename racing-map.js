import {
  TRACK_MAX_WIDTH,
  TRACK_MIN_WIDTH,
  TRACK_SHAPES,
  clampInt,
  clampNumber,
  normalizeControlPoint,
  inspectRacingTrack,
  normalizeLoopStartProgress,
} from "./racing-track.mjs";
import { createRacingMapLibraryCore } from "./racing-map-library-core.mjs";

const USER_MAPS_STORAGE_KEY = "ack-games:racing-map-library:v1";
const SELECTED_MAP_ID_STORAGE_KEY = "ack-games:racing-selected-map-id:v1";
const LEGACY_ACTIVE_MAP_STORAGE_KEY = "ack-games:racing-map:v2";
const MAP_LIBRARY_STATE_STORAGE_KEY = "ack-games:racing-map-library-state:v1";
const MAP_VERSION = 3;
const DEFAULT_LOOP_START_PROGRESS = 0.02;
const DEFAULT_PRESET_MAP_ID = "preset-f1-practice";

export const TRACK_SURFACES = Object.freeze({
  ASPHALT: "asphalt",
  GRAVEL: "gravel"
});

export const RACING_ACTIVITIES = Object.freeze({
  RACE: "race",
  FREE_DRIVE: "free-drive"
});

export const TRACK_SURFACE_LABELS = Object.freeze({
  [TRACK_SURFACES.ASPHALT]: "柏油路面",
  [TRACK_SURFACES.GRAVEL]: "沙石路面"
});

const defaultMapTemplate = {
  version: MAP_VERSION,
  name: "F1 练习场",
  track: {
    shape: TRACK_SHAPES.LOOP,
    surface: TRACK_SURFACES.ASPHALT,
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

const presetMaps = [
  {
    mapId: DEFAULT_PRESET_MAP_ID,
    kind: "preset",
    map: defaultMapTemplate
  },
  {
    mapId: "preset-pine-rally",
    kind: "preset",
    map: {
      version: MAP_VERSION,
      name: "松林拉力",
      track: {
        shape: TRACK_SHAPES.OPEN,
        surface: TRACK_SURFACES.GRAVEL,
        width: 16,
        samples: 560,
        controlPoints: [
          [-112, -54],
          [-84, -72],
          [-46, -68],
          [-14, -52],
          [18, -26],
          [46, 2],
          [74, 32],
          [96, 64],
          [66, 86],
          [24, 92],
          [-22, 76],
          [-64, 48],
          [-96, 20]
        ]
      }
    }
  },
  {
    mapId: "preset-island-freedrive",
    kind: "preset",
    map: {
      version: MAP_VERSION,
      name: "海风岛自由驾驶",
      activity: RACING_ACTIVITIES.FREE_DRIVE,
      track: {
        shape: TRACK_SHAPES.LOOP,
        surface: TRACK_SURFACES.ASPHALT,
        width: 18,
        samples: 640,
        startPosition: { progress: 0.03 },
        controlPoints: [
          [-118, -42], [-76, -82], [-18, -96], [46, -82], [104, -44],
          [126, 8], [98, 58], [48, 92], [-12, 104], [-72, 78],
          [-112, 38], [-88, 6]
        ]
      }
    }
  }
].map((entry) => ({
  ...entry,
  map: normalizeRacingMap(entry.map)
}));

const presetMapById = new Map(presetMaps.map((entry) => [entry.mapId, entry]));

export function getTrackSurfaceLabel(surface) {
  return TRACK_SURFACE_LABELS[surface] ?? TRACK_SURFACE_LABELS[TRACK_SURFACES.ASPHALT];
}

export function normalizeTrackSurface(surface) {
  return surface === TRACK_SURFACES.GRAVEL || surface === TRACK_SURFACES.ASPHALT
    ? surface
    : TRACK_SURFACES.ASPHALT;
}

export function cloneRacingMap(map) {
  return JSON.parse(JSON.stringify(normalizeRacingMap(map)));
}

export function getDefaultRacingMap() {
  return cloneRacingMap(presetMapById.get(DEFAULT_PRESET_MAP_ID).map);
}

export function createLoopStartPosition(progress = DEFAULT_LOOP_START_PROGRESS) {
  return {
    progress: normalizeLoopStartProgress(progress, DEFAULT_LOOP_START_PROGRESS)
  };
}

export function exportRacingMap(map) {
  return JSON.stringify(normalizeRacingMap(map), null, 2);
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

  const defaultMap = getDefaultMapTemplate();
  const normalized = {
    version: MAP_VERSION,
    name: typeof rawMap.name === "string" && rawMap.name.trim()
      ? rawMap.name.trim()
      : defaultMap.name,
    activity: rawMap.activity === RACING_ACTIVITIES.FREE_DRIVE
      ? RACING_ACTIVITIES.FREE_DRIVE
      : RACING_ACTIVITIES.RACE,
    track: {
      shape,
      surface: normalizeTrackSurface(rawTrack.surface),
      width: clampNumber(rawTrack.width, TRACK_MIN_WIDTH, TRACK_MAX_WIDTH, defaultMap.track.width),
      samples: clampInt(rawTrack.samples, 240, 720, defaultMap.track.samples),
      controlPoints
    }
  };

  if (shape === TRACK_SHAPES.LOOP) {
    normalized.track.startPosition = createLoopStartPosition(rawTrack.startPosition?.progress);
  }

  const validation = inspectRacingTrack(normalized.track).validation;
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return normalized;
}

function getDefaultMapTemplate() {
  return defaultMapTemplate;
}

function normalizeStoredUserEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  try {
    const normalizedMap = normalizeRacingMap(rawEntry.map ?? rawEntry);
    const createdAt = normalizeTimestamp(rawEntry.createdAt);
    const updatedAt = normalizeTimestamp(rawEntry.updatedAt, createdAt);
    return createUserEntry({
      mapId: normalizeStoredMapId(rawEntry.mapId),
      createdAt,
      updatedAt,
      map: normalizedMap
    });
  } catch (error) {
    console.warn("Skipping invalid stored racing map entry.", error);
    return null;
  }
}

function createUserEntry({ mapId, createdAt, updatedAt, map }) {
  return {
    mapId,
    kind: "user",
    createdAt,
    updatedAt,
    map: cloneRacingMap(map)
  };
}

function normalizeStoredMapId(mapId) {
  return typeof mapId === "string" && mapId.trim()
    ? mapId.trim()
    : createMapId();
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : fallback;
}

function createMapId() {
  return `user-${crypto.randomUUID()}`;
}

function mapsAreEquivalent(a, b) {
  return exportRacingMap(a) === exportRacingMap(b);
}

function createProductionMapLibrary() {
  const identity = {
    createMapId,
    now: () => new Date().toISOString()
  };
  if (typeof localStorage === "undefined") {
    return createRacingMapLibraryCore({
      storage: { read: () => null, write: () => {} },
      presets: presetMaps,
      defaultPresetId: DEFAULT_PRESET_MAP_ID,
      defaultMap: getDefaultRacingMap(),
      normalizeMap: normalizeRacingMap,
      identity
    });
  }

  try {
    return createAvailableStorageMapLibrary(identity);
  } catch (error) {
    return createRacingMapLibraryCore({
      storage: { read: () => null, write: () => { throw error; } },
      presets: presetMaps,
      defaultPresetId: DEFAULT_PRESET_MAP_ID,
      defaultMap: getDefaultRacingMap(),
      normalizeMap: normalizeRacingMap,
      identity,
      readonlyReason: "浏览器存储不可用，地图库已进入只读模式。"
    });
  }
}

function createAvailableStorageMapLibrary(identity) {
  const storage = {
    read: () => localStorage.getItem(MAP_LIBRARY_STATE_STORAGE_KEY),
    write: (serialized) => localStorage.setItem(MAP_LIBRARY_STATE_STORAGE_KEY, serialized)
  };
  const current = localStorage.getItem(MAP_LIBRARY_STATE_STORAGE_KEY);
  if (current) {
    try {
      JSON.parse(current);
      return createRacingMapLibraryCore({ storage, presets: presetMaps, defaultPresetId: DEFAULT_PRESET_MAP_ID, defaultMap: getDefaultRacingMap(), normalizeMap: normalizeRacingMap, identity });
    } catch {
      const recovered = readLegacyStateWithoutMutation();
      return createRacingMapLibraryCore({
        storage: { read: () => null, write: () => { throw new Error("corrupt state"); } },
        presets: presetMaps,
        defaultPresetId: DEFAULT_PRESET_MAP_ID,
        defaultMap: getDefaultRacingMap(),
        normalizeMap: normalizeRacingMap,
        identity,
        initialState: recovered,
        readonlyReason: "用户地图库无法读取。"
      });
    }
  }

  const legacyState = readLegacyStateWithoutMutation();
  if (legacyState) {
    try {
      localStorage.setItem(MAP_LIBRARY_STATE_STORAGE_KEY, JSON.stringify({ version: 1, ...legacyState }));
      for (const key of [USER_MAPS_STORAGE_KEY, SELECTED_MAP_ID_STORAGE_KEY, LEGACY_ACTIVE_MAP_STORAGE_KEY]) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      return createRacingMapLibraryCore({
        storage: { read: () => null, write: () => { throw error; } },
        presets: presetMaps,
        defaultPresetId: DEFAULT_PRESET_MAP_ID,
        defaultMap: getDefaultRacingMap(),
        normalizeMap: normalizeRacingMap,
        identity,
        initialState: legacyState,
        readonlyReason: "浏览器存储不可用，地图库已进入只读模式。"
      });
    }
  }

  return createRacingMapLibraryCore({ storage, presets: presetMaps, defaultPresetId: DEFAULT_PRESET_MAP_ID, defaultMap: getDefaultRacingMap(), normalizeMap: normalizeRacingMap, identity });
}

function readLegacyStateWithoutMutation() {
  let userEntries = [];
  const serializedUsers = localStorage.getItem(USER_MAPS_STORAGE_KEY);
  if (serializedUsers) {
    const rawUsers = JSON.parse(serializedUsers);
    if (Array.isArray(rawUsers)) userEntries = rawUsers.map(normalizeStoredUserEntry).filter(Boolean);
  }
  let selectedMapId = localStorage.getItem(SELECTED_MAP_ID_STORAGE_KEY) || DEFAULT_PRESET_MAP_ID;
  if (userEntries.length === 0) {
    const serializedLegacy = localStorage.getItem(LEGACY_ACTIVE_MAP_STORAGE_KEY);
    if (serializedLegacy) {
      const migratedMap = normalizeRacingMap(JSON.parse(serializedLegacy));
      if (!mapsAreEquivalent(migratedMap, getDefaultMapTemplate())) {
        const now = new Date().toISOString();
        const entry = createUserEntry({ mapId: createMapId(), createdAt: now, updatedAt: now, map: migratedMap });
        userEntries = [entry];
        selectedMapId = entry.mapId;
      }
    }
  }
  if (!serializedUsers && !localStorage.getItem(SELECTED_MAP_ID_STORAGE_KEY) && !localStorage.getItem(LEGACY_ACTIVE_MAP_STORAGE_KEY)) return null;
  return { selectedMapId, userEntries };
}

export const racingMapLibrary = createProductionMapLibrary();
