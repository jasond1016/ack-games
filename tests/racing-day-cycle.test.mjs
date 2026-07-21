import assert from "node:assert/strict";
import test from "node:test";
import {
  COASTAL_DAY_CYCLE_SECONDS,
  createDayCycleController,
  normalizeDayCyclePhaseId,
  resolveDayCyclePhaseId,
  resolveDayCycleProgress,
  resolveDayCycleState,
  sampleDayCycleLighting,
  wrapDayCycleProgress
} from "../racing-day-cycle.mjs";

test("day cycle period defaults to a slow multi-minute loop", () => {
  assert.equal(COASTAL_DAY_CYCLE_SECONDS, 240);
});

test("progress wraps and maps to day/dusk/night/dawn bands", () => {
  assert.equal(wrapDayCycleProgress(1.25), 0.25);
  assert.equal(resolveDayCyclePhaseId(0.1), "day");
  assert.equal(resolveDayCyclePhaseId(0.35), "dusk");
  assert.equal(resolveDayCyclePhaseId(0.55), "night");
  assert.equal(resolveDayCyclePhaseId(0.9), "dawn");
});

test("frozen day/night pins progress and lighting", () => {
  assert.equal(normalizeDayCyclePhaseId("Night"), "night");
  assert.equal(normalizeDayCyclePhaseId("auto"), null);
  const night = resolveDayCycleState({ elapsedSeconds: 10, frozenPhase: "night" });
  assert.equal(night.phase, "night");
  assert.equal(night.frozenPhase, "night");
  assert.ok(night.lighting.exposureScale < 0.7);
  assert.ok(night.lighting.headlightBoost > 0.5);

  const day = resolveDayCycleState({ elapsedSeconds: 200, frozenPhase: "day" });
  assert.equal(day.phase, "day");
  assert.ok(day.lighting.sunIntensity > 2);
});

test("sample lighting interpolates and night is darker than day", () => {
  const day = sampleDayCycleLighting(0.1);
  const night = sampleDayCycleLighting(0.55);
  assert.ok(night.exposureScale < day.exposureScale);
  assert.ok(night.environmentIntensity < day.environmentIntensity);
  assert.ok(night.sunIntensity < day.sunIntensity);
});

test("controller advances only when not frozen or paused", () => {
  const cycle = createDayCycleController();
  cycle.advance(60);
  const mid = cycle.snapshot();
  assert.ok(mid.progress > 0);
  cycle.setFrozenPhase("night");
  const before = cycle.getElapsedSeconds();
  cycle.advance(120);
  assert.equal(cycle.getElapsedSeconds(), before);
  assert.equal(cycle.snapshot().phase, "night");
  cycle.setFrozenPhase(null);
  cycle.advance(30, { paused: true });
  assert.equal(cycle.getElapsedSeconds(), before);
  cycle.advance(30, { paused: false });
  assert.ok(cycle.getElapsedSeconds() > before);

  const progressAt120 = resolveDayCycleProgress({ elapsedSeconds: 120 });
  assert.equal(progressAt120, 0.5);
});
