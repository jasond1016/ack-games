import assert from "node:assert/strict";
import test from "node:test";

import { calculateRacingAudioState } from "../racing-audio.mjs";

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
