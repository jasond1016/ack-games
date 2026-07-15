import assert from "node:assert/strict";
import test from "node:test";

import { racingCarCatalog } from "../racing-car-config.js";

test("local racing cars load optimized full and preview models", () => {
  for (const car of racingCarCatalog) {
    assert.match(
      new URL(car.modelUrl).pathname,
      new RegExp(`/assets/cars-optimized/${car.id}\\.glb$`),
      `${car.id} should use its optimized full model`
    );
    assert.match(
      new URL(car.previewModelUrl).pathname,
      new RegExp(`/assets/cars-preview-optimized/${car.id}\\.glb$`),
      `${car.id} should use its optimized preview model`
    );
  }
});

test("every racing car declares its own nitro exhaust layout", () => {
  for (const car of racingCarCatalog) {
    assert.ok(Array.isArray(car.boostExhausts), `${car.id} should declare boostExhausts`);
    assert.ok(car.boostExhausts.length > 0, `${car.id} should have at least one exhaust outlet`);
    for (const exhaust of car.boostExhausts) {
      for (const coordinate of [exhaust.x, exhaust.y, exhaust.z]) {
        assert.ok(Number.isFinite(coordinate), `${car.id} exhaust coordinates must be finite`);
      }
      if (exhaust.direction) {
        assert.equal(exhaust.direction.length, 3, `${car.id} exhaust direction must be a 3D vector`);
        assert.ok(exhaust.direction.every(Number.isFinite), `${car.id} exhaust direction must be finite`);
      }
    }
  }
});

test("only the Aventador LP720-4 50th has drift tuning", () => {
  const driftCars = racingCarCatalog.filter((car) => car.drift?.enabled);
  assert.deepEqual(driftCars.map((car) => car.id), ["aventador"]);
});
