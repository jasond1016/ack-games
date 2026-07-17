import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSignedVehicleSpeed,
  physicalVehicleConfig,
  resolvePhysicalVehicleDriveForces
} from "../racing-physical-vehicle.mjs";

test("车辆速度按车身前向轴区分前进和倒车", () => {
  const rotation = { x: 0, y: 0, z: 0, w: 1 };

  assert.equal(calculateSignedVehicleSpeed({
    velocity: { x: 0, y: 0, z: 8 },
    rotation
  }), 8);
  assert.equal(calculateSignedVehicleSpeed({
    velocity: { x: 0, y: 0, z: -6 },
    rotation
  }), -6);
});

test("按住倒车时只在车辆仍向前时制动", () => {
  const slowingForwardMotion = resolvePhysicalVehicleDriveForces({
    signedSpeed: 4,
    throttle: 0,
    brake: 1,
    boostActive: false,
    maxForwardSpeed: 50
  });
  assert.equal(slowingForwardMotion.engineForce, 0);
  assert.ok(slowingForwardMotion.brakeImpulse > 0);

  const reversing = resolvePhysicalVehicleDriveForces({
    signedSpeed: -4,
    throttle: 0,
    brake: 1,
    boostActive: false,
    maxForwardSpeed: 50
  });
  assert.ok(reversing.engineForce < 0);
  assert.equal(reversing.brakeImpulse, 0);
});

test("倒车力在接近倒车最高速度时平滑收敛", () => {
  const accelerating = resolvePhysicalVehicleDriveForces({
    signedSpeed: -4,
    throttle: 0,
    brake: 1,
    boostActive: false,
    maxForwardSpeed: 50
  });
  const limited = resolvePhysicalVehicleDriveForces({
    signedSpeed: -physicalVehicleConfig.maxReverseSpeed,
    throttle: 0,
    brake: 1,
    boostActive: false,
    maxForwardSpeed: 50
  });

  assert.ok(Math.abs(accelerating.engineForce) > Math.abs(limited.engineForce));
  assert.equal(limited.engineForce, 0);
});
