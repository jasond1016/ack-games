import assert from "node:assert/strict";
import test from "node:test";

import {
  createRailColliderGeometry,
  isPhysicalVehicleSurface,
  isProvingTrackContactSurface,
  physicalFallbackGroundHeight,
  physicalRoadSupportHalfWidth,
  resolveDrivingSurfaceId,
  surfaceRollingDragScale,
  surfaceTopSpeedScale
} from "../racing-physical-surfaces.mjs";

test("物理车辆可在道路、沙石、地形、路肩、堤坡、特技坡道和拉力泥土路上行驶", () => {
  for (const surface of ["road", "gravel", "ground", "verge", "embankment", "stunt-ramp", "rally-dirt", "bridge"]) {
    assert.equal(isPhysicalVehicleSurface(surface), true, surface);
  }
  assert.equal(isPhysicalVehicleSurface("building"), false);
  assert.equal(isPhysicalVehicleSurface("rail"), false);
});

test("沙石赛道把道路接触解析为 gravel 驾驶面", () => {
  assert.equal(resolveDrivingSurfaceId("road", "asphalt"), "road");
  assert.equal(resolveDrivingSurfaceId("road", "gravel"), "gravel");
  assert.equal(resolveDrivingSurfaceId("bridge", "gravel"), "bridge");
  assert.equal(resolveDrivingSurfaceId("ground", "gravel"), "ground");
});

test("proving track contact includes gravel without counting grass", () => {
  assert.equal(isProvingTrackContactSurface("road"), true);
  assert.equal(isProvingTrackContactSurface("gravel"), true);
  assert.equal(isProvingTrackContactSurface("bridge"), true);
  assert.equal(isProvingTrackContactSurface("ground"), false);
});

test("草地软顶速约九成且滚阻高于柏油", () => {
  assert.equal(surfaceTopSpeedScale("ground"), 0.85);
  assert.ok(surfaceTopSpeedScale("ground") >= 0.75);
  assert.ok(surfaceTopSpeedScale("ground") <= 0.92);
  assert.ok(surfaceRollingDragScale("ground") > surfaceRollingDragScale("road"));
  assert.ok(surfaceRollingDragScale("gravel") > surfaceRollingDragScale("road"));
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
