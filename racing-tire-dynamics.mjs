const surfaceGrip = Object.freeze({
  road: 1,
  bridge: 0.98,
  "stunt-ramp": 0.94,
  verge: 0.82,
  embankment: 0.76,
  "rally-dirt": 0.7,
  gravel: 0.68,
  ground: 0.62
});

/** Scales ABS-available brake impulse. >1 shortens stopping without changing drive/lateral grip tables. */
export const BRAKE_FRICTION_AUTHORITY = 1.4;

export function tireSurfaceGrip(surfaceId) {
  return surfaceGrip[surfaceId] ?? 0.88;
}

export function calculateTireDynamics({
  signedSpeed = 0,
  lateralSpeed = 0,
  throttle = 0,
  brake = 0,
  steering = 0,
  surfaceId = "road",
  grounded = true,
  mass = 1250,
  engineForcePerWheel = 4800,
  requestedEngineForcePerWheel = null,
  requestedBrakeImpulsePerWheel = 0,
  driveScale = 1,
  drivenWheelIndexes = [0, 1, 2, 3],
  wheelLoads = null,
  previousWheelState = null,
  deltaSeconds = 1 / 60
} = {}) {
  const grip = tireSurfaceGrip(surfaceId);
  const contactScale = grounded ? 1 : 0;
  const fallbackEngineForce = clamp01(throttle) * engineForcePerWheel * driveScale;
  const requestedEngineForce = Number.isFinite(requestedEngineForcePerWheel)
    ? Math.abs(requestedEngineForcePerWheel)
    : fallbackEngineForce;
  const requestedBrakeImpulse = Math.max(0,
    Number.isFinite(requestedBrakeImpulsePerWheel) ? requestedBrakeImpulsePerWheel : 0
  );
  const loads = Array.from({ length: 4 }, (_, index) => Math.max(1,
    Number.isFinite(wheelLoads?.[index]) ? wheelLoads[index] : mass * 9.81 / 4
  ));
  const step = Math.max(0, Math.min(0.1, Number.isFinite(deltaSeconds) ? deltaSeconds : 1 / 60));
  const lateralRatio = Math.abs(lateralSpeed) / (Math.abs(signedSpeed) + 3.5);
  const steeringLoad = Math.abs(steering) * Math.min(1, Math.abs(signedSpeed) / 22);

  const wheels = Array.from({ length: 4 }, (_, index) => {
    const driven = drivenWheelIndexes.includes(index);
    const front = index < 2;
    const normalLoad = loads[index];
    const driveDemandRatio = driven ? requestedEngineForce / Math.max(1, normalLoad * grip) : 0;
    const driveSlip = Math.max(0, driveDemandRatio - 1);
    const availableEngineForce = normalLoad * grip;
    const engineScale = grounded && driven && requestedEngineForce > 0
      ? clamp01(availableEngineForce / requestedEngineForce)
      : 1;
    const tractionControlActive = grounded && driven && requestedEngineForce > 0 && engineScale < 1;
    const previousPressure = clamp01(previousWheelState?.[index]?.brakeScale ?? 1);
    const availableBrakeImpulse = normalLoad * grip * step * BRAKE_FRICTION_AUTHORITY;
    const targetBrakeScale = grounded && requestedBrakeImpulse > 0
      ? clamp01(availableBrakeImpulse / requestedBrakeImpulse)
      : 1;
    const pressureRate = targetBrakeScale < previousPressure ? 8 : 2.2;
    const brakeScale = moveToward(previousPressure, targetBrakeScale, pressureRate * step);
    const controlledBrakeImpulse = requestedBrakeImpulse * brakeScale;
    const brakeDemandRatio = controlledBrakeImpulse / Math.max(1e-6, availableBrakeImpulse);
    const brakeSlip = requestedBrakeImpulse > 0 ? Math.max(0, brakeDemandRatio - 1) : 0;
    const rawLongitudinalSlip = (driveSlip + brakeSlip) * contactScale;
    const longitudinalSlip = clamp01(rawLongitudinalSlip);
    // ABS remains active while pressure is limited, not only during pressure release.
    const absActive = grounded && requestedBrakeImpulse > 0 && (targetBrakeScale < 1 || brakeScale < 1);
    const lateralSlipRaw = (
      lateralRatio * 1.35
      + (front ? steeringLoad * 0.28 : steeringLoad * 0.12)
      + (1 - grip) * Math.abs(steering) * 0.16
    ) * contactScale;
    const lateralSlip = clamp01(lateralSlipRaw);
    const combinedSlipRaw = Math.hypot(rawLongitudinalSlip, lateralSlipRaw);
    return Object.freeze({
      index,
      driven,
      normalLoad,
      longitudinalSlip,
      lateralSlip,
      combinedSlip: clamp01(combinedSlipRaw),
      combinedSlipRaw,
      tractionControlActive,
      engineScale,
      absActive,
      brakeScale
    });
  });
  // Report unclamped peak slip so car-to-car separation is measurable past the old 1.0 ceiling.
  const maximumSlip = Math.max(0, ...wheels.map(({ combinedSlipRaw }) => combinedSlipRaw));
  const tractionControlActive = wheels.some((wheel) => wheel.tractionControlActive);
  const absActive = wheels.some((wheel) => wheel.absActive);
  return Object.freeze({
    surfaceId,
    grip,
    wheels: Object.freeze(wheels),
    maximumSlip,
    tractionControlActive,
    absActive,
    engineScale: Math.min(...wheels.filter(({ driven }) => driven).map(({ engineScale }) => engineScale), 1),
    brakeScale: Math.min(...wheels.map(({ brakeScale }) => brakeScale)),
    squeal: clamp01((maximumSlip - 0.1) * 1.7)
  });
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function moveToward(value, target, maximumDelta) {
  if (value < target) return Math.min(target, value + maximumDelta);
  return Math.max(target, value - maximumDelta);
}
