import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserRacingInput, createManualRacingClock } from "../racing-runtime-adapters.mjs";

function createEventTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); }
  };
}

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

test("数字键盘 0 可触发氮气且按住时不重复触发", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  let boostCount = 0;
  let prevented = false;
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() {},
    onBoost() { boostCount += 1; },
    onToggleOpponent() {},
    onToggleCamera() {},
    onReplaceSession() {},
    onToggleDebug() {},
    onBlur() {},
    onHidden() {}
  }, { windowObject, documentObject });

  input.start();
  windowObject.dispatch("keydown", {
    code: "Numpad0",
    repeat: false,
    preventDefault() { prevented = true; }
  });
  windowObject.dispatch("keydown", {
    code: "Numpad0",
    repeat: true,
    preventDefault() {}
  });
  input.stop();

  assert.equal(boostCount, 1);
  assert.equal(prevented, true);
});
