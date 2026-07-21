import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRacingAudioState,
  DEFAULT_NITRO_AUDIO_PRESET_ID,
  listNitroAudioPresets,
  loadStoredNitroAudioPresetId,
  normalizeNitroAudioPresetId,
  RACING_BGM,
  RACING_NITRO_AUDIO_PRESETS,
  saveStoredNitroAudioPresetId
} from "../racing-audio.mjs";

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

test("发动机转速随车速和油门升高", () => {
  const idle = calculateRacingAudioState();
  const revving = calculateRacingAudioState({ throttle: 1 });
  const driving = calculateRacingAudioState({ signedSpeed: 40, throttle: 1 });
  assert.ok(revving.rpm > idle.rpm);
  assert.ok(driving.rpm > revving.rpm);
  assert.ok(driving.ignitionFrequency > revving.ignitionFrequency);
});

test("倒车也按发动机负载发声且转速不超过红线", () => {
  const reverse = calculateRacingAudioState({ signedSpeed: -18, throttle: 1 });
  const overspeed = calculateRacingAudioState({ signedSpeed: 500, throttle: 1 });
  assert.ok(reverse.rpm > 900);
  assert.ok(overspeed.rpm <= 7800);
});

test("氮气启用独立喷流声，暂停时所有声部静音", () => {
  const boost = calculateRacingAudioState({ signedSpeed: 30, throttle: 1, boostActive: true });
  assert.equal(boost.boostActive, true);
  assert.ok(boost.boostGain > 0);
  const paused = calculateRacingAudioState({ signedSpeed: 30, throttle: 1, boostActive: true, enabled: false });
  assert.equal(paused.engineGain, 0);
  assert.equal(paused.harmonicGain, 0);
  assert.equal(paused.boostGain, 0);
});

test("存在动力系统转速时音效直接使用真实 RPM", () => {
  const state = calculateRacingAudioState({
    signedSpeed: 0,
    throttle: 0,
    engineRpm: 6420,
    idleRpm: 850,
    maximumRpm: 8500
  });
  assert.equal(state.rpm, 6420);
  assert.ok(state.rpmRatio > 0.7);
});

test("明显轮胎滑移会产生独立尖叫声部", () => {
  assert.ok(calculateRacingAudioState({ tireSlip: 0.75 }).tireGain > 0);
  assert.equal(calculateRacingAudioState({ tireSlip: 0.02 }).tireGain, 0);
});

test("audio environment defaults to road and shapes tunnel acoustics", () => {
  const road = calculateRacingAudioState();
  const tunnel = calculateRacingAudioState({ environment: "tunnel" });
  assert.equal(road.environment, "road");
  assert.equal(tunnel.environment, "tunnel");
  assert.ok(tunnel.environmentGain < road.environmentGain);
  assert.ok(tunnel.environmentFilterFrequency < road.environmentFilterFrequency);
  assert.ok(tunnel.environmentResonance > road.environmentResonance);
});

test("rally environment adds a subtle noise layer that still obeys mute", () => {
  const rally = calculateRacingAudioState({ environment: "rally" });
  const muted = calculateRacingAudioState({ environment: "rally", enabled: false });
  assert.equal(rally.environment, "rally");
  assert.ok(rally.environmentNoiseGain > 0);
  assert.equal(muted.environmentNoiseGain, 0);
  assert.equal(muted.environmentGain, 0);
});

test("氮气音效预设 id 集合与稳定命名一致", () => {
  const ids = listNitroAudioPresets().map((preset) => preset.id);
  assert.deepEqual(ids, ["current", "jet-whoosh", "deep-rumble", "clean-electric"]);
  assert.equal(RACING_NITRO_AUDIO_PRESETS.length, 4);
  for (const preset of listNitroAudioPresets()) {
    assert.equal(typeof preset.label, "string");
    assert.ok(preset.label.length > 0);
  }
  assert.equal(DEFAULT_NITRO_AUDIO_PRESET_ID, "jet-whoosh");
});

test("默认 BGM 为 Hot Roadway 且默认增益低于引擎主电平", () => {
  assert.equal(RACING_BGM.id, "hot-roadway");
  assert.ok(RACING_BGM.url.includes("hot-roadway-bpm160.ogg"));
  assert.ok(RACING_BGM.playingGain > 0);
  assert.ok(RACING_BGM.duckedGain < RACING_BGM.playingGain);
  assert.ok(RACING_BGM.playingGain < 0.2);
});

test("normalizeNitroAudioPresetId 对无效值回退到出厂默认 jet-whoosh", () => {
  assert.equal(normalizeNitroAudioPresetId("jet-whoosh"), "jet-whoosh");
  assert.equal(normalizeNitroAudioPresetId("deep-rumble"), "deep-rumble");
  assert.equal(normalizeNitroAudioPresetId("clean-electric"), "clean-electric");
  assert.equal(normalizeNitroAudioPresetId("current"), "current");
  assert.equal(normalizeNitroAudioPresetId("not-a-real-preset"), "jet-whoosh");
  assert.equal(normalizeNitroAudioPresetId(undefined), "jet-whoosh");
  assert.equal(normalizeNitroAudioPresetId(null), "jet-whoosh");
});

test("氮气启用时不同预设的音色参数彼此不同", () => {
  const boostArgs = { signedSpeed: 30, throttle: 1, boostActive: true };
  const current = calculateRacingAudioState({ ...boostArgs, nitroAudioPreset: "current" });
  const jetWhoosh = calculateRacingAudioState({ ...boostArgs, nitroAudioPreset: "jet-whoosh" });
  const deepRumble = calculateRacingAudioState({ ...boostArgs, nitroAudioPreset: "deep-rumble" });
  const cleanElectric = calculateRacingAudioState({ ...boostArgs, nitroAudioPreset: "clean-electric" });

  const variants = [current, jetWhoosh, deepRumble, cleanElectric];
  for (const variant of variants) {
    assert.equal(variant.boostActive, true);
    assert.ok(variant.boostGain > 0);
  }

  const boostFrequencies = new Set(variants.map((variant) => variant.boostFrequency));
  const boostFilterFrequencies = new Set(variants.map((variant) => variant.boostFilterFrequency));
  const boostFilterQs = new Set(variants.map((variant) => variant.boostFilterQ));
  const boostOscillatorTypes = new Set(variants.map((variant) => variant.boostOscillatorType));
  const boostGains = new Set(variants.map((variant) => variant.boostGain));
  const boostSignatures = new Set(variants.map((variant) => JSON.stringify([
    variant.boostGain,
    variant.boostFrequency,
    variant.boostFilterType,
    variant.boostFilterFrequency,
    variant.boostFilterQ,
    variant.boostOscillatorType
  ])));

  // Every preset must sound distinct overall (unique full boost signature), even though
  // individual sub-fields like filter type may coincidentally repeat across presets.
  assert.equal(boostSignatures.size, 4);
  assert.equal(boostFrequencies.size, 4);
  assert.equal(boostFilterFrequencies.size, 4);
  assert.equal(boostFilterQs.size, 4);
  assert.equal(boostOscillatorTypes.size, 4);
  assert.equal(boostGains.size, 4);

  assert.equal(current.nitroAudioPreset, "current");
  assert.equal(jetWhoosh.nitroAudioPreset, "jet-whoosh");
  assert.equal(deepRumble.nitroAudioPreset, "deep-rumble");
  assert.equal(cleanElectric.nitroAudioPreset, "clean-electric");
});

test("无效预设名在氮气启用时安全回退到出厂默认 jet-whoosh 的参数", () => {
  const fallback = calculateRacingAudioState({
    signedSpeed: 30,
    throttle: 1,
    boostActive: true,
    nitroAudioPreset: "does-not-exist"
  });
  const jetWhoosh = calculateRacingAudioState({
    signedSpeed: 30,
    throttle: 1,
    boostActive: true,
    nitroAudioPreset: "jet-whoosh"
  });
  assert.equal(fallback.nitroAudioPreset, "jet-whoosh");
  assert.equal(fallback.boostFrequency, jetWhoosh.boostFrequency);
  assert.equal(fallback.boostFilterType, jetWhoosh.boostFilterType);
});

test("氮气未启用时非氮气声部字段在各预设下保持一致", () => {
  const idleArgs = { signedSpeed: 12, throttle: 0.4, boostActive: false, tireSlip: 0.3, environment: "tunnel" };
  const presetIds = ["current", "jet-whoosh", "deep-rumble", "clean-electric"];
  const states = presetIds.map((nitroAudioPreset) => calculateRacingAudioState({ ...idleArgs, nitroAudioPreset }));

  for (const state of states) {
    assert.equal(state.boostActive, false);
    assert.equal(state.boostGain, 0);
  }

  const nonBoostFields = [
    "rpm",
    "rpmRatio",
    "ignitionFrequency",
    "engineGain",
    "harmonicGain",
    "filterFrequency",
    "tireGain",
    "environment",
    "environmentGain",
    "environmentFilterFrequency",
    "environmentResonance",
    "environmentNoiseGain",
    "enabled"
  ];
  const reference = states[0];
  for (const state of states.slice(1)) {
    for (const field of nonBoostFields) {
      assert.equal(state[field], reference[field], `字段 ${field} 应与预设无关`);
    }
  }
});

test("loadStoredNitroAudioPresetId 无存储时回退到出厂默认 jet-whoosh", () => {
  const previous = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.equal(loadStoredNitroAudioPresetId(), "jet-whoosh");
  } finally {
    if (previous !== undefined) globalThis.localStorage = previous;
  }
});

test("saveStoredNitroAudioPresetId 归一化并持久化到既有存储键", () => {
  withMockLocalStorage((storage) => {
    const saved = saveStoredNitroAudioPresetId("jet-whoosh");
    assert.equal(saved, "jet-whoosh");
    assert.equal(storage.getItem("ack-games:racing-nitro-audio:v1"), "jet-whoosh");

    const loaded = loadStoredNitroAudioPresetId();
    assert.equal(loaded, "jet-whoosh");
  });
});

test("持久化的无效预设值在加载时回退为出厂默认，允许显式回滚到 current", () => {
  withMockLocalStorage((storage) => {
    storage.setItem("ack-games:racing-nitro-audio:v1", "chaos-preset");
    assert.equal(loadStoredNitroAudioPresetId(), "jet-whoosh");

    saveStoredNitroAudioPresetId("deep-rumble");
    assert.equal(loadStoredNitroAudioPresetId(), "deep-rumble");

    const rolledBack = saveStoredNitroAudioPresetId("current");
    assert.equal(rolledBack, "current");
    assert.equal(loadStoredNitroAudioPresetId(), "current");
  });
});
