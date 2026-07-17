import assert from "node:assert/strict";
import test from "node:test";

import { shouldActivateComputerBoost } from "../racing-driving-dynamics.mjs";

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
