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
