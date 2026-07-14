import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDriveRetention,
  calculateEngineForce,
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
