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
    1 - rollingResistance * deltaSeconds * (onRoad ? 1 : 1.75) * poweredResistanceScale
  );
  const aerodynamic = Math.max(
    0,
    1 - speedSquared * drag * deltaSeconds * 0.01 * poweredResistanceScale
  );
  return rolling * aerodynamic;
}
