import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserRacingInput,
  createManualRacingClock,
  readRacingGamepad
} from "../racing-runtime-adapters.mjs";

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

test("Xbox 标准手柄将摇杆、十字键和扳机映射为驾驶输入", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[7] = { pressed: false, value: 0.75 };
  buttons[6] = { pressed: true, value: 1 };
  const stickState = readRacingGamepad([{
    connected: true,
    index: 2,
    axes: [-0.58],
    buttons
  }]);

  assert.equal(stickState.connected, true);
  assert.equal(stickState.index, 2);
  assert.ok(stickState.steering > 0.49 && stickState.steering < 0.51);
  assert.equal(stickState.throttle, 0.75);
  assert.equal(stickState.brake, 1);

  buttons[15] = { pressed: true, value: 1 };
  const dpadState = readRacingGamepad([{ connected: true, index: 2, axes: [-0.3], buttons }]);
  assert.equal(dpadState.steering, -1);
});

test("存在虚拟手柄时优先读取 Xbox 手柄", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const state = readRacingGamepad([
    { connected: true, index: 0, id: "Oculus Virtual Gamepad", mapping: "standard", axes: [1], buttons },
    { connected: true, index: 1, id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", mapping: "standard", axes: [-1], buttons }
  ]);

  assert.equal(state.index, 1);
  assert.equal(state.steering, 1);
});

test("Chrome 连接事件可在手柄枚举暂时为空时激活输入", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[7] = { pressed: true, value: 1 };
  const gamepad = {
    connected: true,
    id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
    index: 0,
    mapping: "standard",
    axes: [0],
    buttons
  };
  const driveStates = [];
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() {},
    onBoost() {},
    onToggleOpponent() {},
    onToggleCamera() {},
    onReplaceSession() {},
    onToggleDebug() {},
    onGamepadDrive(state) { driveStates.push(state); },
    onBlur() {},
    onHidden() {}
  }, {
    windowObject,
    documentObject,
    navigatorObject: { getGamepads: () => [] }
  });

  input.start();
  windowObject.dispatch("gamepadconnected", { gamepad });
  input.pollGamepad();
  input.stop();

  assert.equal(driveStates[0].connected, true);
  assert.equal(driveStates[0].id, gamepad.id);
  assert.equal(driveStates[0].throttle, 1);
});

test("手柄动作按钮只在按下边沿触发", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const gamepad = { connected: true, index: 0, axes: [0], buttons };
  const actions = [];
  const driveStates = [];
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() { actions.push("pause"); },
    onBoost() { actions.push("boost"); },
    onToggleOpponent() { actions.push("opponent"); },
    onToggleCamera() { actions.push("camera"); },
    onReplaceSession() { actions.push("restart"); },
    onToggleDebug() {},
    onGamepadDrive(state) { driveStates.push(state); },
    onBlur() {},
    onHidden() {}
  }, {
    windowObject,
    documentObject,
    navigatorObject: { getGamepads: () => [gamepad] }
  });

  input.start();
  buttons[0] = { pressed: true, value: 1 };
  buttons[9] = { pressed: true, value: 1 };
  input.pollGamepad();
  input.pollGamepad();
  buttons[0] = { pressed: false, value: 0 };
  buttons[9] = { pressed: false, value: 0 };
  input.pollGamepad();
  buttons[0] = { pressed: true, value: 1 };
  input.pollGamepad();
  input.stop();

  assert.deepEqual(actions, ["boost", "pause", "boost"]);
  assert.equal(driveStates.at(0).connected, true);
  assert.equal(driveStates.at(-1).connected, false);
});
