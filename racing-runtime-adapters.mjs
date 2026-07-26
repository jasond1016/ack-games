export function createBrowserRacingClock(windowObject = window, performanceObject = performance) {
  return Object.freeze({
    now: () => performanceObject.now(),
    requestFrame: (callback) => windowObject.requestAnimationFrame(callback),
    cancelFrame: (frameId) => windowObject.cancelAnimationFrame(frameId)
  });
}

export function createManualRacingClock(startTime = 0) {
  let now = startTime;
  let nextFrameId = 1;
  const callbacks = new Map();
  return Object.freeze({
    now: () => now,
    requestFrame(callback) {
      const frameId = nextFrameId++;
      callbacks.set(frameId, callback);
      return frameId;
    },
    cancelFrame(frameId) {
      callbacks.delete(frameId);
    },
    advance(milliseconds) {
      now += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    }
  });
}

const GAMEPAD_DEADZONE = 0.16;

function buttonValue(button) {
  if (!button) return 0;
  const value = Number(button.value);
  if (button.pressed && (!Number.isFinite(value) || value <= 0)) return 1;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function applyGamepadDeadzone(value, deadzone = GAMEPAD_DEADZONE) {
  const magnitude = Math.abs(Number(value) || 0);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - deadzone) / (1 - deadzone));
}

export function readRacingGamepad(gamepads = []) {
  const connectedGamepads = [...gamepads].filter((candidate) => candidate?.connected);
  const gamepad = connectedGamepads.find((candidate) => /xbox|xinput|045e/i.test(candidate.id || ""))
    ?? connectedGamepads.find((candidate) => candidate.mapping === "standard")
    ?? connectedGamepads[0];
  if (!gamepad) {
    return Object.freeze({ connected: false, id: "", mapping: "", index: -1, steering: 0, throttle: 0, brake: 0, rewindHeld: false, dpadRight: false, buttons: [] });
  }

  const buttons = gamepad.buttons || [];
  const stickSteering = -applyGamepadDeadzone(gamepad.axes?.[0]);

  return Object.freeze({
    connected: true,
    id: String(gamepad.id || "Unknown gamepad"),
    mapping: String(gamepad.mapping || "unmapped"),
    index: gamepad.index,
    // Stick-only steering: D-pad right is camera (#26); D-pad left also ignored for symmetry.
    steering: stickSteering,
    throttle: buttonValue(buttons[7]),
    brake: buttonValue(buttons[6]),
    rewindHeld: buttonValue(buttons[3]) > 0.5,
    dpadRight: buttonValue(buttons[15]) > 0.5,
    buttons: [0, 1, 2, 3, 8, 9].map((index) => buttonValue(buttons[index]) > 0.5)
  });
}

export function createBrowserRacingInput({
  onDrive,
  onPause,
  onBoost,
  onCancel = () => {},
  onToggleOpponent,
  onToggleCamera,
  onReplaceSession,
  onToggleDebug,
  onRewindHeld = () => {},
  onGamepadDrive = () => {},
  onBlur,
  onHidden
}, {
  windowObject = window,
  documentObject = document,
  navigatorObject = windowObject.navigator
} = {}) {
  let listening = false;
  let previousGamepadIndex = -1;
  let previousGamepadButtons = [];
  let previousDpadRight = false;
  let keyboardRewindHeld = false;
  const connectedGamepads = new Map();
  const drivingCodes = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
  const boostCodes = new Set(["KeyE", "Numpad0"]);
  const handledCodes = new Set([...drivingCodes, ...boostCodes, "KeyC", "KeyH", "KeyR", "KeyZ", "Escape", "F2"]);

  function emitRewindHeld(gamepadRewindHeld = false) {
    onRewindHeld(Boolean(keyboardRewindHeld || gamepadRewindHeld));
  }

  function handleKeyDown(event) {
    if (handledCodes.has(event.code)) event.preventDefault();
    if (drivingCodes.has(event.code)) onDrive(event.code, true);
    if (event.code === "KeyZ") {
      keyboardRewindHeld = true;
      emitRewindHeld();
    }
    if (event.repeat) return;
    if (event.code === "Escape") onPause();
    else if (boostCodes.has(event.code)) onBoost();
    else if (event.code === "KeyH") onToggleOpponent();
    else if (event.code === "KeyC") onToggleCamera();
    else if (event.code === "KeyR") onReplaceSession();
    else if (event.code === "F2") onToggleDebug();
  }

  function handleKeyUp(event) {
    if (drivingCodes.has(event.code)) onDrive(event.code, false);
    if (event.code === "KeyZ") {
      keyboardRewindHeld = false;
      emitRewindHeld();
    }
  }

  function handleVisibilityChange() {
    if (documentObject.hidden) onHidden();
  }

  function handleGamepadConnected(event) {
    if (event.gamepad) connectedGamepads.set(event.gamepad.index, event.gamepad);
  }

  function handleGamepadDisconnected(event) {
    if (event.gamepad) connectedGamepads.delete(event.gamepad.index);
  }

  function pollGamepad() {
    if (!listening) return;
    let enumeratedGamepads = [];
    try {
      enumeratedGamepads = [...(navigatorObject?.getGamepads?.() || [])].filter(Boolean);
    } catch {
      // Chrome can temporarily reject enumeration while restoring focus. The
      // connection event still provides a live Gamepad object to poll.
    }
    for (const gamepad of enumeratedGamepads) {
      connectedGamepads.set(gamepad.index, gamepad);
    }
    const state = readRacingGamepad(connectedGamepads.values());
    onGamepadDrive(state);
    emitRewindHeld(state.rewindHeld);

    const buttons = state.buttons;
    const changedGamepad = state.index !== previousGamepadIndex;
    const pressed = (buttonIndex) => buttons[buttonIndex] && (changedGamepad || !previousGamepadButtons[buttonIndex]);
    if (pressed(0)) onBoost();
    if (pressed(1)) onCancel();
    if (pressed(2)) onToggleOpponent();
    // Y (button 3) is hold-to-rewind; camera moved to D-pad right.
    if (pressed(4)) onReplaceSession();
    if (pressed(5)) onPause();
    const dpadRightEdge = Boolean(state.dpadRight) && (changedGamepad || !previousDpadRight);
    if (dpadRightEdge) onToggleCamera();
    previousGamepadIndex = state.index;
    previousGamepadButtons = buttons;
    previousDpadRight = Boolean(state.dpadRight);
  }

  function primeGamepad() {
    let gamepads = [];
    try {
      gamepads = [...(navigatorObject?.getGamepads?.() || [])].filter(Boolean);
    } catch {
      // Normal polling will retry on the next gameplay frame.
    }
    for (const gamepad of gamepads) connectedGamepads.set(gamepad.index, gamepad);
    const state = readRacingGamepad(connectedGamepads.values());
    previousGamepadIndex = state.index;
    previousGamepadButtons = state.buttons;
    previousDpadRight = Boolean(state.dpadRight);
  }

  return Object.freeze({
    start() {
      if (listening) return;
      windowObject.addEventListener("keydown", handleKeyDown);
      windowObject.addEventListener("keyup", handleKeyUp);
      windowObject.addEventListener("blur", onBlur);
      windowObject.addEventListener("gamepadconnected", handleGamepadConnected);
      windowObject.addEventListener("gamepaddisconnected", handleGamepadDisconnected);
      documentObject.addEventListener("visibilitychange", handleVisibilityChange);
      previousGamepadIndex = -1;
      previousGamepadButtons = [];
      previousDpadRight = false;
      keyboardRewindHeld = false;
      listening = true;
    },
    pollGamepad,
    primeGamepad,
    stop() {
      if (!listening) return;
      windowObject.removeEventListener("keydown", handleKeyDown);
      windowObject.removeEventListener("keyup", handleKeyUp);
      windowObject.removeEventListener("blur", onBlur);
      windowObject.removeEventListener("gamepadconnected", handleGamepadConnected);
      windowObject.removeEventListener("gamepaddisconnected", handleGamepadDisconnected);
      documentObject.removeEventListener("visibilitychange", handleVisibilityChange);
      keyboardRewindHeld = false;
      onRewindHeld(false);
      onGamepadDrive(readRacingGamepad());
      connectedGamepads.clear();
      previousGamepadIndex = -1;
      previousGamepadButtons = [];
      previousDpadRight = false;
      listening = false;
    }
  });
}
