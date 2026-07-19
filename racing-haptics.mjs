function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  surfaceId = "road",
  tireSlip = 0,
  absActive = false,
  tractionControlActive = false
} = {}) {
  if (!connected || !enabled) {
    return Object.freeze({ weakMagnitude: 0, strongMagnitude: 0, boostActive: false, enabled: false });
  }

  const speed = Math.abs(finiteNumber(signedSpeed));
  const speedRatio = clamp(speed / Math.max(finiteNumber(maxForwardSpeed, 50), 0.001));
  const rollingScale = clamp((speed - 0.5) / 5.5);
  const roughSurface = ["embankment", "ground", "gravel", "rally-dirt"].includes(surfaceId);
  const slipIntensity = grounded ? clamp((finiteNumber(tireSlip) - 0.12) / 0.68) : 0;
  const surfaceWeak = grounded && roughSurface ? (0.06 + speedRatio * 0.18) * rollingScale : 0;
  const surfaceStrong = grounded && roughSurface ? (0.02 + speedRatio * 0.06) * rollingScale : 0;
  const weakMagnitude = clamp(
    surfaceWeak
    + (boostActive ? 0.1 + speedRatio * 0.08 : 0)
    + slipIntensity * 0.3
    + (grounded && tractionControlActive ? 0.16 : 0)
  );
  const strongMagnitude = clamp(
    surfaceStrong
    + (boostActive ? 0.18 : 0)
    + slipIntensity * 0.1
    + (grounded && absActive ? 0.28 : 0)
  );
  return Object.freeze({
    weakMagnitude,
    strongMagnitude,
    roughSurface,
    boostActive: Boolean(boostActive),
    absActive: Boolean(absActive),
    tractionControlActive: Boolean(tractionControlActive),
    enabled: true
  });
}

export function createRacingHapticsController({
  navigatorObject = globalThis.navigator,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  refreshMilliseconds = 50
} = {}) {
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let activeGamepadIndex = -1;
  let lastState = calculateRacingHapticsState();
  let priorityUntil = Number.NEGATIVE_INFINITY;
  let lastShiftCount = null;
  let lastBoostActive = false;
  let pendingBoostOnset = false;
  let steadyOutputActive = false;
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

  function playPriority(gamepad, timestamp, effect) {
    const played = play(gamepad, effect);
    if (played) {
      priorityUntil = timestamp + effect.duration;
      steadyOutputActive = false;
    }
    return played;
  }

  function pulseGate(timestamp, frequency, dutyCycle) {
    return (timestamp * frequency / 1000) % 1 < dutyCycle;
  }

  function modulateFeedback(state, timestamp) {
    let weakMagnitude = state.weakMagnitude;
    let strongMagnitude = state.strongMagnitude;
    if (state.absActive) {
      const activePulse = pulseGate(timestamp, 12, 0.42);
      weakMagnitude *= activePulse ? 1 : 0.15;
      strongMagnitude *= activePulse ? 1 : 0.05;
    } else if (state.tractionControlActive) {
      const activePulse = pulseGate(timestamp, 9, 0.38);
      weakMagnitude *= activePulse ? 1 : 0.08;
      strongMagnitude *= activePulse ? 1 : 0.08;
    } else if (state.roughSurface) {
      const activePulse = pulseGate(timestamp, 14, 0.55);
      weakMagnitude *= activePulse ? 1 : 0.32;
      strongMagnitude *= activePulse ? 1 : 0.32;
    }
    return { weakMagnitude, strongMagnitude };
  }

  return Object.freeze({
    update({ gamepadIndex = -1, shiftCount = 0, ...input } = {}) {
      if (gamepadIndex !== activeGamepadIndex) {
        stopGamepad(gamepadAt(activeGamepadIndex));
        activeGamepadIndex = gamepadIndex;
        lastRefresh = Number.NEGATIVE_INFINITY;
        priorityUntil = Number.NEGATIVE_INFINITY;
        lastShiftCount = null;
        lastBoostActive = false;
        pendingBoostOnset = false;
        steadyOutputActive = false;
      }
      const gamepad = gamepadAt(activeGamepadIndex);
      lastState = calculateRacingHapticsState({ ...input, connected: Boolean(gamepad?.connected) });
      const timestamp = now();
      const normalizedShiftCount = Math.max(0, Math.floor(Number(shiftCount) || 0));
      const shifted = lastShiftCount !== null && normalizedShiftCount > lastShiftCount;
      const boostStarted = lastState.boostActive && !lastBoostActive;

      if (!lastState.enabled) {
        if (steadyOutputActive || timestamp < priorityUntil) stopGamepad(gamepad);
        priorityUntil = Number.NEGATIVE_INFINITY;
        steadyOutputActive = false;
        pendingBoostOnset = false;
        lastShiftCount = normalizedShiftCount;
        lastBoostActive = Boolean(input.boostActive);
        return lastState;
      }
      if (!lastState.boostActive) pendingBoostOnset = false;
      if (timestamp < priorityUntil) {
        if (boostStarted) pendingBoostOnset = true;
        lastShiftCount = normalizedShiftCount;
        lastBoostActive = lastState.boostActive;
        return lastState;
      }

      if (shifted) {
        if (boostStarted) pendingBoostOnset = true;
        playPriority(gamepad, timestamp, {
          duration: 75,
          weakMagnitude: 0.16,
          strongMagnitude: 0.3
        });
      } else if (boostStarted || (pendingBoostOnset && lastState.boostActive)) {
        pendingBoostOnset = false;
        playPriority(gamepad, timestamp, {
          duration: 95,
          weakMagnitude: 0.24,
          strongMagnitude: 0.34
        });
      }
      lastShiftCount = normalizedShiftCount;
      lastBoostActive = lastState.boostActive;
      if (timestamp < priorityUntil) return lastState;

      if (timestamp - lastRefresh >= refreshMilliseconds) {
        lastRefresh = timestamp;
        if (lastState.enabled) {
          const feedback = modulateFeedback(lastState, timestamp);
          if (Math.max(feedback.weakMagnitude, feedback.strongMagnitude) > 0.005) {
            steadyOutputActive = play(gamepad, { duration: refreshMilliseconds + 8, ...feedback });
          } else if (steadyOutputActive) {
            stopGamepad(gamepad);
            steadyOutputActive = false;
          }
        } else {
          stopGamepad(gamepad);
          steadyOutputActive = false;
        }
      }
      return lastState;
    },
    pulseImpact(intensity = 1) {
      if (!lastState.enabled) return false;
      const gamepad = gamepadAt(activeGamepadIndex);
      const magnitude = clamp(finiteNumber(intensity, 1));
      const timestamp = now();
      return playPriority(gamepad, timestamp, {
        duration: 90 + magnitude * 150,
        weakMagnitude: 0.35 + magnitude * 0.45,
        strongMagnitude: 0.42 + magnitude * 0.58
      });
    },
    pulseLanding(intensity = 1) {
      if (!lastState.enabled) return false;
      const gamepad = gamepadAt(activeGamepadIndex);
      const magnitude = clamp(finiteNumber(intensity, 1));
      const timestamp = now();
      return playPriority(gamepad, timestamp, {
        duration: 65 + magnitude * 90,
        weakMagnitude: 0.18 + magnitude * 0.3,
        strongMagnitude: 0.5 + magnitude * 0.5
      });
    },
    stop() {
      stopGamepad(gamepadAt(activeGamepadIndex));
      activeGamepadIndex = -1;
      lastState = calculateRacingHapticsState();
      priorityUntil = Number.NEGATIVE_INFINITY;
      lastShiftCount = null;
      lastBoostActive = false;
      pendingBoostOnset = false;
      steadyOutputActive = false;
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
