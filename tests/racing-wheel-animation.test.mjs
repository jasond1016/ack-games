import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWheelSpin,
  createWheelAnimationState,
  findWheelGeometryLayout,
  isWheelVisualLabel
} from "../racing-wheel-animation.mjs";

test("wheel labels include tires and rims but exclude the steering wheel", () => {
  assert.equal(isWheelVisualLabel("Mesh:M_Tire_High tire_0"), true);
  assert.equal(isWheelVisualLabel("rear-wheel rim"), true);
  assert.equal(isWheelVisualLabel("interior_steering_wheel"), false);
  assert.equal(isWheelVisualLabel("carpaint chassis"), false);
});

test("combined wheel geometry is separated into four wheel centers", () => {
  const vertices = [];
  for (const z of [-2, 2]) {
    for (const x of [-1, 1]) {
      vertices.push(
        x - 0.2, 0, z - 0.4,
        x + 0.2, 0, z - 0.4,
        x - 0.2, 0.8, z + 0.4,
        x + 0.2, 0.8, z + 0.4
      );
    }
  }
  const layout = findWheelGeometryLayout(vertices);
  assert.equal(layout.combined, true);
  assert.equal(layout.centers.length, 4);
  assert.deepEqual(layout.centers.map(({ x, z }) => [x, z]), [
    [-1, 2], [1, 2], [-1, -2], [1, -2]
  ]);
});

test("an individual wheel mesh keeps one geometry center", () => {
  const layout = findWheelGeometryLayout([
    -0.2, -0.4, -0.4,
    0.2, -0.4, -0.4,
    -0.2, 0.4, 0.4,
    0.2, 0.4, 0.4
  ]);
  assert.equal(layout.combined, false);
  assert.deepEqual(layout.centers, [{ x: 0, y: 0, z: 0 }]);
});

test("invalid motion values cannot poison wheel animation uniforms", () => {
  assert.deepEqual(createWheelAnimationState({ spinAngle: NaN, steeringAngle: Infinity }), {
    spinAngle: 0,
    steeringAngle: 0
  });
});

test("wheel spin follows signed vehicle speed and freezes at rest", () => {
  const forward = advanceWheelSpin({ spinAngle: 0, signedSpeed: 12, deltaSeconds: 0.1, wheelRadius: 0.4 });
  const reverse = advanceWheelSpin({ spinAngle: 0, signedSpeed: -12, deltaSeconds: 0.1, wheelRadius: 0.4 });
  assert.ok(forward > 0);
  assert.ok(reverse < 0);
  assert.equal(advanceWheelSpin({ spinAngle: forward, signedSpeed: 0.04, deltaSeconds: 1 }), forward);
});
