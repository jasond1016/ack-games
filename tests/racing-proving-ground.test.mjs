import assert from "node:assert/strict";
import test from "node:test";
import { createProvingGroundTestRunner } from "../racing-proving-ground.mjs";

test("0-100 protocol records elapsed time and distance", () => {
  const runner = createProvingGroundTestRunner();
  assert.equal(runner.start("zero-to-100", { x: 0, z: 0 }), true);
  assert.deepEqual(runner.controls(), { throttle: 1, brake: 0, steering: 0 });
  runner.update({ x: 20, z: 0, speedKmh: 60, maximumTireSlip: 0.2, tractionControlActive: true, shiftCount: 1, gear: 1, engineRpm: 6000, torqueRatio: 0.9, drivetrainScale: 0.9, tcsEngineScale: 0.8, engineForcePerWheel: 4200, surfaceId: "road" }, 2);
  const result = runner.update({ x: 55, z: 0, speedKmh: 101, maximumTireSlip: 0.35, shiftCount: 3, gear: 2, engineRpm: 7000, torqueRatio: 0.8, drivetrainScale: 0.5, tcsEngineScale: 1, engineForcePerWheel: 3500, surfaceId: "road" }, 2);
  assert.equal(result.status, "completed");
  assert.equal(result.zeroTo100Seconds, 4);
  assert.equal(result.distanceMeters, 55);
  assert.equal(result.maximumTireSlip, 0.35);
  assert.equal(result.tractionControlActiveSeconds, 2);
  assert.equal(result.gearShiftCount, 3);
  assert.equal(result.roadContactRatio, 1);
  assert.equal(result.drivetrainTrace.length, 2);
  assert.deepEqual(result.drivetrainTrace.at(-1), {
    elapsedSeconds: 4,
    speedKmh: 101,
    gear: 2,
    engineRpm: 7000,
    torqueRatio: 0.8,
    drivetrainScale: 0.5,
    tcsEngineScale: 1,
    maximumTireSlip: 0.35,
    engineForcePerWheel: 3500
  });
});

test("0-200 protocol keeps full throttle through automatic shifts", () => {
  const runner = createProvingGroundTestRunner();
  assert.equal(runner.start("zero-to-200", { x: 0, z: 0 }), true);
  assert.deepEqual(runner.controls(), { throttle: 1, brake: 0, steering: 0 });
  runner.update({ x: 80, z: 0, speedKmh: 120, shiftCount: 2, gear: 3, surfaceId: "road" }, 5);
  assert.equal(runner.snapshot().status, "running");
  const result = runner.update({ x: 310, z: 0, speedKmh: 201, shiftCount: 4, gear: 5, surfaceId: "road" }, 7);
  assert.equal(result.status, "completed");
  assert.equal(result.zeroTo200Seconds, 12);
  assert.equal(result.distanceMeters, 310);
  assert.equal(result.gearShiftCount, 4);
});

test("100-0 protocol accelerates before measuring full braking", () => {
  const runner = createProvingGroundTestRunner();
  runner.start("100-to-zero", { x: 0, z: 0 });
  runner.update({
    x: 40,
    z: 0,
    speedKmh: 102,
    maximumTireSlip: 0.8,
    tractionControlActive: true,
    shiftCount: 2,
    surfaceId: "ground"
  }, 4);
  assert.equal(runner.snapshot().phase, "braking");
  assert.deepEqual(runner.controls(), { throttle: 0, brake: 1, steering: 0 });
  const result = runner.update({
    x: 76,
    z: 0,
    speedKmh: 0.5,
    maximumTireSlip: 0.3,
    absActive: true,
    shiftCount: 2,
    surfaceId: "road"
  }, 2.5);
  assert.equal(result.status, "completed");
  assert.equal(result.brakingSeconds, 2.5);
  assert.equal(result.brakingDistanceMeters, 36);
  assert.equal(result.startSpeedKmh, 102);
  assert.equal(result.maximumTireSlip, 0.3);
  assert.equal(result.absActiveSeconds, 2.5);
  assert.equal(result.tractionControlActiveSeconds, 0);
  assert.equal(result.gearShiftCount, 0);
  assert.equal(result.roadContactRatio, 1);
});

test("skidpad protocol measures geometric radius around the 60 m circle", () => {
  const runner = createProvingGroundTestRunner();
  runner.start("skidpad", { x: 30, z: 40, heading: 0 });
  for (let index = 1; index <= 12; index += 1) {
    const angle = index * 0.5;
    runner.update({
      speedKmh: 54,
      heading: -angle,
      x: Math.cos(angle) * 30,
      z: 40 + Math.sin(angle) * 30
    }, 1);
  }
  const result = runner.snapshot();
  assert.equal(result.status, "completed");
  assert.equal(result.maximumLateralAcceleration, 7.5);
  assert.equal(result.averageRadiusMeters, 30);
});

test("fixed-steer protocol measures loss of curvature gain as speed settles", () => {
  const runner = createProvingGroundTestRunner();
  runner.start("fixed-steer", { x: -100, z: 20, heading: 0, speedKmh: 0 });
  assert.deepEqual(runner.controls(), { throttle: 1, brake: 0, steering: 0 });
  runner.update({ heading: 0, speedKmh: 50, steeringAngle: 0 }, 1);
  assert.equal(runner.snapshot().phase, "steering");
  assert.deepEqual(runner.controls(), { throttle: 0.28, brake: 0, steering: -0.35 });
  for (let index = 1; index <= 8; index += 1) {
    const yawRate = index <= 2 ? 0.2 : 0.1;
    const previousHeading = index <= 2 ? (index - 1) * 0.2 : 0.4 + (index - 3) * 0.1;
    runner.update({
      heading: previousHeading + yawRate,
      speedKmh: 54,
      steeringAngle: -0.2,
      surfaceId: "road"
    }, 1);
  }
  const result = runner.snapshot();
  assert.equal(result.status, "completed");
  assert.equal(result.curvatureGainRetention, 0.5);
  assert.equal(result.steadyRadiusMeters, 150);
});

test("gravel contact still counts toward proving roadContactRatio", () => {
  const runner = createProvingGroundTestRunner();
  runner.start("zero-to-100", { x: 0, z: 0, speedKmh: 0 });
  runner.update({ x: 20, z: 0, speedKmh: 60, surfaceId: "gravel" }, 2);
  const result = runner.update({ x: 55, z: 0, speedKmh: 101, surfaceId: "gravel" }, 2);
  assert.equal(result.zeroTo100Seconds, 4);
  assert.equal(result.roadContactRatio, 1);
});

test("unknown proving-ground protocols are rejected", () => {
  assert.equal(createProvingGroundTestRunner().start("unknown"), false);
});

test("reset clears both active and completed proving-ground state", () => {
  const runner = createProvingGroundTestRunner();
  runner.start("zero-to-100", { x: 0, z: 0 });
  runner.update({ x: 50, z: 0, speedKmh: 100 }, 4);
  assert.equal(runner.snapshot().status, "completed");
  assert.deepEqual(runner.reset(), { status: "idle" });
});
