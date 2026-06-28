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

const USER_MAPS_STORAGE_KEY = "ack-games:racing-map-library:v1";
const SELECTED_MAP_ID_STORAGE_KEY = "ack-games:racing-selected-map-id:v1";
const LEGACY_ACTIVE_MAP_STORAGE_KEY = "ack-games:racing-map:v2";
const MAP_VERSION = 3;
const DEFAULT_LOOP_START_PROGRESS = 0.02;
const DEFAULT_PRESET_MAP_ID = "preset-f1-practice";

export const TRACK_SURFACES = Object.freeze({
  ASPHALT: "asphalt",
  GRAVEL: "gravel"
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

export function listRacingMapEntries() {
  const state = readMapLibraryState();
  const userEntries = sortUserEntries(state.userEntries).map(cloneMapEntry);
  return [...presetMaps.map(cloneMapEntry), ...userEntries];
}

export function loadRacingMapEntry(mapId) {
  const state = readMapLibraryState();
  return cloneMapEntry(resolveMapEntry(state, mapId));
}

export function loadSelectedRacingMapEntry() {
  const state = readMapLibraryState();
  return cloneMapEntry(resolveSelectedEntry(state));
}

export function loadSelectedRacingMap() {
  return cloneRacingMap(loadSelectedRacingMapEntry().map);
}

export function loadSelectedRacingMapId() {
  return loadSelectedRacingMapEntry().mapId;
}

export function selectRacingMap(mapId) {
  const state = readMapLibraryState();
  const entry = resolveMapEntry(state, mapId);
  persistSelectedMapId(entry.mapId);
  return cloneMapEntry(entry);
}

export function createNewRacingUserMap() {
  const state = readMapLibraryState();
  const now = new Date().toISOString();
  const userEntry = createUserEntry({
    mapId: createMapId(),
    createdAt: now,
    updatedAt: now,
    map: {
      ...getDefaultRacingMap(),
      name: nextNewMapName(listAllMapNames(state))
    }
  });

  state.userEntries.unshift(userEntry);
  persistState(state, userEntry.mapId);
  return cloneMapEntry(userEntry);
}

export function ensureSelectedRacingMapIsEditable() {
  const state = readMapLibraryState();
  const selected = resolveSelectedEntry(state);
  if (selected.kind === "user") {
    return cloneMapEntry(selected);
  }

  const now = new Date().toISOString();
  const userEntry = createUserEntry({
    mapId: createMapId(),
    createdAt: now,
    updatedAt: now,
    map: {
      ...cloneRacingMap(selected.map),
      name: nextCopyName(selected.map.name, listAllMapNames(state))
    }
  });

  state.userEntries.unshift(userEntry);
  persistState(state, userEntry.mapId);
  return cloneMapEntry(userEntry);
}

export function saveSelectedRacingMap(map) {
  const state = readMapLibraryState();
  const selected = resolveSelectedEntry(state);
  if (selected.kind !== "user") {
    throw new Error("预设地图不能直接保存，请先复制为用户地图。");
  }

  const normalized = normalizeRacingMap(map);
  const nextEntry = {
    ...selected,
    updatedAt: new Date().toISOString(),
    map: normalized
  };

  state.userEntries = state.userEntries.map((entry) => entry.mapId === nextEntry.mapId ? nextEntry : entry);
  persistState(state, nextEntry.mapId);
  return cloneRacingMap(nextEntry.map);
}

export function duplicateSelectedRacingMap() {
  const state = readMapLibraryState();
  const selected = resolveSelectedEntry(state);
  const now = new Date().toISOString();
  const userEntry = createUserEntry({
    mapId: createMapId(),
    createdAt: now,
    updatedAt: now,
    map: {
      ...cloneRacingMap(selected.map),
      name: nextCopyName(selected.map.name, listAllMapNames(state))
    }
  });

  state.userEntries.unshift(userEntry);
  persistState(state, userEntry.mapId);
  return cloneMapEntry(userEntry);
}

export function deleteUserRacingMap(mapId) {
  const state = readMapLibraryState();
  const target = state.userEntries.find((entry) => entry.mapId === mapId);
  if (!target) {
    throw new Error("只能删除用户地图。");
  }

  state.userEntries = state.userEntries.filter((entry) => entry.mapId !== mapId);
  const nextSelectedMapId = state.selectedMapId === mapId ? DEFAULT_PRESET_MAP_ID : state.selectedMapId;
  persistState(state, nextSelectedMapId);
  return cloneMapEntry(resolveMapEntry({ ...state, selectedMapId: nextSelectedMapId }, nextSelectedMapId));
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

  const defaultMap = getDefaultMapTemplate();
  const normalized = {
    version: MAP_VERSION,
    name: typeof rawMap.name === "string" && rawMap.name.trim()
      ? rawMap.name.trim()
      : defaultMap.name,
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

  const validation = validateRacingMap(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return normalized;
}

export function loadActiveRacingMap() {
  return loadSelectedRacingMap();
}

export function saveActiveRacingMap(map) {
  return saveSelectedRacingMap(map);
}

function getDefaultMapTemplate() {
  return defaultMapTemplate;
}

function readMapLibraryState() {
  const emptyState = {
    userEntries: [],
    selectedMapId: DEFAULT_PRESET_MAP_ID
  };

  if (typeof localStorage === "undefined") {
    return emptyState;
  }

  let userEntries = [];
  try {
    const serialized = localStorage.getItem(USER_MAPS_STORAGE_KEY);
    if (serialized) {
      const rawEntries = JSON.parse(serialized);
      if (Array.isArray(rawEntries)) {
        userEntries = rawEntries
          .map(normalizeStoredUserEntry)
          .filter(Boolean);
      }
    }
  } catch (error) {
    console.warn("Failed to load racing map library from storage.", error);
  }

  let selectedMapId = loadPersistedSelectedMapId();
  if (userEntries.length === 0) {
    const legacyMigration = migrateLegacyActiveMap();
    if (legacyMigration) {
      userEntries = [legacyMigration.entry];
      selectedMapId = legacyMigration.entry.mapId;
      persistUserEntries(userEntries);
      persistSelectedMapId(selectedMapId);
      try {
        localStorage.removeItem(LEGACY_ACTIVE_MAP_STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to clear legacy racing map storage.", error);
      }
    }
  }

  const state = {
    userEntries: sortUserEntries(userEntries),
    selectedMapId: selectedMapId ?? DEFAULT_PRESET_MAP_ID
  };

  if (!mapIdExists(state, state.selectedMapId)) {
    state.selectedMapId = DEFAULT_PRESET_MAP_ID;
    persistSelectedMapId(state.selectedMapId);
  }

  return state;
}

function persistState(state, selectedMapId) {
  persistUserEntries(state.userEntries);
  persistSelectedMapId(selectedMapId);
}

function persistUserEntries(userEntries) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      USER_MAPS_STORAGE_KEY,
      JSON.stringify(sortUserEntries(userEntries).map(serializeUserEntry))
    );
  } catch (error) {
    console.warn("Failed to save racing map library.", error);
  }
}

function persistSelectedMapId(mapId) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(SELECTED_MAP_ID_STORAGE_KEY, mapId);
  } catch (error) {
    console.warn("Failed to save selected racing map.", error);
  }
}

function loadPersistedSelectedMapId() {
  if (typeof localStorage === "undefined") {
    return DEFAULT_PRESET_MAP_ID;
  }

  try {
    const stored = localStorage.getItem(SELECTED_MAP_ID_STORAGE_KEY);
    return typeof stored === "string" && stored.trim() ? stored : DEFAULT_PRESET_MAP_ID;
  } catch (error) {
    console.warn("Failed to load selected racing map id.", error);
    return DEFAULT_PRESET_MAP_ID;
  }
}

function migrateLegacyActiveMap() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const serialized = localStorage.getItem(LEGACY_ACTIVE_MAP_STORAGE_KEY);
    if (!serialized) {
      return null;
    }

    const migratedMap = normalizeRacingMap(JSON.parse(serialized));
    if (mapsAreEquivalent(migratedMap, getDefaultMapTemplate())) {
      return null;
    }

    const now = new Date().toISOString();
    return {
      entry: createUserEntry({
        mapId: createMapId(),
        createdAt: now,
        updatedAt: now,
        map: {
          ...migratedMap,
          name: typeof migratedMap.name === "string" && migratedMap.name.trim()
            ? migratedMap.name.trim()
            : nextNewMapName(new Set())
        }
      })
    };
  } catch (error) {
    console.warn("Failed to migrate legacy racing map.", error);
    return null;
  }
}

function mapIdExists(state, mapId) {
  return presetMapById.has(mapId) || state.userEntries.some((entry) => entry.mapId === mapId);
}

function resolveSelectedEntry(state) {
  return resolveMapEntry(state, state.selectedMapId);
}

function resolveMapEntry(state, mapId) {
  if (presetMapById.has(mapId)) {
    return presetMapById.get(mapId);
  }

  return state.userEntries.find((entry) => entry.mapId === mapId) ?? presetMapById.get(DEFAULT_PRESET_MAP_ID);
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

function serializeUserEntry(entry) {
  return {
    mapId: entry.mapId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    map: cloneRacingMap(entry.map)
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

function sortUserEntries(entries) {
  return [...entries].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function listAllMapNames(state) {
  const names = new Set();
  for (const preset of presetMaps) {
    names.add(preset.map.name);
  }
  for (const entry of state.userEntries) {
    names.add(entry.map.name);
  }
  return names;
}

function nextNewMapName(takenNames) {
  let index = 1;
  while (takenNames.has(`新地图 ${index}`)) {
    index += 1;
  }
  return `新地图 ${index}`;
}

function nextCopyName(baseName, takenNames) {
  const preferred = `${baseName} 副本`;
  if (!takenNames.has(preferred)) {
    return preferred;
  }

  let index = 2;
  while (takenNames.has(`${preferred} ${index}`)) {
    index += 1;
  }
  return `${preferred} ${index}`;
}

function createMapId() {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneMapEntry(entry) {
  return {
    mapId: entry.mapId,
    kind: entry.kind,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    map: cloneRacingMap(entry.map)
  };
}

function mapsAreEquivalent(a, b) {
  return exportRacingMap(a) === exportRacingMap(b);
}
