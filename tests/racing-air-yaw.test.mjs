import assert from "node:assert/strict";
import test from "node:test";

import {
  AIR_YAW_AUTHORITY,
  AIR_YAW_AUTHORITY_MAX,
  AIR_YAW_AUTHORITY_MIN,
  AIR_YAW_ZERO_INPUT_DRIFT_LIMIT,
  GROUND_YAW_RATE_REFERENCE,
  clampAirYawAuthority,
  integrateAirYawHeading,
  resolveAirYawRate,
  resolveAirYawRateMax,
  rotatePlanarVelocity,
  stepAirAttitudeAssist
} from "../racing-air-yaw.mjs";

test("空中偏航权威落在 A1 契约带内", () => {
  assert.ok(AIR_YAW_AUTHORITY >= AIR_YAW_AUTHORITY_MIN);
  assert.ok(AIR_YAW_AUTHORITY <= AIR_YAW_AUTHORITY_MAX);
  assert.equal(clampAirYawAuthority(0.05), AIR_YAW_AUTHORITY_MIN);
  assert.equal(clampAirYawAuthority(0.9), AIR_YAW_AUTHORITY_MAX);
  assert.equal(clampAirYawAuthority(Number.NaN), AIR_YAW_AUTHORITY);
});

test("A1：空中满舵峰值 yaw rate 相对地面参考 ∈ [0.15, 0.30]", () => {
  const airMax = resolveAirYawRateMax();
  const ratio = airMax / GROUND_YAW_RATE_REFERENCE;
  assert.ok(ratio >= AIR_YAW_AUTHORITY_MIN);
  assert.ok(ratio <= AIR_YAW_AUTHORITY_MAX);
  const fullLeft = resolveAirYawRate({ airborne: true, steering: 1 });
  const fullRight = resolveAirYawRate({ airborne: true, steering: -1 });
  assert.equal(fullLeft, airMax);
  assert.equal(fullRight, -airMax);
});

test("贴地或零输入时目标 yaw rate 为 0（A2）", () => {
  assert.equal(resolveAirYawRate({ airborne: false, steering: 1 }), 0);
  assert.equal(resolveAirYawRate({ airborne: true, steering: 0 }), 0);
  assert.equal(resolveAirYawRate({ airborne: true, steering: 1e-5 }), 0);
});

test("A3：同时长空中满舵 Δheading 明显小于陆地参考", () => {
  const flightSeconds = 1.5;
  const airDelta = Math.abs(resolveAirYawRate({ airborne: true, steering: 1 }) * flightSeconds);
  const groundDelta = GROUND_YAW_RATE_REFERENCE * flightSeconds;
  assert.ok(airDelta / groundDelta < 0.3);
});

test("attitude assist 步进：有舵则偏航，无舵不漂移", () => {
  const steered = stepAirAttitudeAssist({
    assistedHeading: 0.5,
    assistedVelocityX: 20,
    assistedVelocityZ: 0,
    steering: 1,
    deltaSeconds: 0.1
  });
  assert.ok(steered.yawDelta > 0);
  assert.ok(steered.assistedHeading > 0.5);

  const idle = stepAirAttitudeAssist({
    assistedHeading: 0.5,
    assistedVelocityX: 20,
    assistedVelocityZ: 0,
    steering: 0,
    deltaSeconds: 0.1
  });
  assert.equal(idle.yawDelta, 0);
  assert.equal(idle.assistedHeading, 0.5);
  assert.equal(idle.assistedVelocityX, 20);
  assert.equal(idle.assistedVelocityZ, 0);

  const drift = Math.abs(idle.assistedHeading - 0.5);
  assert.ok(drift < AIR_YAW_ZERO_INPUT_DRIFT_LIMIT);
});

test("航向积分与平面速度随偏航同转", () => {
  assert.equal(integrateAirYawHeading(1, 0.5, 0.2), 1.1);
  const rotated = rotatePlanarVelocity(10, 0, Math.PI / 2);
  assert.ok(Math.abs(rotated.x) < 1e-10);
  assert.ok(Math.abs(rotated.z + 10) < 1e-10);
});
