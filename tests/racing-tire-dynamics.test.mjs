import assert from "node:assert/strict";
import test from "node:test";
import { calculateTireDynamics, BRAKE_FRICTION_AUTHORITY, tireSurfaceGrip } from "../racing-tire-dynamics.mjs";

test("泥土和草地抓地力低于柏油路", () => {
  assert.ok(tireSurfaceGrip("rally-dirt") < tireSurfaceGrip("road"));
  assert.ok(tireSurfaceGrip("ground") < tireSurfaceGrip("rally-dirt"));
  assert.ok(tireSurfaceGrip("gravel") < tireSurfaceGrip("road"));
  assert.ok(tireSurfaceGrip("gravel") > tireSurfaceGrip("ground"));
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

test("TCS uses the speed-limited wheel force instead of the unrestricted engine request", () => {
  const unrestricted = calculateTireDynamics({
    signedSpeed: 28,
    throttle: 1,
    surfaceId: "road",
    mass: 1490,
    engineForcePerWheel: 5700,
    driveScale: 0.9,
    drivenWheelIndexes: [0, 1, 2, 3]
  });
  const speedLimited = calculateTireDynamics({
    signedSpeed: 28,
    throttle: 1,
    surfaceId: "road",
    mass: 1490,
    engineForcePerWheel: 5700,
    requestedEngineForcePerWheel: 1200,
    driveScale: 0.9,
    drivenWheelIndexes: [0, 1, 2, 3]
  });
  assert.equal(unrestricted.tractionControlActive, true);
  assert.equal(speedLimited.tractionControlActive, false);
  assert.equal(speedLimited.engineScale, 1);
});

test("低抓地重刹触发 ABS，横向速度产生侧滑与尖叫", () => {
  const result = calculateTireDynamics({
    signedSpeed: 20,
    lateralSpeed: 6,
    brake: 1,
    requestedBrakeImpulsePerWheel: 120,
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

test("identical drive demand produces more modeled slip at a lightly loaded wheel", () => {
  const result = calculateTireDynamics({
    signedSpeed: 12,
    throttle: 1,
    requestedEngineForcePerWheel: 3500,
    drivenWheelIndexes: [0, 1],
    wheelLoads: [1800, 4300, 3000, 3000]
  });
  assert.ok(result.wheels[0].longitudinalSlip > result.wheels[1].longitudinalSlip);
  assert.equal(result.wheels[0].normalLoad, 1800);
});

test("AWD shares equal total force with less peak driven-wheel slip than RWD", () => {
  const common = { signedSpeed: 10, throttle: 1, mass: 1250, surfaceId: "road" };
  const rwd = calculateTireDynamics({ ...common, requestedEngineForcePerWheel: 4000, drivenWheelIndexes: [2, 3] });
  const awd = calculateTireDynamics({ ...common, requestedEngineForcePerWheel: 2000, drivenWheelIndexes: [0, 1, 2, 3] });
  const peak = (result) => Math.max(...result.wheels
    .filter(({ driven }) => driven)
    .map(({ longitudinalSlip }) => longitudinalSlip));
  assert.ok(peak(awd) < peak(rwd));
});

test("ABS independently releases a light wheel and recovers after slip falls", () => {
  const braking = calculateTireDynamics({
    signedSpeed: 20,
    brake: 1,
    requestedBrakeImpulsePerWheel: 100,
    wheelLoads: [1200, 8000, 2800, 2800],
    deltaSeconds: 1 / 60
  });
  assert.equal(braking.wheels[0].absActive, true);
  assert.equal(braking.wheels[1].absActive, false);
  assert.ok(braking.wheels[0].brakeScale < braking.wheels[1].brakeScale);

  const recovered = calculateTireDynamics({
    signedSpeed: 20,
    brake: 0,
    wheelLoads: [1200, 8000, 2800, 2800],
    previousWheelState: braking.wheels,
    deltaSeconds: 1 / 60
  });
  assert.ok(recovered.wheels[0].brakeScale > braking.wheels[0].brakeScale);
});

test("ABS pressure converges toward each wheel's available brake impulse without oscillating", () => {
  let wheels = null;
  const lightWheelPressures = [];
  for (let index = 0; index < 120; index += 1) {
    const result = calculateTireDynamics({
      signedSpeed: 20,
      requestedBrakeImpulsePerWheel: 100,
      wheelLoads: [2400, 3600, 2400, 3600],
      previousWheelState: wheels,
      deltaSeconds: 1 / 60
    });
    wheels = result.wheels;
    lightWheelPressures.push(wheels[0].brakeScale);
  }

  const expectedPressure = 2400 * tireSurfaceGrip("road") * BRAKE_FRICTION_AUTHORITY / 60 / 100;
  assert.ok(Math.abs(wheels[0].brakeScale - expectedPressure) < 1e-9);
  assert.ok(wheels[0].brakeScale < wheels[1].brakeScale);
  assert.ok(lightWheelPressures.slice(-30).every((pressure) =>
    Math.abs(pressure - expectedPressure) < 1e-9
  ));
});

test("actual brake impulse drives ABS regardless of pedal semantics", () => {
  const braking = calculateTireDynamics({
    signedSpeed: -12,
    brake: 0,
    requestedBrakeImpulsePerWheel: 100,
    wheelLoads: [2400, 2400, 2400, 2400]
  });
  const reversing = calculateTireDynamics({
    signedSpeed: -12,
    brake: 1,
    requestedEngineForcePerWheel: -5000,
    requestedBrakeImpulsePerWheel: 0,
    drivenWheelIndexes: [2, 3],
    wheelLoads: [2400, 2400, 2400, 2400]
  });

  assert.equal(braking.absActive, true);
  assert.equal(reversing.absActive, false);
  assert.equal(reversing.tractionControlActive, true);
});
