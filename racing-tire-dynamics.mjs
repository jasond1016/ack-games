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
  driveScale = 1,
  drivenWheelIndexes = [0, 1, 2, 3]
} = {}) {
  const grip = tireSurfaceGrip(surfaceId);
  const contactScale = grounded ? 1 : 0;
  const drivenCount = Math.max(1, drivenWheelIndexes.length);
  const requestedDrive = clamp01(throttle) * engineForcePerWheel * driveScale * drivenCount;
  const availableDrive = Math.max(1, mass * 9.81 * grip * 0.78);
  const driveExcess = Math.max(0, requestedDrive / availableDrive - 0.82);
  const lateralRatio = Math.abs(lateralSpeed) / (Math.abs(signedSpeed) + 3.5);
  const steeringLoad = Math.abs(steering) * Math.min(1, Math.abs(signedSpeed) / 22);
  const brakingSlip = clamp01(brake) * Math.min(1, Math.abs(signedSpeed) / 8) * (1.08 - grip);

  const wheels = Array.from({ length: 4 }, (_, index) => {
    const driven = drivenWheelIndexes.includes(index);
    const front = index < 2;
    const longitudinalSlip = clamp01((
      (driven ? driveExcess * 0.72 : 0)
      + brakingSlip * 1.25
      + (driven ? clamp01(throttle) * (1 - grip) * 0.34 : 0)
    ) * contactScale);
    const lateralSlip = clamp01((
      lateralRatio * 1.35
      + (front ? steeringLoad * 0.28 : steeringLoad * 0.12)
      + (1 - grip) * Math.abs(steering) * 0.16
    ) * contactScale);
    return Object.freeze({
      index,
      driven,
      longitudinalSlip,
      lateralSlip,
      combinedSlip: clamp01(Math.hypot(longitudinalSlip, lateralSlip))
    });
  });
  const maximumSlip = Math.max(...wheels.map(({ combinedSlip }) => combinedSlip));
  const drivenSlip = Math.max(0, ...wheels.filter(({ driven }) => driven).map(({ longitudinalSlip }) => longitudinalSlip));
  const tractionControlActive = grounded && throttle > 0.16 && drivenSlip > 0.12;
  const absActive = grounded && brake > 0.28 && Math.abs(signedSpeed) > 3 && brakingSlip > 0.08;
  return Object.freeze({
    surfaceId,
    grip,
    wheels: Object.freeze(wheels),
    maximumSlip,
    tractionControlActive,
    absActive,
    engineScale: tractionControlActive ? Math.max(0.42, 1 - drivenSlip * 0.72) : 1,
    brakeScale: absActive ? Math.max(0.5, 0.82 - brakingSlip * 0.35) : 1,
    squeal: clamp01((maximumSlip - 0.1) * 1.7)
  });
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
