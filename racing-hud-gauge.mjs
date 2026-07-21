/**
 * Display helpers for the racing HUD instrument cluster.
 * Read-only: never mutates drivetrain / vehicle feel (#3).
 */

export function formatGearLabel(gear) {
  const value = Number(gear);
  if (!Number.isFinite(value) || value === 0) return "N";
  if (value < 0) return "R";
  return String(Math.trunc(value));
}

export function resolveHudGaugeParams(vehicleSpec = {}) {
  const gearRatios = Array.isArray(vehicleSpec.gearRatios)
    ? Object.freeze([...vehicleSpec.gearRatios])
    : Object.freeze([]);
  return Object.freeze({
    idleRpm: Number(vehicleSpec.idleRpm) || 0,
    redlineRpm: Number(vehicleSpec.redlineRpm) || 0,
    upshiftRpm: Number(vehicleSpec.upshiftRpm) || 0,
    downshiftRpm: Number(vehicleSpec.downshiftRpm) || 0,
    gearCount: gearRatios.length,
    gearRatios,
    topSpeedKmh: Number(vehicleSpec.topSpeedKmh) || 0,
    finalDrive: Number(vehicleSpec.finalDrive) || 0
  });
}

export function resolveHudGaugeRpmFillRatio(engineRpm, params) {
  const redline = Math.max(1, Number(params?.redlineRpm) || 1);
  const idle = Math.max(0, Number(params?.idleRpm) || 0);
  const rpm = Math.max(idle, Number(engineRpm) || idle);
  return Math.max(0, Math.min(1, (rpm - idle) / Math.max(1, redline - idle)));
}

export function resolveHudGaugeReading({
  speedKmh = 0,
  drivetrain = null,
  vehicleSpec = {},
  frozen = false,
  previous = null
} = {}) {
  if (frozen && previous) {
    return previous;
  }

  const params = resolveHudGaugeParams(vehicleSpec);
  const gear = Number.isFinite(drivetrain?.gear) ? drivetrain.gear : 0;
  const engineRpm = Math.round(
    Number.isFinite(drivetrain?.engineRpm) ? drivetrain.engineRpm : params.idleRpm
  );
  return Object.freeze({
    speedKmh: Math.round(Number(speedKmh) || 0),
    engineRpm,
    gear,
    gearLabel: formatGearLabel(gear),
    rpmFillRatio: resolveHudGaugeRpmFillRatio(engineRpm, params),
    params
  });
}
