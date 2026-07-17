import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSignedVehicleSpeed,
  drivenWheelIndexesFor,
  getPhysicalVehicleSpec,
  physicalVehicleConfig,
  resolvePhysicalVehicleDriveForces
} from "../racing-physical-vehicle.mjs";

const racingCarIds = [
  "aventador", "urus-se", "miura-p400", "countach-lpi-800-4", "dbr9", "bolide",
  "centodieci", "revuelto", "aventador-classic", "countach-5000qv", "huracan-sto", "veneno"
];

test("每辆参赛车都有独立且有效的物理规格", () => {
  const specs = racingCarIds.map(getPhysicalVehicleSpec);
  assert.equal(new Set(specs.map(({ id }) => id)).size, racingCarIds.length);
  assert.ok(specs.every(({ mass, wheelBase, wheelTrack, wheelRadius }) =>
    mass > 900 && wheelBase > 1.7 && wheelTrack > 1 && wheelRadius > 0.35
  ));
  assert.notEqual(getPhysicalVehicleSpec("urus-se").mass, getPhysicalVehicleSpec("bolide").mass);
  assert.notEqual(getPhysicalVehicleSpec("miura-p400").suspensionStiffness, getPhysicalVehicleSpec("dbr9").suspensionStiffness);
});

test("驱动形式决定获得发动机力的车轮", () => {
  assert.deepEqual(drivenWheelIndexesFor(getPhysicalVehicleSpec("miura-p400")), [2, 3]);
  assert.deepEqual(drivenWheelIndexesFor(getPhysicalVehicleSpec("aventador")), [0, 1, 2, 3]);
});

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
