export function calculateEngineForce({
  engineForce,
  boostActive,
  boostMultiplier,
  controlScale,
  forwardSpeed,
  maxForwardSpeed,
  launchBoostThreshold,
  launchForceMultiplier
}) {
  const speedRatio = Math.max(0, forwardSpeed / maxForwardSpeed);
  const launchMultiplier = Math.abs(forwardSpeed) < launchBoostThreshold
    ? launchForceMultiplier
    : 1;
  return engineForce
    * (boostActive ? boostMultiplier : 1)
    * controlScale
    * launchMultiplier
    * (1 - speedRatio * 0.34);
}

export function calculateDriveRetention({
  deltaSeconds,
  speedSquared,
  rollingResistance,
  drag,
  onRoad,
  throttleActive,
  boostActive
}) {
  const poweredResistanceScale = throttleActive ? (boostActive ? 0.18 : 0.35) : 1;
  const rolling = Math.max(
    0,
    1 - rollingResistance * deltaSeconds * (onRoad ? 1 : 1.1) * poweredResistanceScale
  );
  const aerodynamic = Math.max(
    0,
    1 - speedSquared * drag * deltaSeconds * 0.01 * poweredResistanceScale
  );
  return rolling * aerodynamic;
}

export function calculateSurfaceSpeedLimit({
  baseSpeed,
  onRoad,
  offRoadMultiplier = 0.9
}) {
  return baseSpeed * (onRoad ? 1 : offRoadMultiplier);
}

export function resolvePlayerDrift({
  enabled,
  drifting,
  onRoad,
  controlScale,
  throttle,
  steering,
  forwardSpeed,
  entrySpeed,
  sustainSpeed,
  steerThreshold,
  throttleThreshold = 0.7
}) {
  if (!enabled || !onRoad || controlScale < 0.95) return false;

  const speed = Math.abs(forwardSpeed);
  const steer = Math.abs(steering);
  if (drifting) {
    return speed > sustainSpeed && steer > 0.08 && throttle >= throttleThreshold * 0.6;
  }

  return speed > entrySpeed && steer > steerThreshold && throttle >= throttleThreshold;
}

export function shouldActivateComputerBoost({
  elapsedSeconds,
  boostSeconds,
  boostCharges,
  totalCharges,
  activationTimesSeconds,
  eligible
}) {
  if (!eligible || boostSeconds > 0 || boostCharges <= 0) return false;
  const boostsUsed = Math.max(0, totalCharges - boostCharges);
  const activationTime = activationTimesSeconds[boostsUsed];
  return Number.isFinite(activationTime) && elapsedSeconds >= activationTime;
}
