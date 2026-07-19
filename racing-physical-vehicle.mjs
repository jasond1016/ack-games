import { createDrivetrainState, updateAutomaticDrivetrain } from "./racing-drivetrain.mjs";
import { calculateTireDynamics } from "./racing-tire-dynamics.mjs";

export const physicalVehicleConfig = Object.freeze({
  id: "aventador",
  driveLayout: "awd",
  topSpeedKmh: 180,
  speedLimiterStartRatio: 0,
  mass: 1250,
  chassisHalfWidth: 1.3,
  chassisHalfHeight: 0.34,
  chassisHalfLength: 2.35,
  chassisRoundRadius: 0.14,
  visualGroundOffset: 1.11,
  spawnHeight: 1.34,
  wheelTrack: 1.28,
  wheelBase: 2.05,
  wheelConnectionHeight: -0.24,
  wheelRadius: 0.44,
  suspensionRestLength: 0.52,
  suspensionTravel: 0.34,
  suspensionStiffness: 34,
  suspensionCompression: 5.4,
  suspensionRelaxation: 6.8,
  maxSuspensionForce: 18000,
  frictionSlip: 3.1,
  sideFrictionStiffness: 1.15,
  engineForcePerWheel: 4800,
  reverseForcePerWheel: 3600,
  maxReverseSpeed: 18,
  brakeImpulsePerWheel: 105,
  maxSteeringAngle: 0.42,
  minSteeringAngle: 0.12,
  aerodynamicDrag: 1.2,
  rollingDrag: 95,
  downforce: 18,
  idleRpm: 850,
  redlineRpm: 8500,
  upshiftRpm: 7850,
  downshiftRpm: 3300,
  finalDrive: 3.73,
  gearRatios: Object.freeze([2.92, 1.88, 1.31, 0.97, 0.76, 0.62, 0.52]),
  reverseRatio: 2.79,
  shiftDuration: 0.16,
  launchRpmRise: 2400,
  clutchLockSpeed: 8.5
});

const vehicleOverrides = Object.freeze({
  "urus-se": { topSpeedKmh: 312, speedLimiterStartRatio: 0.95, mass: 2150, driveLayout: "awd", chassisHalfWidth: 1.18, chassisHalfHeight: 0.52, chassisHalfLength: 2.5, visualGroundOffset: 1.34, spawnHeight: 1.58, wheelTrack: 1.34, wheelBase: 2.18, wheelRadius: 0.5, suspensionRestLength: 0.58, suspensionTravel: 0.38, suspensionStiffness: 38, suspensionCompression: 6.2, suspensionRelaxation: 7.4, engineForcePerWheel: 6000, brakeImpulsePerWheel: 125, sideFrictionStiffness: 1.05, aerodynamicDrag: 0.58, rollingDrag: 320, downforce: 12, idleRpm: 720, redlineRpm: 6800, upshiftRpm: 6250, downshiftRpm: 2200, finalDrive: 3.27, gearRatios: Object.freeze([5, 3.2, 2.14, 1.72, 1.31, 1, 0.82, 0.64]) },
  "miura-p400": { topSpeedKmh: 280, speedLimiterStartRatio: 0.95, mass: 1290, driveLayout: "rwd", chassisHalfWidth: 1.02, chassisHalfHeight: 0.33, chassisHalfLength: 2.12, visualGroundOffset: 1.02, spawnHeight: 1.26, wheelTrack: 1.18, wheelBase: 1.88, wheelRadius: 0.4, suspensionStiffness: 28, suspensionCompression: 4.7, suspensionRelaxation: 6.1, engineForcePerWheel: 6200, brakeImpulsePerWheel: 92, frictionSlip: 2.72, sideFrictionStiffness: 0.92, aerodynamicDrag: 0.4, rollingDrag: 190, downforce: 5, idleRpm: 900, redlineRpm: 7700, upshiftRpm: 7200, downshiftRpm: 3000, finalDrive: 3.77, gearRatios: Object.freeze([2.52, 1.74, 1.23, 0.96, 0.79]), shiftDuration: 0.24 },
  "countach-lpi-800-4": { mass: 1595, driveLayout: "awd", chassisHalfWidth: 1.13, chassisHalfLength: 2.34, wheelTrack: 1.27, wheelBase: 2.04, wheelRadius: 0.44, suspensionStiffness: 36, engineForcePerWheel: 5050, brakeImpulsePerWheel: 112, downforce: 21 },
  dbr9: { mass: 1100, driveLayout: "rwd", chassisHalfWidth: 1.1, chassisHalfHeight: 0.3, chassisHalfLength: 2.28, visualGroundOffset: 1.06, spawnHeight: 1.28, wheelTrack: 1.3, wheelBase: 2.1, wheelRadius: 0.43, suspensionRestLength: 0.45, suspensionTravel: 0.26, suspensionStiffness: 48, suspensionCompression: 7.2, suspensionRelaxation: 8.4, engineForcePerWheel: 7800, brakeImpulsePerWheel: 138, frictionSlip: 3.45, sideFrictionStiffness: 1.34, aerodynamicDrag: 1.35, downforce: 42, idleRpm: 900, redlineRpm: 7200, upshiftRpm: 6800, downshiftRpm: 3600, finalDrive: 3.54, gearRatios: Object.freeze([2.64, 1.88, 1.42, 1.14, 0.96, 0.82]), shiftDuration: 0.11 },
  bolide: { mass: 1240, driveLayout: "awd", chassisHalfWidth: 1.16, chassisHalfHeight: 0.29, chassisHalfLength: 2.3, visualGroundOffset: 1.0, spawnHeight: 1.24, wheelTrack: 1.32, wheelBase: 2.12, wheelRadius: 0.44, suspensionRestLength: 0.44, suspensionTravel: 0.25, suspensionStiffness: 52, suspensionCompression: 7.6, suspensionRelaxation: 8.8, engineForcePerWheel: 6100, brakeImpulsePerWheel: 142, frictionSlip: 3.58, sideFrictionStiffness: 1.42, aerodynamicDrag: 1.4, downforce: 58, redlineRpm: 8600, upshiftRpm: 8150, downshiftRpm: 3900, finalDrive: 3.44, gearRatios: Object.freeze([2.9, 2.03, 1.52, 1.2, 0.98, 0.81, 0.68]), shiftDuration: 0.09 },
  centodieci: { mass: 1975, driveLayout: "awd", chassisHalfWidth: 1.14, chassisHalfHeight: 0.35, chassisHalfLength: 2.23, visualGroundOffset: 1.1, spawnHeight: 1.34, wheelTrack: 1.28, wheelBase: 1.98, wheelRadius: 0.45, suspensionStiffness: 39, engineForcePerWheel: 5900, brakeImpulsePerWheel: 126, frictionSlip: 3.25, sideFrictionStiffness: 1.2, aerodynamicDrag: 1.28, downforce: 27 },
  revuelto: { mass: 1772, driveLayout: "awd", chassisHalfWidth: 1.14, chassisHalfHeight: 0.34, chassisHalfLength: 2.38, wheelTrack: 1.3, wheelBase: 2.09, wheelRadius: 0.45, suspensionStiffness: 38, engineForcePerWheel: 5650, brakeImpulsePerWheel: 122, frictionSlip: 3.3, sideFrictionStiffness: 1.24, downforce: 29 },
  "aventador-classic": { mass: 1575, driveLayout: "awd", chassisHalfWidth: 1.14, chassisHalfHeight: 0.34, chassisHalfLength: 2.32, wheelTrack: 1.28, wheelBase: 2.04, wheelRadius: 0.44, engineForcePerWheel: 4900, brakeImpulsePerWheel: 110, downforce: 19 },
  "countach-5000qv": { mass: 1490, driveLayout: "rwd", chassisHalfWidth: 1.04, chassisHalfHeight: 0.35, chassisHalfLength: 2.0, visualGroundOffset: 1.04, spawnHeight: 1.28, wheelTrack: 1.2, wheelBase: 1.86, wheelRadius: 0.42, suspensionStiffness: 30, suspensionCompression: 4.9, suspensionRelaxation: 6.2, engineForcePerWheel: 6800, brakeImpulsePerWheel: 98, frictionSlip: 2.82, sideFrictionStiffness: 0.98, downforce: 7 },
  "huracan-sto": { mass: 1339, driveLayout: "rwd", chassisHalfWidth: 1.1, chassisHalfHeight: 0.31, chassisHalfLength: 2.18, visualGroundOffset: 1.04, spawnHeight: 1.27, wheelTrack: 1.27, wheelBase: 1.96, wheelRadius: 0.43, suspensionRestLength: 0.46, suspensionTravel: 0.27, suspensionStiffness: 44, suspensionCompression: 6.8, suspensionRelaxation: 8, engineForcePerWheel: 7500, brakeImpulsePerWheel: 134, frictionSlip: 3.42, sideFrictionStiffness: 1.35, downforce: 39 },
  veneno: { topSpeedKmh: 355, speedLimiterStartRatio: 0.95, mass: 1490, driveLayout: "awd", chassisHalfWidth: 1.15, chassisHalfHeight: 0.31, chassisHalfLength: 2.42, visualGroundOffset: 1.04, spawnHeight: 1.28, wheelTrack: 1.31, wheelBase: 2.12, wheelRadius: 0.44, suspensionStiffness: 43, engineForcePerWheel: 5700, brakeImpulsePerWheel: 128, frictionSlip: 3.38, sideFrictionStiffness: 1.31, aerodynamicDrag: 0.42, rollingDrag: 220, downforce: 37 }
});

const physicalVehicleSpecs = new Map([
  [physicalVehicleConfig.id, physicalVehicleConfig],
  ...Object.entries(vehicleOverrides).map(([id, overrides]) => [id, Object.freeze({
    ...physicalVehicleConfig,
    ...overrides,
    id
  })])
]);

export function getPhysicalVehicleSpec(carId) {
  return physicalVehicleSpecs.get(carId) ?? physicalVehicleConfig;
}

export function drivenWheelIndexesFor(config = physicalVehicleConfig) {
  if (config.driveLayout === "fwd") return Object.freeze([0, 1]);
  if (config.driveLayout === "rwd") return Object.freeze([2, 3]);
  return Object.freeze([0, 1, 2, 3]);
}

export function calculateLongitudinalWheelLoads({
  mass = physicalVehicleConfig.mass,
  longitudinalAcceleration = 0,
  config = physicalVehicleConfig
} = {}) {
  const gravity = 9.81;
  const totalLoad = mass * gravity;
  const fullWheelbase = Math.max(0.1, config.wheelBase * 2);
  const centerOfMassHeight = Math.max(0.3, Math.min(0.8,
    config.chassisHalfHeight + config.wheelRadius * 0.45
  ));
  const acceleration = Math.max(-gravity * 1.2, Math.min(gravity * 1.2, longitudinalAcceleration));
  const transfer = Math.max(-totalLoad * 0.35, Math.min(totalLoad * 0.35,
    mass * acceleration * centerOfMassHeight / fullWheelbase
  ));
  const frontWheelLoad = (totalLoad / 2 - transfer) / 2;
  const rearWheelLoad = (totalLoad / 2 + transfer) / 2;
  return Object.freeze([frontWheelLoad, frontWheelLoad, rearWheelLoad, rearWheelLoad]);
}

export function createPhysicalVehicle({ world, chassis, config = physicalVehicleConfig }) {
  const controller = world.createVehicleController(chassis);
  controller.indexUpAxis = 1;

  const wheelPositions = [
    { x: -config.wheelTrack, y: config.wheelConnectionHeight, z: config.wheelBase, front: true },
    { x: config.wheelTrack, y: config.wheelConnectionHeight, z: config.wheelBase, front: true },
    { x: -config.wheelTrack, y: config.wheelConnectionHeight, z: -config.wheelBase, front: false },
    { x: config.wheelTrack, y: config.wheelConnectionHeight, z: -config.wheelBase, front: false }
  ];

  for (const wheel of wheelPositions) {
    controller.addWheel(
      { x: wheel.x, y: wheel.y, z: wheel.z },
      { x: 0, y: -1, z: 0 },
      { x: -1, y: 0, z: 0 },
      config.suspensionRestLength,
      config.wheelRadius
    );
  }

  for (let index = 0; index < wheelPositions.length; index += 1) {
    controller.setWheelMaxSuspensionTravel(index, config.suspensionTravel);
    controller.setWheelSuspensionStiffness(index, config.suspensionStiffness);
    controller.setWheelSuspensionCompression(index, config.suspensionCompression);
    controller.setWheelSuspensionRelaxation(index, config.suspensionRelaxation);
    controller.setWheelMaxSuspensionForce(index, config.maxSuspensionForce);
    controller.setWheelFrictionSlip(index, config.frictionSlip);
    controller.setWheelSideFrictionStiffness(index, config.sideFrictionStiffness);
  }

  return {
    config,
    drivenWheelIndexes: drivenWheelIndexesFor(config),
    drivetrain: createDrivetrainState(config),
    tireDynamics: calculateTireDynamics(),
    controller,
    wheelPositions,
    contactCount: 0,
    speed: 0,
    previousSignedSpeed: null,
    engineForce: 0,
    brakeImpulse: 0,
    steeringAngle: 0,
    suspensionLengths: wheelPositions.map(() => config.suspensionRestLength)
  };
}

export function calculateSignedVehicleSpeed({ velocity, rotation }) {
  const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
  const forwardY = 2 * (rotation.y * rotation.z - rotation.w * rotation.x);
  const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
  return velocity.x * forwardX + velocity.y * forwardY + velocity.z * forwardZ;
}

export function resolvePhysicalVehicleDriveForces({
  signedSpeed,
  throttle,
  brake,
  boostActive,
  maxForwardSpeed,
  config = physicalVehicleConfig,
  driveScale = 1
}) {
  const forwardSpeedRatio = Math.min(1, Math.max(0, signedSpeed) / Math.max(maxForwardSpeed, 0.001));
  const limiterStartRatio = config.speedLimiterStartRatio ?? 0;
  const limiterProgress = Math.max(0, Math.min(1,
    (forwardSpeedRatio - limiterStartRatio) / Math.max(1 - limiterStartRatio, 0.001)
  ));
  const forwardDriveScale = limiterStartRatio > 0
    ? 1 - limiterProgress * limiterProgress * (3 - 2 * limiterProgress)
    : Math.max(0, 1 - forwardSpeedRatio * forwardSpeedRatio);
  let engineForce = throttle
    * config.engineForcePerWheel
    * driveScale
    * forwardDriveScale
    * (boostActive ? 2.15 : 1);
  let brakeImpulse = 0;

  if (throttle > 0 && signedSpeed < -1.2) {
    engineForce = 0;
    brakeImpulse = config.brakeImpulsePerWheel * throttle;
  }

  if (brake > 0) {
    if (signedSpeed > 1.2) {
      brakeImpulse = config.brakeImpulsePerWheel * brake;
      engineForce = 0;
    } else {
      const reverseSpeedRatio = Math.min(1, Math.max(0, -signedSpeed) / config.maxReverseSpeed);
      const reverseDriveScale = Math.max(0, 1 - reverseSpeedRatio * reverseSpeedRatio);
      engineForce = reverseDriveScale > 0
        ? -config.reverseForcePerWheel * brake * reverseDriveScale
        : 0;
      brakeImpulse = 0;
    }
  }

  return { engineForce, brakeImpulse };
}

export function updatePhysicalVehicle({
  vehicle,
  chassis,
  deltaSeconds,
  throttle,
  brake,
  steering,
  boostActive,
  maxForwardSpeed,
  acceptsGroundCollider,
  surfaceId = "road",
  grounded = true
}) {
  const config = vehicle.config ?? physicalVehicleConfig;
  const controller = vehicle.controller;
  const velocity = chassis.linvel();
  const signedSpeed = calculateSignedVehicleSpeed({
    velocity,
    rotation: chassis.rotation()
  });
  const speed = Math.hypot(velocity.x, velocity.z);
  const speedRatio = Math.min(1, speed / Math.max(maxForwardSpeed, 0.001));
  const steeringLimit = config.maxSteeringAngle
    + (config.minSteeringAngle - config.maxSteeringAngle) * speedRatio;
  const steeringAngle = steering * steeringLimit;
  updateAutomaticDrivetrain({
    state: vehicle.drivetrain,
    config,
    signedSpeed,
    throttle,
    reverseInput: brake,
    deltaSeconds
  });
  const driveForces = resolvePhysicalVehicleDriveForces({
    signedSpeed,
    throttle,
    brake,
    boostActive,
    maxForwardSpeed,
    config,
    driveScale: vehicle.drivetrain.driveScale
  });
  const rotation = chassis.rotation();
  const forwardX = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
  const forwardZ = 1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y);
  const lateralSpeed = velocity.x * forwardZ - velocity.z * forwardX;
  const measuredAcceleration = vehicle.previousSignedSpeed == null || deltaSeconds <= 0
    ? 0
    : (signedSpeed - vehicle.previousSignedSpeed) / deltaSeconds;
  const wheelLoads = calculateLongitudinalWheelLoads({
    mass: config.mass,
    longitudinalAcceleration: measuredAcceleration,
    config
  });
  const previousWheels = vehicle.tireDynamics?.wheels;
  vehicle.tireDynamics = calculateTireDynamics({
    signedSpeed,
    lateralSpeed,
    throttle,
    brake,
    steering,
    surfaceId,
    grounded,
    mass: config.mass,
    engineForcePerWheel: config.engineForcePerWheel,
    requestedEngineForcePerWheel: driveForces.engineForce,
    requestedBrakeImpulsePerWheel: driveForces.brakeImpulse,
    driveScale: vehicle.drivetrain.driveScale,
    drivenWheelIndexes: vehicle.drivenWheelIndexes,
    wheelLoads,
    previousWheelState: previousWheels,
    deltaSeconds
  });
  const engineForce = driveForces.engineForce * vehicle.tireDynamics.engineScale;
  const brakeImpulse = driveForces.brakeImpulse * vehicle.tireDynamics.brakeScale;
  vehicle.engineForce = engineForce;
  vehicle.brakeImpulse = brakeImpulse;

  for (let index = 0; index < vehicle.wheelPositions.length; index += 1) {
    controller.setWheelFrictionSlip(index, config.frictionSlip * vehicle.tireDynamics.grip);
    controller.setWheelSteering(index, vehicle.wheelPositions[index].front ? steeringAngle : 0);
    const wheelDynamics = vehicle.tireDynamics.wheels[index];
    controller.setWheelEngineForce(index, wheelDynamics.driven
      ? driveForces.engineForce * wheelDynamics.engineScale
      : 0);
    controller.setWheelBrake(index, driveForces.brakeImpulse * wheelDynamics.brakeScale);
  }

  chassis.resetForces(true);
  chassis.resetTorques(true);
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  if (planarSpeed > 0.001) {
    const dragMagnitude = config.rollingDrag + config.aerodynamicDrag * planarSpeed * planarSpeed;
    chassis.addForce({
      x: -velocity.x / planarSpeed * dragMagnitude,
      y: -config.downforce * planarSpeed,
      z: -velocity.z / planarSpeed * dragMagnitude
    }, true);
  }

  controller.updateVehicle(
    deltaSeconds,
    undefined,
    undefined,
    acceptsGroundCollider
  );

  vehicle.contactCount = 0;
  vehicle.speed = signedSpeed;
  vehicle.previousSignedSpeed = signedSpeed;
  vehicle.steeringAngle = steeringAngle;
  for (let index = 0; index < vehicle.wheelPositions.length; index += 1) {
    if (controller.wheelIsInContact(index)) vehicle.contactCount += 1;
    vehicle.suspensionLengths[index] = controller.wheelSuspensionLength(index)
      ?? config.suspensionRestLength;
  }

  return vehicle;
}

export function resetPhysicalVehicleControls(vehicle) {
  if (!vehicle) return;
  for (let index = 0; index < vehicle.wheelPositions.length; index += 1) {
    vehicle.controller.setWheelSteering(index, 0);
    vehicle.controller.setWheelEngineForce(index, 0);
    vehicle.controller.setWheelBrake(index, 0);
  }
  vehicle.contactCount = 0;
  vehicle.speed = 0;
  vehicle.previousSignedSpeed = null;
  vehicle.engineForce = 0;
  vehicle.brakeImpulse = 0;
  vehicle.steeringAngle = 0;
  vehicle.drivetrain = createDrivetrainState(vehicle.config ?? physicalVehicleConfig);
  vehicle.tireDynamics = calculateTireDynamics();
}
