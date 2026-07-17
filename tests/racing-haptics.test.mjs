import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateRacingHapticsState,
  createRacingHapticsController
} from "../racing-haptics.mjs";

test("氮气和粗糙路面会增强手柄振动", () => {
  const road = calculateRacingHapticsState({ connected: true, signedSpeed: 20, throttle: 1 });
  const dirt = calculateRacingHapticsState({ connected: true, signedSpeed: 20, throttle: 1, surfaceId: "rally-dirt" });
  const boost = calculateRacingHapticsState({ connected: true, signedSpeed: 20, throttle: 1, boostActive: true });
  assert.ok(dirt.weakMagnitude > road.weakMagnitude);
  assert.ok(boost.weakMagnitude > dirt.weakMagnitude);
  assert.ok(boost.strongMagnitude > road.strongMagnitude);
});

test("离地减弱振动，暂停或未连接时停止振动", () => {
  const grounded = calculateRacingHapticsState({ connected: true, signedSpeed: 30, throttle: 1 });
  const airborne = calculateRacingHapticsState({ connected: true, signedSpeed: 30, throttle: 1, grounded: false });
  assert.ok(airborne.weakMagnitude < grounded.weakMagnitude);
  assert.deepEqual(calculateRacingHapticsState({ connected: false }), {
    weakMagnitude: 0, strongMagnitude: 0, boostActive: false, enabled: false
  });
  assert.equal(calculateRacingHapticsState({ connected: true, enabled: false }).weakMagnitude, 0);
});

test("控制器持续刷新双马达振动并可发送碰撞脉冲", () => {
  const effects = [];
  let timestamp = 0;
  const actuator = {
    playEffect(type, options) { effects.push({ type, options }); return Promise.resolve("complete"); },
    reset() { effects.push({ type: "reset" }); return Promise.resolve("complete"); }
  };
  const gamepad = { connected: true, vibrationActuator: actuator };
  const controller = createRacingHapticsController({
    navigatorObject: { getGamepads: () => [gamepad] },
    now: () => timestamp
  });
  controller.update({ gamepadIndex: 0, signedSpeed: 25, throttle: 1 });
  timestamp += 100;
  controller.update({ gamepadIndex: 0, signedSpeed: 30, boostActive: true });
  controller.pulseImpact(0.8);
  assert.equal(effects.filter((effect) => effect.type === "dual-rumble").length, 3);
  assert.ok(effects.at(-1).options.strongMagnitude >= 0.88);
  assert.equal(controller.getState().supported, true);
  controller.stop();
  assert.equal(effects.at(-1).type, "reset");
});
