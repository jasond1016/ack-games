import test from "node:test";
import assert from "node:assert/strict";
import {
  createVehicleContactPoints,
  resolveVehicleSupport
} from "../racing-surface-contact.mjs";

test("四个接触点随车辆朝向分布在车轮附近", () => {
  const contacts = createVehicleContactPoints({
    position: { x: 10, z: 20 },
    heading: Math.PI / 2,
    halfWidth: 1,
    halfLength: 2
  });

  assert.equal(contacts.length, 4);
  assert.deepEqual(
    contacts.map(({ x, z }) => [Number(x.toFixed(4)), Number(z.toFixed(4))]).sort(),
    [[8, 19], [8, 21], [12, 19], [12, 21]].sort()
  );
});

test("四点支撑计算上坡俯仰和横坡侧倾", () => {
  const contactPoints = createVehicleContactPoints({
    position: { x: 0, z: 0 },
    heading: 0,
    halfWidth: 1,
    halfLength: 2
  });
  const support = resolveVehicleSupport({
    contactPoints,
    sampleSurface: ({ x, z }) => ({ height: z * 0.1 + x * 0.05, surfaceId: "road" })
  });

  assert.equal(support.grounded, true);
  assert.equal(support.contactCount, 4);
  assert.equal(support.surfaceId, "road");
  assert.ok(support.pitch < 0);
  assert.ok(support.roll > 0);
  assert.ok(Math.abs(support.height) < 1e-12);
});

test("接触不足时车辆进入离地状态", () => {
  const contactPoints = createVehicleContactPoints({
    position: { x: 0, z: 0 },
    heading: 0,
    halfWidth: 1,
    halfLength: 2
  });
  const support = resolveVehicleSupport({
    contactPoints,
    sampleSurface: ({ x, z }) => x > 0 && z > 0 ? { height: 3, surfaceId: "bridge" } : null
  });

  assert.equal(support.grounded, false);
  assert.equal(support.contactCount, 1);
  assert.equal(support.height, null);
});
