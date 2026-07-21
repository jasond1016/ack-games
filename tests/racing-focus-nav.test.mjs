import assert from "node:assert/strict";
import test from "node:test";

import { createGamepadFocusNav, readGamepadMenuNavInput } from "../racing-focus-nav.mjs";

function createButton({ id, rect, disabled = false, hidden = false }) {
  const listeners = new Map();
  return {
    id,
    disabled,
    hidden,
    clicked: 0,
    focused: 0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    getBoundingClientRect() { return rect; },
    focus() { this.focused += 1; },
    click() { this.clicked += 1; }
  };
}

function createRoot(buttons) {
  return {
    querySelectorAll: () => buttons.filter((button) => !button.disabled)
  };
}

function createFakeDocument(initialActive = null) {
  return { activeElement: initialActive };
}

function createFakeGamepad(overrides = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  return {
    connected: true,
    id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
    mapping: "standard",
    axes: [0, 0],
    buttons,
    ...overrides
  };
}

test("readGamepadMenuNavInput 将十字键和左摇杆映射为方向输入", () => {
  const gamepad = createFakeGamepad();
  gamepad.buttons[15] = { pressed: true, value: 1 };
  const rightState = readGamepadMenuNavInput([gamepad]);
  assert.equal(rightState.right, true);
  assert.equal(rightState.left, false);

  const stickGamepad = createFakeGamepad({ axes: [0, -0.8] });
  const upState = readGamepadMenuNavInput([stickGamepad]);
  assert.equal(upState.up, true);
});

test("readGamepadMenuNavInput 将 A/B 映射为确认/取消", () => {
  const gamepad = createFakeGamepad();
  gamepad.buttons[0] = { pressed: true, value: 1 };
  const confirmState = readGamepadMenuNavInput([gamepad]);
  assert.equal(confirmState.confirm, true);
  assert.equal(confirmState.cancel, false);

  const gamepad2 = createFakeGamepad();
  gamepad2.buttons[1] = { pressed: true, value: 1 };
  const cancelState = readGamepadMenuNavInput([gamepad2]);
  assert.equal(cancelState.cancel, true);
});

test("方向键按下边沿会在候选控件间移动焦点", () => {
  const left = createButton({ id: "left", rect: { left: 0, top: 0, width: 100, height: 40 } });
  const right = createButton({ id: "right", rect: { left: 200, top: 0, width: 100, height: 40 } });
  const root = createRoot([left, right]);
  const documentObject = createFakeDocument(left);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[15] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject });
  assert.equal(right.focused, 1);

  documentObject.activeElement = right;
  nav.poll({ root, documentObject });
  assert.equal(right.focused, 1, "持续按住不应重复移动焦点");

  gamepad.buttons[15] = { pressed: false, value: 0 };
  nav.poll({ root, documentObject });
  gamepad.buttons[14] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject });
  assert.equal(left.focused, 1);
});

test("A 键会点击当前聚焦控件（除非提供 onConfirm）", () => {
  const button = createButton({ id: "go", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const root = createRoot([button]);
  const documentObject = createFakeDocument(button);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[0] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject });
  assert.equal(button.clicked, 1);

  gamepad.buttons[0] = { pressed: false, value: 0 };
  nav.poll({ root, documentObject });
  gamepad.buttons[0] = { pressed: true, value: 1 };
  let confirmed = null;
  nav.poll({ root, documentObject, onConfirm: (element) => { confirmed = element; } });
  assert.equal(button.clicked, 1, "提供 onConfirm 时不应再触发原生 click");
  assert.equal(confirmed, button);
});

test("B 键触发 onCancel 回调用于返回", () => {
  const button = createButton({ id: "go", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const root = createRoot([button]);
  const documentObject = createFakeDocument(button);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  let cancelled = false;
  gamepad.buttons[1] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject, onCancel: () => { cancelled = true; } });
  assert.equal(cancelled, true);
});

test("没有元素处于焦点时，方向键或确认键会先聚焦第一个候选控件", () => {
  const first = createButton({ id: "first", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const second = createButton({ id: "second", rect: { left: 100, top: 0, width: 80, height: 30 } });
  const root = createRoot([first, second]);
  const documentObject = createFakeDocument(null);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[15] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject });
  assert.equal(first.focused, 1);
  assert.equal(second.focused, 0);
});

test("隐藏或禁用的控件不会成为焦点候选", () => {
  const visible = createButton({ id: "visible", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const hidden = createButton({ id: "hidden", rect: { left: 0, top: 0, width: 0, height: 0 }, hidden: true });
  const disabled = createButton({ id: "disabled", rect: { left: 100, top: 0, width: 80, height: 30 }, disabled: true });
  const root = createRoot([visible, hidden, disabled]);
  const documentObject = createFakeDocument(null);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[15] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject });
  assert.equal(visible.focused, 1);
  assert.equal(hidden.focused, 0);
  assert.equal(disabled.focused, 0);
});

test("moveFocus/confirm/cancel 开关可分别关闭对应行为", () => {
  const button = createButton({ id: "go", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const root = createRoot([button]);
  const documentObject = createFakeDocument(button);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[0] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject, confirm: false });
  assert.equal(button.clicked, 0);
});

test("enabled=false 时不读取手柄也不移动焦点", () => {
  const button = createButton({ id: "go", rect: { left: 0, top: 0, width: 80, height: 30 } });
  const other = createButton({ id: "other", rect: { left: 100, top: 0, width: 80, height: 30 } });
  const root = createRoot([button, other]);
  const documentObject = createFakeDocument(button);
  const gamepad = createFakeGamepad();
  const nav = createGamepadFocusNav({ navigatorObject: { getGamepads: () => [gamepad] } });

  gamepad.buttons[15] = { pressed: true, value: 1 };
  nav.poll({ root, documentObject, enabled: false });
  assert.equal(other.focused, 0);
});
