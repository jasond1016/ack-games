export const physicalVehicleConfig = Object.freeze({
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
  downforce: 18
});

export function createPhysicalVehicle({ world, chassis }) {
  const config = physicalVehicleConfig;
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
    controller,
    wheelPositions,
    contactCount: 0,
    speed: 0,
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
  maxForwardSpeed
}) {
  const config = physicalVehicleConfig;
  const forwardSpeedRatio = Math.min(1, Math.max(0, signedSpeed) / Math.max(maxForwardSpeed, 0.001));
  const forwardDriveScale = Math.max(0, 1 - forwardSpeedRatio * forwardSpeedRatio);
  let engineForce = throttle
    * config.engineForcePerWheel
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
  acceptsGroundCollider
}) {
  const config = physicalVehicleConfig;
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
  const { engineForce, brakeImpulse } = resolvePhysicalVehicleDriveForces({
    signedSpeed,
    throttle,
    brake,
    boostActive,
    maxForwardSpeed
  });

  for (let index = 0; index < vehicle.wheelPositions.length; index += 1) {
    controller.setWheelSteering(index, vehicle.wheelPositions[index].front ? steeringAngle : 0);
    controller.setWheelEngineForce(index, engineForce);
    controller.setWheelBrake(index, brakeImpulse);
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
  vehicle.steeringAngle = 0;
}
