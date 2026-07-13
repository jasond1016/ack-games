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

export function createBrowserRacingInput({
  onDrive,
  onPause,
  onBoost,
  onToggleOpponent,
  onToggleCamera,
  onReplaceSession,
  onToggleDebug,
  onBlur,
  onHidden
}, { windowObject = window, documentObject = document } = {}) {
  let listening = false;
  const drivingCodes = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
  const boostCodes = new Set(["KeyE", "Numpad0"]);
  const handledCodes = new Set([...drivingCodes, ...boostCodes, "KeyC", "KeyH", "KeyR", "Escape", "F2"]);

  function handleKeyDown(event) {
    if (handledCodes.has(event.code)) event.preventDefault();
    if (drivingCodes.has(event.code)) onDrive(event.code, true);
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
  }

  function handleVisibilityChange() {
    if (documentObject.hidden) onHidden();
  }

  return Object.freeze({
    start() {
      if (listening) return;
      windowObject.addEventListener("keydown", handleKeyDown);
      windowObject.addEventListener("keyup", handleKeyUp);
      windowObject.addEventListener("blur", onBlur);
      documentObject.addEventListener("visibilitychange", handleVisibilityChange);
      listening = true;
    },
    stop() {
      if (!listening) return;
      windowObject.removeEventListener("keydown", handleKeyDown);
      windowObject.removeEventListener("keyup", handleKeyUp);
      windowObject.removeEventListener("blur", onBlur);
      documentObject.removeEventListener("visibilitychange", handleVisibilityChange);
      listening = false;
    }
  });
}
