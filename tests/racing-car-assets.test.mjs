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
