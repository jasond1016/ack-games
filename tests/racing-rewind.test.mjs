import assert from "node:assert/strict";
import test from "node:test";

import { createRewindBuffer, REWIND_BUFFER_SECONDS } from "../racing-rewind.mjs";

test("rewind buffer records up to capacity and reports bufferedSeconds", () => {
  const buffer = createRewindBuffer({ capacitySeconds: 1, sampleHz: 10 });
  for (let i = 0; i < 20; i += 1) {
    buffer.maybeRecord(0.1, () => ({ time: i * 0.1, value: i }));
  }
  assert.ok(buffer.bufferedSeconds <= 1.0001);
  assert.ok(buffer.sampleCount <= 11);
  assert.equal(buffer.active, false);
});

test("rewind steps backward, truncates future, and stops at start", () => {
  const buffer = createRewindBuffer({ capacitySeconds: REWIND_BUFFER_SECONDS, sampleHz: 20 });
  for (let i = 0; i <= 40; i += 1) {
    buffer.maybeRecord(0.05, () => ({ time: i * 0.05, value: i }));
  }
  assert.ok(buffer.begin());
  assert.equal(buffer.active, true);
  const first = buffer.stepBackward(0.2);
  assert.ok(first.sample);
  assert.ok(first.sample.value < 40);
  const beforeCount = buffer.sampleCount;
  buffer.stepBackward(0.2);
  assert.ok(buffer.sampleCount <= beforeCount);

  let guard = 0;
  let atStart = false;
  while (!atStart && guard < 500) {
    const step = buffer.stepBackward(0.2);
    atStart = step.atStart;
    guard += 1;
  }
  assert.equal(atStart, true);
  assert.equal(buffer.atStart, true);
  buffer.end();
  assert.equal(buffer.active, false);
});
