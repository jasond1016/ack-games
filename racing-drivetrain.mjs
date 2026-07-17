const TWO_PI = Math.PI * 2;

export function createDrivetrainState(config) {
  return {
    gear: 1,
    engineRpm: config.idleRpm,
    shiftSeconds: 0,
    shiftCount: 0,
    driveScale: 0,
    torqueRatio: 0.55,
    clutch: 0
  };
}

export function sampleTorqueCurve(rpmRatio) {
  const ratio = Math.max(0, Math.min(1, rpmRatio));
  if (ratio < 0.18) return 0.48 + ratio * 1.5;
  if (ratio < 0.68) return 0.75 + (ratio - 0.18) * 0.5;
  return Math.max(0.58, 1 - (ratio - 0.68) * 1.18);
}

export function updateAutomaticDrivetrain({
  state,
  config,
  signedSpeed = 0,
  throttle = 0,
  reverseInput = 0,
  deltaSeconds = 0
}) {
  const speed = Math.abs(Number.isFinite(signedSpeed) ? signedSpeed : 0);
  const throttleAmount = clamp01(throttle);
  const wantsReverse = reverseInput > 0.05 && signedSpeed <= 1.2;
  const wheelRpm = speed / Math.max(config.wheelRadius, 0.01) * 60 / TWO_PI;

  if (wantsReverse && speed < 1.5) state.gear = -1;
  else if (throttleAmount > 0.05 && state.gear < 1 && speed < 1.5) state.gear = 1;

  state.shiftSeconds = Math.max(0, state.shiftSeconds - Math.max(0, deltaSeconds));
  const ratio = state.gear < 0
    ? config.reverseRatio
    : config.gearRatios[Math.max(0, state.gear - 1)] ?? config.gearRatios.at(-1);
  const coupledRpm = wheelRpm * Math.abs(ratio) * config.finalDrive;
  const launchRpm = config.idleRpm + throttleAmount * config.launchRpmRise;
  state.clutch = clamp01(speed / config.clutchLockSpeed);
  state.engineRpm = clamp(
    Math.max(coupledRpm, launchRpm * (1 - state.clutch * 0.72)),
    config.idleRpm,
    config.redlineRpm
  );

  if (state.shiftSeconds <= 0 && state.gear > 0) {
    const lastGear = config.gearRatios.length;
    if (state.engineRpm >= config.upshiftRpm && state.gear < lastGear) {
      state.gear += 1;
      state.shiftSeconds = config.shiftDuration;
      state.shiftCount += 1;
    } else if (state.engineRpm <= config.downshiftRpm && state.gear > 1 && throttleAmount > 0.08) {
      state.gear -= 1;
      state.shiftSeconds = config.shiftDuration * 0.82;
      state.shiftCount += 1;
    }
  }

  const activeRatio = state.gear < 0
    ? Math.abs(config.reverseRatio)
    : config.gearRatios[Math.max(0, state.gear - 1)] ?? config.gearRatios.at(-1);
  state.torqueRatio = sampleTorqueCurve(state.engineRpm / config.redlineRpm);
  const ratioScale = activeRatio / config.gearRatios[0];
  state.driveScale = state.shiftSeconds > 0 ? 0 : state.torqueRatio * ratioScale;
  return state;
}

function clamp01(value) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
