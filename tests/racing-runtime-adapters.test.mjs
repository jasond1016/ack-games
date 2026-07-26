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
  // D-pad no longer steers; stick axis still does.
  assert.ok(dpadState.steering > 0.1 && dpadState.steering < 0.25);
  assert.equal(dpadState.dpadRight, true);
  assert.equal(dpadState.rewindHeld, false);
});

test("手柄 Y 为倒流按住、十字键右不参与转向", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[3] = { pressed: true, value: 1 };
  buttons[15] = { pressed: true, value: 1 };
  const state = readRacingGamepad([{
    connected: true,
    index: 0,
    axes: [0],
    buttons
  }]);
  assert.equal(state.rewindHeld, true);
  assert.equal(state.dpadRight, true);
  assert.ok(Math.abs(state.steering) < 1e-9);
});

test("十字键右边沿切视角；Y 不切视角", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const gamepad = { connected: true, index: 0, axes: [0], buttons };
  const actions = [];
  let rewindHeld = false;
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() {},
    onBoost() {},
    onToggleOpponent() {},
    onToggleCamera() { actions.push("camera"); },
    onReplaceSession() {},
    onToggleDebug() {},
    onRewindHeld(held) { rewindHeld = held; },
    onBlur() {},
    onHidden() {}
  }, {
    windowObject,
    documentObject,
    navigatorObject: { getGamepads: () => [gamepad] }
  });

  input.start();
  buttons[3] = { pressed: true, value: 1 };
  input.pollGamepad();
  assert.equal(rewindHeld, true);
  assert.deepEqual(actions, []);
  buttons[15] = { pressed: true, value: 1 };
  input.pollGamepad();
  assert.deepEqual(actions, ["camera"]);
  input.pollGamepad();
  assert.deepEqual(actions, ["camera"]);
  input.stop();
});

test("键盘 Z 按住触发倒流、C 仍切视角", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  const actions = [];
  let rewindHeld = false;
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() {},
    onBoost() {},
    onToggleOpponent() {},
    onToggleCamera() { actions.push("camera"); },
    onReplaceSession() {},
    onToggleDebug() {},
    onRewindHeld(held) { rewindHeld = held; },
    onBlur() {},
    onHidden() {}
  }, { windowObject, documentObject });

  input.start();
  windowObject.dispatch("keydown", { code: "KeyZ", repeat: false, preventDefault() {} });
  assert.equal(rewindHeld, true);
  windowObject.dispatch("keydown", { code: "KeyC", repeat: false, preventDefault() {} });
  windowObject.dispatch("keyup", { code: "KeyZ", preventDefault() {} });
  assert.equal(rewindHeld, false);
  input.stop();
  assert.deepEqual(actions, ["camera"]);
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

test("B 键触发 onCancel 且只在按下边沿生效", () => {
  const windowObject = createEventTarget();
  const documentObject = createEventTarget();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const gamepad = { connected: true, index: 0, axes: [0], buttons };
  const actions = [];
  const input = createBrowserRacingInput({
    onDrive() {},
    onPause() {},
    onBoost() {},
    onCancel() { actions.push("cancel"); },
    onToggleOpponent() {},
    onToggleCamera() {},
    onReplaceSession() {},
    onToggleDebug() {},
    onBlur() {},
    onHidden() {}
  }, {
    windowObject,
    documentObject,
    navigatorObject: { getGamepads: () => [gamepad] }
  });

  input.start();
  buttons[1] = { pressed: true, value: 1 };
  input.pollGamepad();
  input.pollGamepad();
  buttons[1] = { pressed: false, value: 0 };
  input.pollGamepad();
  input.stop();

  assert.deepEqual(actions, ["cancel"]);
});
