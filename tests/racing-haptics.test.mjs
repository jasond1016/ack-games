import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRacingHapticsState,
  createRacingHapticsController
} from "../racing-haptics.mjs";

function createHapticsHarness({ initialTimestamp = 0, refreshMilliseconds = 50 } = {}) {
  const effects = [];
  let timestamp = initialTimestamp;
  const actuator = {
    playEffect(type, options) { effects.push({ type, options }); return Promise.resolve("complete"); },
    reset() { effects.push({ type: "reset" }); return Promise.resolve("complete"); }
  };
  const controller = createRacingHapticsController({
    navigatorObject: {
      getGamepads: () => [{ connected: true, vibrationActuator: actuator }]
    },
    now: () => timestamp,
    refreshMilliseconds
  });
  return {
    controller,
    effects,
    setTimestamp(value) { timestamp = value; }
  };
}

test("普通柏油路巡航保持安静，特殊事件才产生反馈", () => {
  const road = calculateRacingHapticsState({ connected: true, signedSpeed: 30, throttle: 1 });
  const dirt = calculateRacingHapticsState({ connected: true, signedSpeed: 30, throttle: 1, surfaceId: "rally-dirt" });
  const boost = calculateRacingHapticsState({ connected: true, signedSpeed: 30, throttle: 1, boostActive: true });
  assert.equal(road.weakMagnitude, 0);
  assert.equal(road.strongMagnitude, 0);
  assert.ok(dirt.weakMagnitude > 0);
  assert.ok(boost.weakMagnitude > 0);
  assert.ok(boost.strongMagnitude > 0);
  assert.equal(calculateRacingHapticsState({
    connected: true, signedSpeed: 0, surfaceId: "rally-dirt"
  }).weakMagnitude, 0);
});

test("离地减弱振动，暂停或未连接时停止振动", () => {
  const grounded = calculateRacingHapticsState({ connected: true, signedSpeed: 30, surfaceId: "rally-dirt" });
  const airborne = calculateRacingHapticsState({ connected: true, signedSpeed: 30, surfaceId: "rally-dirt", grounded: false });
  assert.ok(grounded.weakMagnitude > 0);
  assert.equal(airborne.weakMagnitude, 0);
  assert.equal(airborne.strongMagnitude, 0);
  assert.deepEqual(calculateRacingHapticsState({ connected: false }), {
    weakMagnitude: 0, strongMagnitude: 0, boostActive: false, enabled: false
  });
  assert.equal(calculateRacingHapticsState({ connected: true, enabled: false }).weakMagnitude, 0);
});

test("碰撞脉冲具有优先级，不会立即被持续路面反馈覆盖", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();
  controller.update({ gamepadIndex: 0, signedSpeed: 25, surfaceId: "rally-dirt" });
  controller.pulseImpact(0.8);
  const impactEffectCount = effects.filter((effect) => effect.type === "dual-rumble").length;
  setTimestamp(100);
  controller.update({ gamepadIndex: 0, signedSpeed: 30, surfaceId: "rally-dirt" });
  assert.equal(effects.filter((effect) => effect.type === "dual-rumble").length, impactEffectCount);
  setTimestamp(300);
  controller.update({ gamepadIndex: 0, signedSpeed: 30, surfaceId: "rally-dirt" });
  assert.ok(effects.filter((effect) => effect.type === "dual-rumble").length > impactEffectCount);
  assert.equal(controller.getState().supported, true);
  controller.stop();
  assert.equal(effects.at(-1).type, "reset");
});

test("轮胎滑移与 ABS 会增加手柄反馈", () => {
  const calm = calculateRacingHapticsState({ connected: true, signedSpeed: 20 });
  const belowThreshold = calculateRacingHapticsState({ connected: true, signedSpeed: 20, tireSlip: 0.08 });
  const sliding = calculateRacingHapticsState({ connected: true, signedSpeed: 20, tireSlip: 0.8, absActive: true });
  assert.deepEqual(belowThreshold, calm);
  assert.ok(sliding.weakMagnitude > calm.weakMagnitude);
  assert.ok(sliding.strongMagnitude > calm.strongMagnitude);
});

test("换挡产生短促脉冲，并在其结束后恢复路面反馈", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();

  controller.update({ gamepadIndex: 0, shiftCount: 0 });
  setTimestamp(100);
  controller.update({ gamepadIndex: 0, shiftCount: 1, signedSpeed: 20, surfaceId: "rally-dirt" });
  const shift = effects.findLast((effect) => effect.type === "dual-rumble");
  assert.equal(shift.options.duration, 75);
  assert.ok(shift.options.strongMagnitude > shift.options.weakMagnitude);
  setTimestamp(150);
  controller.update({ gamepadIndex: 0, shiftCount: 1, signedSpeed: 20, surfaceId: "rally-dirt" });
  assert.equal(effects.filter((effect) => effect.type === "dual-rumble").length, 1);
  setTimestamp(180);
  controller.update({ gamepadIndex: 0, shiftCount: 1, signedSpeed: 20, surfaceId: "rally-dirt" });
  assert.equal(effects.filter((effect) => effect.type === "dual-rumble").length, 2);
  assert.equal(effects.at(-1).options.duration, 58);
});

test("粗糙路面、ABS 与 TCS 使用不同的间歇节奏", () => {
  const rough = createHapticsHarness({ refreshMilliseconds: 1 });
  rough.controller.update({ gamepadIndex: 0, signedSpeed: 20, surfaceId: "rally-dirt" });
  rough.setTimestamp(50);
  rough.controller.update({ gamepadIndex: 0, signedSpeed: 20, surfaceId: "rally-dirt" });
  assert.ok(rough.effects[1].options.weakMagnitude < rough.effects[0].options.weakMagnitude);

  const abs = createHapticsHarness({ initialTimestamp: 100, refreshMilliseconds: 1 });
  abs.controller.update({ gamepadIndex: 0, signedSpeed: 20, absActive: true });
  abs.setTimestamp(120);
  abs.controller.update({ gamepadIndex: 0, signedSpeed: 20, absActive: true });
  assert.ok(abs.effects[1].options.strongMagnitude < abs.effects[0].options.strongMagnitude);

  const tcs = createHapticsHarness({ initialTimestamp: 100, refreshMilliseconds: 1 });
  tcs.controller.update({ gamepadIndex: 0, signedSpeed: 20, tractionControlActive: true });
  tcs.setTimestamp(120);
  tcs.controller.update({ gamepadIndex: 0, signedSpeed: 20, tractionControlActive: true });
  assert.ok(tcs.effects[1].options.weakMagnitude > tcs.effects[0].options.weakMagnitude);
});

test("氮气只在启动时产生冲击，之后保持较弱反馈", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();
  controller.update({ gamepadIndex: 0, signedSpeed: 20, boostActive: false });
  setTimestamp(100);
  controller.update({ gamepadIndex: 0, signedSpeed: 20, boostActive: true });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].options.duration, 95);
  setTimestamp(150);
  controller.update({ gamepadIndex: 0, signedSpeed: 20, boostActive: true });
  assert.equal(effects.length, 1);
  setTimestamp(200);
  controller.update({ gamepadIndex: 0, signedSpeed: 20, boostActive: true });
  assert.equal(effects.length, 2);
  assert.ok(effects[1].options.strongMagnitude < effects[0].options.strongMagnitude);
});

test("氮气与换挡同时开始时，会在换挡冲击后补发氮气启动冲击", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();
  controller.update({ gamepadIndex: 0, shiftCount: 0, boostActive: false });
  setTimestamp(100);
  controller.update({ gamepadIndex: 0, shiftCount: 1, boostActive: true });
  setTimestamp(180);
  controller.update({ gamepadIndex: 0, shiftCount: 1, boostActive: true });
  assert.deepEqual(effects.map((effect) => effect.options.duration), [75, 95]);
});

test("暂停立即停止瞬态反馈，恢复时不会补发暂停期间的事件", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();
  controller.update({ gamepadIndex: 0, shiftCount: 0 });
  controller.pulseImpact(1);
  setTimestamp(10);
  controller.update({ gamepadIndex: 0, shiftCount: 1, boostActive: true, enabled: false });
  assert.equal(effects.at(-1).type, "reset");
  setTimestamp(100);
  controller.update({ gamepadIndex: 0, shiftCount: 1, boostActive: true });
  assert.equal(effects.some((effect) => effect.options?.duration === 75), false);
  assert.equal(effects.some((effect) => effect.options?.duration === 95), false);
});

test("较短的新瞬态替换旧瞬态后，按新结束时间恢复反馈", () => {
  const { controller, effects, setTimestamp } = createHapticsHarness();
  controller.update({ gamepadIndex: 0, signedSpeed: 20, surfaceId: "rally-dirt" });
  controller.pulseImpact(0.8);
  setTimestamp(10);
  controller.pulseLanding(0);
  const landing = effects.at(-1);
  assert.equal(landing.options.duration, 65);
  assert.ok(landing.options.strongMagnitude > landing.options.weakMagnitude);
  setTimestamp(80);
  controller.update({ gamepadIndex: 0, signedSpeed: 20, surfaceId: "rally-dirt" });
  assert.equal(effects.at(-1).options.duration, 58);
});
