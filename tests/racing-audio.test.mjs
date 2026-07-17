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
