import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWheelSpin,
  classifyWheelVisualRole,
  createWheelAnimationState,
  findWheelGeometryLayout,
  isWheelVisualLabel,
  resolveWheelAnimationAxes
} from "../racing-wheel-animation.mjs";

test("wheel labels include tires and rims but exclude the steering wheel", () => {
  assert.equal(isWheelVisualLabel("Mesh:M_Tire_High tire_0"), true);
  assert.equal(isWheelVisualLabel("rear-wheel rim"), true);
  assert.equal(isWheelVisualLabel("interior_steering_wheel"), false);
  assert.equal(isWheelVisualLabel("carpaint chassis"), false);
});

test("wheel roles map real parts to their physical animation channels", () => {
  assert.deepEqual(classifyWheelVisualRole("Wheel_FR_Tire_0 Tire"), {
    id: "tire",
    roll: true,
    steer: true
  });
  assert.deepEqual(classifyWheelVisualRole("Wheel_FR_Rim_0 material"), {
    id: "rim",
    roll: true,
    steer: true
  });
  assert.deepEqual(classifyWheelVisualRole("Wheel_FR_Brake_rotor_0 Brake_rotor"), {
    id: "rotor",
    roll: true,
    steer: true
  });
  assert.deepEqual(classifyWheelVisualRole("Wheel_FR_Caliper_0 Caliper"), {
    id: "caliper",
    roll: false,
    steer: true
  });
  assert.equal(classifyWheelVisualRole("Hood075 Logo"), null);
  assert.equal(classifyWheelVisualRole("Interior Steering_wheel"), null);
});

test("steering uses the local vertical axis while roll stays on the local axle", () => {
  assert.deepEqual(resolveWheelAnimationAxes("z"), { roll: "x", steer: "y" });
  assert.deepEqual(resolveWheelAnimationAxes("y"), { roll: "x", steer: "z" });
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
  assert.equal(layout.type, "four-wheel");
  assert.equal(layout.longitudinalAxis, "z");
  assert.equal(layout.centers.length, 4);
  assert.ok(layout.radiusLimit >= 0.55);
  assert.deepEqual(layout.centers.map(({ x, z }) => [Number(x.toFixed(1)), Number(z.toFixed(1))]), [
    [-1, 2], [1, 2], [-1, -2], [1, -2]
  ]);
});

test("four-wheel geometry can use the local Y axis as the vehicle length", () => {
  const vertices = [];
  for (const y of [-2, 2]) {
    for (const x of [-1, 1]) {
      vertices.push(
        x - 0.2, y - 0.4, -0.4,
        x + 0.2, y - 0.4, -0.4,
        x - 0.2, y + 0.4, 0.4,
        x + 0.2, y + 0.4, 0.4
      );
    }
  }
  const layout = findWheelGeometryLayout(vertices);
  assert.equal(layout.type, "four-wheel");
  assert.equal(layout.longitudinalAxis, "y");
  assert.deepEqual(resolveWheelAnimationAxes(layout.longitudinalAxis), { roll: "x", steer: "z" });
  assert.deepEqual(layout.centers.map(({ x, y }) => [x, y]), [
    [-1, 2], [1, 2], [-1, -2], [1, -2]
  ]);
});

test("optimized wheel geometry can use local Y as axle and local X as vehicle length", () => {
  const vertices = [];
  for (const x of [-4, 4]) {
    for (const y of [-2.5, 2.5]) {
      vertices.push(
        x - 0.4, y - 0.15, -0.4,
        x + 0.4, y - 0.15, -0.4,
        x - 0.4, y + 0.15, 0.4,
        x + 0.4, y + 0.15, 0.4
      );
    }
  }
  const layout = findWheelGeometryLayout(vertices);
  assert.equal(layout.type, "four-wheel");
  assert.equal(layout.longitudinalAxis, "x");
  assert.equal(layout.transverseAxis, "y");
  assert.equal(layout.verticalAxis, "z");
  assert.deepEqual(resolveWheelAnimationAxes(layout), { roll: "y", steer: "z" });
  assert.deepEqual(
    layout.centers.map(({ x, y }) => [Number(x.toFixed(1)), Number(y.toFixed(1))]),
    [[4, -2.5], [4, 2.5], [-4, -2.5], [-4, 2.5]]
  );
});

test("combined axle geometry is separated into two wheel centers", () => {
  const vertices = [];
  for (const x of [0, 1.5]) {
    vertices.push(
      x - 0.2, -0.4, -0.4,
      x + 0.2, -0.4, -0.4,
      x - 0.2, 0.4, 0.4,
      x + 0.2, 0.4, 0.4
    );
  }
  const layout = findWheelGeometryLayout(vertices);
  assert.equal(layout.combined, true);
  assert.equal(layout.type, "axle-pair");
  assert.deepEqual(layout.centers, [
    { x: 0, y: 0, z: 0 },
    { x: 1.5, y: 0, z: 0 }
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
