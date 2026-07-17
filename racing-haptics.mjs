function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function calculateRacingHapticsState({
  connected = false,
  enabled = true,
  signedSpeed = 0,
  maxForwardSpeed = 50,
  throttle = 0,
  brake = 0,
  boostActive = false,
  grounded = true,
  surfaceId = "road"
} = {}) {
  if (!connected || !enabled) {
    return Object.freeze({ weakMagnitude: 0, strongMagnitude: 0, boostActive: false, enabled: false });
  }

  const speedRatio = clamp(Math.abs(signedSpeed) / Math.max(maxForwardSpeed, 0.001));
  const roughSurface = ["embankment", "ground", "gravel", "rally-dirt"].includes(surfaceId);
  const contactScale = grounded ? 1 : 0.28;
  const weakMagnitude = clamp((
    0.035 + speedRatio * 0.16 + clamp(throttle) * 0.07 + (roughSurface ? 0.18 : 0)
    + (boostActive ? 0.42 : 0)
  ) * contactScale);
  const strongMagnitude = clamp((
    speedRatio * 0.08 + clamp(brake) * 0.24 + (roughSurface ? 0.08 : 0)
    + (boostActive ? 0.64 : 0)
  ) * contactScale);
  return Object.freeze({ weakMagnitude, strongMagnitude, boostActive: Boolean(boostActive), enabled: true });
}

export function createRacingHapticsController({
  navigatorObject = globalThis.navigator,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  refreshMilliseconds = 90
} = {}) {
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let activeGamepadIndex = -1;
  let lastState = calculateRacingHapticsState();
  let supported = false;
  let pulseCount = 0;

  function gamepadAt(index) {
    if (!Number.isInteger(index) || index < 0) return null;
    return navigatorObject?.getGamepads?.()?.[index] ?? null;
  }

  function actuatorFor(gamepad) {
    return gamepad?.vibrationActuator ?? gamepad?.hapticActuators?.[0] ?? null;
  }

  function play(gamepad, { duration, weakMagnitude, strongMagnitude }) {
    const actuator = actuatorFor(gamepad);
    supported = Boolean(actuator);
    if (!actuator) return false;
    pulseCount += 1;
    try {
      if (typeof actuator.playEffect === "function") {
        void Promise.resolve(actuator.playEffect("dual-rumble", {
          startDelay: 0,
          duration,
          weakMagnitude: clamp(weakMagnitude),
          strongMagnitude: clamp(strongMagnitude)
        })).catch(() => {});
      } else if (typeof actuator.pulse === "function") {
        void Promise.resolve(actuator.pulse(clamp(Math.max(weakMagnitude, strongMagnitude)), duration)).catch(() => {});
      } else {
        supported = false;
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function stopGamepad(gamepad) {
    const actuator = actuatorFor(gamepad);
    try {
      if (typeof actuator?.reset === "function") void Promise.resolve(actuator.reset()).catch(() => {});
      else if (gamepad) play(gamepad, { duration: 1, weakMagnitude: 0, strongMagnitude: 0 });
    } catch {}
  }

  return Object.freeze({
    update({ gamepadIndex = -1, ...input } = {}) {
      if (gamepadIndex !== activeGamepadIndex) {
        stopGamepad(gamepadAt(activeGamepadIndex));
        activeGamepadIndex = gamepadIndex;
        lastRefresh = Number.NEGATIVE_INFINITY;
      }
      const gamepad = gamepadAt(activeGamepadIndex);
      lastState = calculateRacingHapticsState({ ...input, connected: Boolean(gamepad?.connected) });
      const timestamp = now();
      if (timestamp - lastRefresh >= refreshMilliseconds) {
        lastRefresh = timestamp;
        if (lastState.enabled) {
          play(gamepad, {
            duration: refreshMilliseconds + 30,
            weakMagnitude: lastState.weakMagnitude,
            strongMagnitude: lastState.strongMagnitude
          });
        } else {
          stopGamepad(gamepad);
        }
      }
      return lastState;
    },
    pulseImpact(intensity = 1) {
      const gamepad = gamepadAt(activeGamepadIndex);
      const magnitude = clamp(intensity);
      return play(gamepad, {
        duration: 90 + magnitude * 150,
        weakMagnitude: 0.35 + magnitude * 0.45,
        strongMagnitude: 0.42 + magnitude * 0.58
      });
    },
    stop() {
      stopGamepad(gamepadAt(activeGamepadIndex));
      activeGamepadIndex = -1;
      lastState = calculateRacingHapticsState();
    },
    getState() {
      return Object.freeze({
        ...lastState,
        gamepadIndex: activeGamepadIndex,
        supported,
        pulseCount
      });
    }
  });
}
