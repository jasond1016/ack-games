import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryRacingMapStorage, createRacingMapLibraryCore } from "../racing-map-library-core.mjs";

function harness({ stored = null, readonlyReason = null } = {}) {
  const storage = createInMemoryRacingMapStorage(stored);
  let id = 0;
  let tick = 0;
  const library = createRacingMapLibraryCore({
    storage,
    presets: [{ mapId: "preset", kind: "preset", map: { name: "F1 练习场", value: 1 } }],
    defaultPresetId: "preset",
    defaultMap: { name: "F1 练习场", value: 1 },
    normalizeMap: (map) => {
      if (!map || !map.name) throw new Error("invalid map");
      return structuredClone(map);
    },
    identity: {
      createMapId: () => `user-${++id}`,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString()
    },
    readonlyReason
  });
  return { library, storage };
}

test("编辑预设地图原子复制并选中用户地图", () => {
  const { library } = harness();
  const snapshot = library.beginEditingSelected();
  assert.equal(snapshot.selected.kind, "user");
  assert.equal(snapshot.selected.map.name, "F1 练习场 副本");
});

test("storage 失败时保存不改变内存状态", () => {
  const { library, storage } = harness();
  library.beginEditingSelected();
  const before = library.snapshot();
  storage.failWrites();
  assert.throws(() => library.saveEditingMap({ name: "改坏了", value: 2 }), { code: "STORAGE_WRITE_FAILED" });
  assert.deepEqual(library.snapshot(), before);
});

test("等价保存不写 storage 且不更新时间", () => {
  const { library, storage } = harness();
  const created = library.createUserMap();
  const writes = storage.inspect().writes;
  const after = library.saveEditingMap(created.selected.map);
  assert.equal(storage.inspect().writes, writes);
  assert.equal(after.selected.updatedAt, created.selected.updatedAt);
});

test("删除当前用户地图原子回退预设地图", () => {
  const { library } = harness();
  const created = library.createUserMap();
  const after = library.deleteUserMap(created.selectedMapId);
  assert.equal(after.selectedMapId, "preset");
  assert.equal(after.userMaps.length, 0);
});

test("只读降级允许浏览但拒绝写操作", () => {
  const { library } = harness({ readonlyReason: "storage unavailable" });
  assert.equal(library.snapshot().selected.map.name, "F1 练习场");
  assert.throws(() => library.createUserMap(), { code: "LIBRARY_READONLY" });
});

test("损坏 state 不被覆盖并进入只读降级", () => {
  const storage = createInMemoryRacingMapStorage("{broken");
  const library = createRacingMapLibraryCore({
    storage,
    presets: [{ mapId: "preset", kind: "preset", map: { name: "F1" } }],
    defaultPresetId: "preset",
    defaultMap: { name: "F1" },
    normalizeMap: (map) => map,
    identity: { createMapId: () => "id", now: () => new Date(0).toISOString() }
  });
  assert.equal(library.snapshot().readonly, true);
  assert.equal(storage.inspect().value, "{broken");
});

test("用户地图按更新时间与 mapId 稳定排序", () => {
  const stored = JSON.stringify({
    version: 1,
    selectedMapId: "a",
    userEntries: [
      { mapId: "b", kind: "user", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", map: { name: "B" } },
      { mapId: "a", kind: "user", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", map: { name: "A" } }
    ]
  });
  assert.deepEqual(harness({ stored }).library.snapshot().userMaps.map((entry) => entry.mapId), ["a", "b"]);
});

test("preset environment metadata survives snapshots but does not leak into user maps", () => {
  const storage = createInMemoryRacingMapStorage();
  const library = createRacingMapLibraryCore({
    storage,
    presets: [{
      mapId: "showcase",
      kind: "preset",
      environmentProfile: "coastal-showcase",
      map: { name: "Showcase" }
    }],
    defaultPresetId: "showcase",
    defaultMap: { name: "Default" },
    normalizeMap: (map) => ({ name: map.name }),
    identity: { createMapId: () => "user-1", now: () => new Date(0).toISOString() }
  });

  assert.equal(library.snapshot().selected.environmentProfile, "coastal-showcase");
  const editing = library.beginEditingSelected();
  assert.equal(editing.selected.kind, "user");
  assert.equal(editing.selected.environmentProfile, undefined);
  assert.ok(editing.selected.map.name.startsWith("Showcase"));
  assert.equal(JSON.parse(storage.inspect().value).userEntries[0].environmentProfile, undefined);
});
