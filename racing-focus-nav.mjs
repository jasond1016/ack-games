// Shared Xbox-gamepad focus navigation for menu-style UI (map select, race
// start overlay). Keyboard/mouse focus and click handlers keep working
// untouched — this module only *moves* DOM focus around a root element and
// optionally activates (`click()`) or cancels (`onCancel`) the focused
// control, so every existing click handler stays the single source of truth.
const MENU_STICK_DEADZONE = 0.5;
const EMPTY_NAV_INPUT = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  cancel: false
});

function buttonValue(button) {
  if (!button) return 0;
  const value = Number(button.value);
  if (button.pressed && (!Number.isFinite(value) || value <= 0)) return 1;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function readGamepadMenuNavInput(gamepads = []) {
  const connectedGamepads = [...gamepads].filter((candidate) => candidate?.connected);
  const gamepad = connectedGamepads.find((candidate) => /xbox|xinput|045e/i.test(candidate.id || ""))
    ?? connectedGamepads.find((candidate) => candidate.mapping === "standard")
    ?? connectedGamepads[0];
  if (!gamepad) {
    return EMPTY_NAV_INPUT;
  }

  const buttons = gamepad.buttons || [];
  const axisX = Number(gamepad.axes?.[0]) || 0;
  const axisY = Number(gamepad.axes?.[1]) || 0;

  return Object.freeze({
    up: buttonValue(buttons[12]) > 0.5 || axisY < -MENU_STICK_DEADZONE,
    down: buttonValue(buttons[13]) > 0.5 || axisY > MENU_STICK_DEADZONE,
    left: buttonValue(buttons[14]) > 0.5 || axisX < -MENU_STICK_DEADZONE,
    right: buttonValue(buttons[15]) > 0.5 || axisX > MENU_STICK_DEADZONE,
    confirm: buttonValue(buttons[0]) > 0.5,
    cancel: buttonValue(buttons[1]) > 0.5
  });
}

function isFocusableElement(element) {
  if (!element || element.disabled) return false;
  if (element.hidden) return false;
  if (typeof element.getBoundingClientRect !== "function") return true;
  const rect = element.getBoundingClientRect();
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0;
}

function rectCenter(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Number(rect.left) + Number(rect.width) / 2,
    y: Number(rect.top) + Number(rect.height) / 2
  };
}

function findNextFocusTarget(current, candidates, direction) {
  const others = candidates.filter((candidate) => candidate !== current);
  if (!current) {
    return others[0] ?? candidates[0] ?? null;
  }

  const from = rectCenter(current);
  let best = null;
  let bestScore = Infinity;

  for (const candidate of others) {
    const to = rectCenter(candidate);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let primary;
    let cross;
    if (direction === "left") { primary = -dx; cross = dy; }
    else if (direction === "right") { primary = dx; cross = dy; }
    else if (direction === "up") { primary = -dy; cross = dx; }
    else { primary = dy; cross = dx; }

    if (primary <= 0.5) continue;
    const score = primary + Math.abs(cross) * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export function createGamepadFocusNav({
  navigatorObject = (typeof navigator !== "undefined" ? navigator : undefined)
} = {}) {
  let previousInput = EMPTY_NAV_INPUT;

  function readGamepads() {
    try {
      return [...(navigatorObject?.getGamepads?.() || [])].filter(Boolean);
    } catch {
      return [];
    }
  }

  function poll({
    root,
    documentObject = (typeof document !== "undefined" ? document : undefined),
    enabled = true,
    focusableSelector = "button:not([disabled])",
    moveFocus = true,
    confirm = true,
    cancel = true,
    onConfirm,
    onCancel
  } = {}) {
    if (!enabled || !root || !documentObject) {
      previousInput = EMPTY_NAV_INPUT;
      return EMPTY_NAV_INPUT;
    }

    const input = readGamepadMenuNavInput(readGamepads());
    const priorInput = previousInput;
    const pressed = (key) => input[key] && !priorInput[key];
    previousInput = input;

    const candidates = Array.from(root.querySelectorAll(focusableSelector)).filter(isFocusableElement);
    if (candidates.length === 0) {
      return input;
    }

    let current = documentObject.activeElement;
    if (!current || !candidates.includes(current)) {
      current = null;
    }

    if (!current) {
      const wantsMove = pressed("up") || pressed("down") || pressed("left") || pressed("right");
      if ((wantsMove && moveFocus) || (pressed("confirm") && confirm)) {
        candidates[0].focus();
      }
      return input;
    }

    if (moveFocus && pressed("left")) {
      findNextFocusTarget(current, candidates, "left")?.focus();
    } else if (moveFocus && pressed("right")) {
      findNextFocusTarget(current, candidates, "right")?.focus();
    } else if (moveFocus && pressed("up")) {
      findNextFocusTarget(current, candidates, "up")?.focus();
    } else if (moveFocus && pressed("down")) {
      findNextFocusTarget(current, candidates, "down")?.focus();
    } else if (confirm && pressed("confirm")) {
      if (typeof onConfirm === "function") onConfirm(current);
      else if (typeof current.click === "function") current.click();
    } else if (cancel && pressed("cancel")) {
      if (typeof onCancel === "function") onCancel(current);
    }

    return input;
  }

  return Object.freeze({
    poll,
    reset() {
      previousInput = EMPTY_NAV_INPUT;
    }
  });
}
