import assert from "node:assert/strict";
import test from "node:test";

import {
  RACING_CAMERA_MODES,
  RACING_COASTAL_PLAY_MODES,
  getDefaultRacingStartConfig,
  loadActiveRacingStartConfig,
  normalizeCoastalPlayMode,
  saveActiveRacingStartConfig
} from "../racing-start-config.js";

const STORAGE_KEY = "ack-games:racing-start-config:v1";

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); }
  };
}

function withMockLocalStorage(run) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();
  try {
    return run(globalThis.localStorage);
  } finally {
    if (previous === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previous;
    }
  }
}

test("normalizeCoastalPlayMode 对无效值回退到 island-tour", () => {
  assert.equal(normalizeCoastalPlayMode("free-cruise"), RACING_COASTAL_PLAY_MODES.FREE_CRUISE);
  assert.equal(normalizeCoastalPlayMode("island-tour"), RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
  assert.equal(normalizeCoastalPlayMode("bogus-mode"), RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
  assert.equal(normalizeCoastalPlayMode(undefined), RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
  assert.equal(normalizeCoastalPlayMode(null), RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
});

test("默认开赛配置为 version 4 且 coastalPlayMode 默认 island-tour", () => {
  const defaults = getDefaultRacingStartConfig();
  assert.equal(defaults.version, 4);
  assert.equal(defaults.coastalPlayMode, RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
  assert.equal(defaults.cameraMode, RACING_CAMERA_MODES.CHASE);
});

test("没有记忆时（无 localStorage）加载得到默认配置", () => {
  const previous = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    const loaded = loadActiveRacingStartConfig();
    assert.equal(loaded.coastalPlayMode, RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
    assert.equal(loaded.version, 4);
  } finally {
    if (previous !== undefined) globalThis.localStorage = previous;
  }
});

test("saveActiveRacingStartConfig 归一化并持久化 free-cruise 到既有存储键", () => {
  withMockLocalStorage((storage) => {
    const saved = saveActiveRacingStartConfig({
      playerCarId: "not-a-real-car",
      cameraMode: "cockpit",
      coastalPlayMode: "free-cruise"
    });

    assert.equal(saved.coastalPlayMode, RACING_COASTAL_PLAY_MODES.FREE_CRUISE);
    assert.equal(saved.version, 4);
    assert.equal(saved.cameraMode, RACING_CAMERA_MODES.HOOD);

    const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(persisted.coastalPlayMode, "free-cruise");
    assert.equal(persisted.version, 4);
  });
});

test("记忆存在时加载会还原上次的 coastalPlayMode", () => {
  withMockLocalStorage((storage) => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
      playerCarId: "veneno",
      cameraMode: "chase",
      coastalPlayMode: "free-cruise"
    }));

    const loaded = loadActiveRacingStartConfig();
    assert.equal(loaded.coastalPlayMode, RACING_COASTAL_PLAY_MODES.FREE_CRUISE);
  });
});

test("旧版（version 2，无 coastalPlayMode）记忆迁移为默认 island-tour", () => {
  withMockLocalStorage((storage) => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      playerCarId: "veneno",
      cameraMode: "hood"
    }));

    const loaded = loadActiveRacingStartConfig();
    assert.equal(loaded.version, 4);
    assert.equal(loaded.coastalPlayMode, RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
    assert.equal(loaded.cameraMode, RACING_CAMERA_MODES.HOOD);
  });
});

test("无效的持久化 coastalPlayMode 值在加载时回退为 island-tour", () => {
  withMockLocalStorage((storage) => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
      playerCarId: "veneno",
      cameraMode: "chase",
      coastalPlayMode: "chaos-mode"
    }));

    const loaded = loadActiveRacingStartConfig();
    assert.equal(loaded.coastalPlayMode, RACING_COASTAL_PLAY_MODES.ISLAND_TOUR);
  });
});

test("默认 difficulty 为 standard，无效值回退", () => {
  assert.equal(getDefaultRacingStartConfig().difficulty, "standard");
  withMockLocalStorage((storage) => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
      playerCarId: "veneno",
      cameraMode: "chase",
      coastalPlayMode: "island-tour",
      difficulty: "chaos"
    }));
    assert.equal(loadActiveRacingStartConfig().difficulty, "standard");
  });
});

test("saveActiveRacingStartConfig 持久化 difficulty", () => {
  withMockLocalStorage((storage) => {
    const saved = saveActiveRacingStartConfig({
      coastalPlayMode: "island-tour",
      difficulty: "hard"
    });
    assert.equal(saved.difficulty, "hard");
    assert.equal(saved.version, 4);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).difficulty, "hard");
  });
});
