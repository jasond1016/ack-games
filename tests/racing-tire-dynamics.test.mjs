import assert from "node:assert/strict";
import test from "node:test";
import { calculateTireDynamics, tireSurfaceGrip } from "../racing-tire-dynamics.mjs";

test("泥土和草地抓地力低于柏油路", () => {
  assert.ok(tireSurfaceGrip("rally-dirt") < tireSurfaceGrip("road"));
  assert.ok(tireSurfaceGrip("ground") < tireSurfaceGrip("rally-dirt"));
});

test("低抓地全油门触发 TCS 并削减驱动力", () => {
  const result = calculateTireDynamics({
    signedSpeed: 8,
    throttle: 1,
    surfaceId: "rally-dirt",
    mass: 1250,
    engineForcePerWheel: 7000,
    drivenWheelIndexes: [2, 3]
  });
  assert.equal(result.tractionControlActive, true);
  assert.ok(result.engineScale < 1);
  assert.ok(result.wheels[2].longitudinalSlip > result.wheels[0].longitudinalSlip);
});

test("低抓地重刹触发 ABS，横向速度产生侧滑与尖叫", () => {
  const result = calculateTireDynamics({
    signedSpeed: 20,
    lateralSpeed: 6,
    brake: 1,
    steering: 0.7,
    surfaceId: "ground"
  });
  assert.equal(result.absActive, true);
  assert.ok(result.brakeScale < 1);
  assert.ok(result.maximumSlip > 0.2);
  assert.ok(result.squeal > 0);
});

test("离地车轮不产生滑移辅助", () => {
  const result = calculateTireDynamics({ throttle: 1, brake: 1, surfaceId: "ground", grounded: false });
  assert.equal(result.maximumSlip, 0);
  assert.equal(result.tractionControlActive, false);
  assert.equal(result.absActive, false);
});
