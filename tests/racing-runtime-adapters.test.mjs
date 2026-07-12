import assert from "node:assert/strict";
import test from "node:test";

import { createManualRacingClock } from "../racing-runtime-adapters.mjs";

test("手动比赛时钟只推进未取消的下一帧", () => {
  const clock = createManualRacingClock(100);
  const frames = [];
  const cancelled = clock.requestFrame((time) => frames.push(time));
  clock.cancelFrame(cancelled);
  clock.requestFrame((time) => frames.push(time));
  clock.advance(16);
  assert.deepEqual(frames, [116]);
  assert.equal(clock.now(), 116);
});
