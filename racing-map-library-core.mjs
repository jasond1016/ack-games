export class RacingMapLibraryError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "RacingMapLibraryError";
    this.code = code;
  }
}

export function createInMemoryRacingMapStorage(initialValue = null) {
  let value = initialValue;
  let writes = 0;
  let writeError = null;
  return {
    read: () => value,
    write(nextValue) {
      if (writeError) throw writeError;
      value = nextValue;
      writes += 1;
    },
    failWrites(error = new Error("storage unavailable")) { writeError = error; },
    recoverWrites() { writeError = null; },
    inspect: () => ({ value, writes })
  };
}

export function createRacingMapLibraryCore({
  storage,
  presets,
  defaultPresetId,
  defaultMap,
  normalizeMap,
  identity,
  initialState = null,
  readonlyReason = null
}) {
  const presetById = new Map(presets.map((entry) => [entry.mapId, freezeClone(entry)]));
  let readonly = readonlyReason;
  let state;

  try {
    const serialized = storage.read();
    state = serialized ? normalizeState(JSON.parse(serialized)) : normalizeState(initialState);
  } catch (error) {
    readonly = readonly ?? "用户地图库无法读取。";
    state = emptyState();
  }

  function snapshot() {
    const selected = resolveEntry(state.selectedMapId);
    return freezeClone({
      readonly: Boolean(readonly),
      readonlyReason: readonly,
      selectedMapId: selected.mapId,
      selected,
      presets: presets.map(freezeClone),
      userMaps: sortUsers(state.userEntries).map(freezeClone)
    });
  }

  function select(mapId) {
    assertWritable();
    const entry = resolveEntry(mapId, true);
    return commit({ ...state, selectedMapId: entry.mapId });
  }

  function createUserMap() {
    assertWritable();
    const now = identity.now();
    const entry = makeUserEntry({
      mapId: identity.createMapId(),
      createdAt: now,
      updatedAt: now,
      map: { ...clone(defaultMap), name: nextNewName(allNames()) }
    });
    return commit({ selectedMapId: entry.mapId, userEntries: [entry, ...state.userEntries] });
  }

  function beginEditingSelected() {
    assertWritable();
    const selected = resolveEntry(state.selectedMapId);
    if (selected.kind === "user") return snapshot();
    const now = identity.now();
    const entry = makeUserEntry({
      mapId: identity.createMapId(),
      createdAt: now,
      updatedAt: now,
      map: { ...clone(selected.map), name: nextCopyName(selected.map.name, allNames()) }
    });
    return commit({ selectedMapId: entry.mapId, userEntries: [entry, ...state.userEntries] });
  }

  function saveEditingMap(map) {
    assertWritable();
    const selected = requireSelectedUser();
    const normalized = normalizeMap(map);
    if (equivalent(selected.map, normalized)) return snapshot();
    const updated = { ...selected, updatedAt: identity.now(), map: normalized };
    return commit({ ...state, userEntries: replaceEntry(state.userEntries, updated) });
  }

  function duplicateEditingMap() {
    assertWritable();
    const selected = requireSelectedUser();
    const now = identity.now();
    const entry = makeUserEntry({
      mapId: identity.createMapId(),
      createdAt: now,
      updatedAt: now,
      map: { ...clone(selected.map), name: nextCopyName(selected.map.name, allNames()) }
    });
    return commit({ selectedMapId: entry.mapId, userEntries: [entry, ...state.userEntries] });
  }

  function deleteUserMap(mapId) {
    assertWritable();
    const target = state.userEntries.find((entry) => entry.mapId === mapId);
    if (!target) throw new RacingMapLibraryError("USER_MAP_NOT_FOUND", "只能删除存在的用户地图。");
    const selectedMapId = state.selectedMapId === mapId ? defaultPresetId : state.selectedMapId;
    return commit({ selectedMapId, userEntries: state.userEntries.filter((entry) => entry.mapId !== mapId) });
  }

  function importEditingMap(serialized) {
    let parsed;
    try { parsed = JSON.parse(serialized); } catch (error) {
      throw new RacingMapLibraryError("INVALID_MAP_JSON", "地图 JSON 无法解析。", error);
    }
    return saveEditingMap(parsed);
  }

  function commit(nextState) {
    assertWritable();
    const normalized = normalizeState(nextState);
    try {
      storage.write(JSON.stringify(normalized));
    } catch (error) {
      throw new RacingMapLibraryError("STORAGE_WRITE_FAILED", "浏览器存储写入失败，地图改动尚未保存。", error);
    }
    state = normalized;
    return snapshot();
  }

  function normalizeState(raw) {
    const fallback = emptyState();
    if (!raw || typeof raw !== "object") return fallback;
    const entries = Array.isArray(raw.userEntries)
      ? raw.userEntries.map(normalizeUserEntry).filter(Boolean)
      : [];
    const selectedMapId = typeof raw.selectedMapId === "string" ? raw.selectedMapId : defaultPresetId;
    return { version: 1, selectedMapId: exists(selectedMapId, entries) ? selectedMapId : defaultPresetId, userEntries: entries };
  }

  function normalizeUserEntry(raw) {
    try {
      if (!raw || raw.kind !== "user" || typeof raw.mapId !== "string") return null;
      return makeUserEntry({
        mapId: raw.mapId,
        createdAt: normalizeTime(raw.createdAt),
        updatedAt: normalizeTime(raw.updatedAt),
        map: raw.map
      });
    } catch { return null; }
  }

  function makeUserEntry({ mapId, createdAt, updatedAt, map }) {
    return { mapId, kind: "user", createdAt, updatedAt, map: normalizeMap(map) };
  }

  function resolveEntry(mapId, strict = false) {
    const preset = presetById.get(mapId);
    if (preset) return preset;
    const user = state.userEntries.find((entry) => entry.mapId === mapId);
    if (user) return user;
    if (strict) throw new RacingMapLibraryError("MAP_NOT_FOUND", "找不到指定地图。");
    return presetById.get(defaultPresetId);
  }

  function requireSelectedUser() {
    const selected = resolveEntry(state.selectedMapId);
    if (selected.kind !== "user") {
      throw new RacingMapLibraryError("PRESET_NOT_EDITABLE", "预设地图不能直接保存，请先复制为用户地图。");
    }
    return selected;
  }

  function exists(mapId, entries = state?.userEntries ?? []) {
    return presetById.has(mapId) || entries.some((entry) => entry.mapId === mapId);
  }

  function allNames() {
    return [...presets.map((entry) => entry.map.name), ...state.userEntries.map((entry) => entry.map.name)];
  }

  function assertWritable() {
    if (readonly) throw new RacingMapLibraryError("LIBRARY_READONLY", readonly);
  }

  return Object.freeze({
    snapshot,
    select,
    createUserMap,
    beginEditingSelected,
    saveEditingMap,
    duplicateEditingMap,
    deleteUserMap,
    importEditingMap
  });
}

function emptyState() { return { version: 1, selectedMapId: "", userEntries: [] }; }
function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function freezeClone(value) { return deepFreeze(clone(value)); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
function normalizeTime(value) { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? new Date(0).toISOString() : parsed.toISOString(); }
function replaceEntry(entries, replacement) { return entries.map((entry) => entry.mapId === replacement.mapId ? replacement : entry); }
function sortUsers(entries) { return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.mapId.localeCompare(b.mapId)); }
function equivalent(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function nextNewName(names) { return nextNumberedName("新建地图", names); }
function nextCopyName(base, names) { return nextNumberedName(`${base} 副本`, names); }
function nextNumberedName(base, names) { const taken = new Set(names); if (!taken.has(base)) return base; let index = 2; while (taken.has(`${base} ${index}`)) index += 1; return `${base} ${index}`; }
