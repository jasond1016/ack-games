import assert from "node:assert/strict";
import test from "node:test";

import {
  createRailColliderGeometry,
  isPhysicalVehicleSurface,
  physicalFallbackGroundHeight,
  physicalRoadSupportHalfWidth
} from "../racing-physical-surfaces.mjs";

test("物理车辆可在道路、地形、路肩、堤坡、特技坡道和拉力泥土路上行驶", () => {
  for (const surface of ["road", "ground", "verge", "embankment", "stunt-ramp", "rally-dirt"]) {
    assert.equal(isPhysicalVehicleSurface(surface), true, surface);
  }
  assert.equal(isPhysicalVehicleSurface("building"), false);
  assert.equal(isPhysicalVehicleSurface("rail"), false);
});

test("自由驾驶兜底地面低于可见岛屿，不能穿过道路和坡道", () => {
  assert.equal(physicalFallbackGroundHeight(true), -4);
  assert.equal(physicalFallbackGroundHeight(false), 0);
});

test("道路物理支撑面覆盖自由驾驶的完整可见路肩", () => {
  assert.equal(physicalRoadSupportHalfWidth({ halfWidth: 9, centerX: 100, isFreeDrive: true }), 10.78);
  assert.equal(physicalRoadSupportHalfWidth({ halfWidth: 9, centerX: 300, isFreeDrive: true }), 13.2);
  assert.equal(physicalRoadSupportHalfWidth({ halfWidth: 9, centerX: 300, isFreeDrive: false }), 9);
});

test("护栏碰撞盒的局部 Z 轴沿道路分段方向", () => {
  const geometry = createRailColliderGeometry({
    deltaX: 8,
    deltaZ: 6,
    halfHeight: 0.56,
    halfDepth: 0.34
  });

  assert.deepEqual(geometry.halfExtents, { x: 0.34, y: 0.56, z: 5 });
  const colliderDirection = {
    x: Math.sin(geometry.yaw),
    z: Math.cos(geometry.yaw)
  };
  assert.ok(Math.abs(colliderDirection.x - 0.8) < 1e-12);
  assert.ok(Math.abs(colliderDirection.z - 0.6) < 1e-12);
});
