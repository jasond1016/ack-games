import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDriveRetention,
  calculateEngineForce,
  calculateSurfaceSpeedLimit,
  resolvePlayerDrift,
  shouldActivateComputerBoost
} from "../racing-driving-dynamics.mjs";

function simulateStraightLine({ boostActive }) {
  const deltaSeconds = 1 / 60;
  const maxForwardSpeed = boostActive ? 100 : 50;
  let speed = 0;

  for (let frame = 0; frame < 60 * 30; frame += 1) {
    speed += calculateEngineForce({
      engineForce: 42,
      boostActive,
      boostMultiplier: 2.15,
      controlScale: 1,
      forwardSpeed: speed,
      maxForwardSpeed,
      launchBoostThreshold: 15,
      launchForceMultiplier: 1.35
    }) * deltaSeconds;
    speed *= calculateDriveRetention({
      deltaSeconds,
      speedSquared: speed * speed,
      rollingResistance: 0.68,
      drag: 0.024,
      onRoad: true,
      throttleActive: true,
      boostActive
    });
    speed = Math.min(speed, maxForwardSpeed);
  }

  return speed * 3.6;
}

test("arcade player can reach the same 180 km/h base top speed as the fastest NPC", () => {
  assert.ok(simulateStraightLine({ boostActive: false }) >= 179);
});

test("boost lets the player exceed the NPC top speed", () => {
  assert.ok(simulateStraightLine({ boostActive: true }) >= 300);
});

test("草地最高速度只比道路降低约百分之十", () => {
  const roadLimit = calculateSurfaceSpeedLimit({ baseSpeed: 50, onRoad: true });
  const grassLimit = calculateSurfaceSpeedLimit({ baseSpeed: 50, onRoad: false });
  assert.equal(roadLimit, 50);
  assert.equal(grassLimit, 45);
});

test("草地额外滚阻保持轻微而不是急剧减速", () => {
  const input = {
    deltaSeconds: 1 / 60,
    speedSquared: 30 * 30,
    rollingResistance: 0.68,
    drag: 0.024,
    throttleActive: true,
    boostActive: false
  };
  const roadRetention = calculateDriveRetention({ ...input, onRoad: true });
  const grassRetention = calculateDriveRetention({ ...input, onRoad: false });
  assert.ok(roadRetention - grassRetention < 0.001);
});

test("漂移车以大油门和转向进入漂移且无需踩刹车", () => {
  assert.equal(resolvePlayerDrift({
    enabled: true,
    drifting: false,
    onRoad: true,
    controlScale: 1,
    throttle: 0.8,
    steering: 0.45,
    forwardSpeed: 9,
    entrySpeed: 7.5,
    sustainSpeed: 5.8,
    steerThreshold: 0.14,
    throttleThreshold: 0.7
  }), true);

  assert.equal(resolvePlayerDrift({
    enabled: true,
    drifting: false,
    onRoad: true,
    controlScale: 1,
    throttle: 0.5,
    steering: 0.45,
    forwardSpeed: 9,
    entrySpeed: 7.5,
    sustainSpeed: 5.8,
    steerThreshold: 0.14,
    throttleThreshold: 0.7
  }), false);
});

test("未启用漂移调校的车辆不能进入或维持漂移", () => {
  assert.equal(resolvePlayerDrift({
    enabled: false,
    drifting: true,
    onRoad: true,
    controlScale: 1,
    throttle: 1,
    steering: 1,
    forwardSpeed: 30,
    entrySpeed: 7.5,
    sustainSpeed: 5.8,
    steerThreshold: 0.14
  }), false);
});

test("computer boost schedule consumes exactly three charges", () => {
  const activationTimesSeconds = [2, 10, 18];
  const durationSeconds = 5;
  let boostCharges = 3;
  let boostSeconds = 0;
  let activations = 0;

  for (let elapsedSeconds = 0; elapsedSeconds <= 30; elapsedSeconds += 0.25) {
    boostSeconds = Math.max(0, boostSeconds - 0.25);
    if (shouldActivateComputerBoost({
      elapsedSeconds,
      boostSeconds,
      boostCharges,
      totalCharges: 3,
      activationTimesSeconds,
      eligible: true
    })) {
      boostCharges -= 1;
      boostSeconds = durationSeconds;
      activations += 1;
    }
  }

  assert.equal(activations, 3);
  assert.equal(boostCharges, 0);
  assert.equal(shouldActivateComputerBoost({
    elapsedSeconds: 60,
    boostSeconds: 0,
    boostCharges,
    totalCharges: 3,
    activationTimesSeconds,
    eligible: true
  }), false);
});
