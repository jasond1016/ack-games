import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_DRIVE_JUMP,
  FREE_DRIVE_STUNT_JUMP,
  createFreeDriveStuntRampColliderSpecs,
  freeDriveStuntRampRise,
  freeDriveJumpRampRise,
  isFreeDriveBridgeCorridor,
  isFreeDriveJumpGap,
  resolveFreeDriveJumpLaunch
} from "../racing-jump-rules.mjs";

test("两座大桥都切开中央桥面", () => {
  assert.equal(isFreeDriveJumpGap({ x: 190, y: 34 }), true);
  assert.equal(isFreeDriveJumpGap({ x: 190, y: -18 }), true);
});

test("远离海岸桥的长路线不会误用桥梁高度和断口", () => {
  const remoteCrossing = { x: 190, y: 520 };
  assert.equal(isFreeDriveBridgeCorridor(remoteCrossing), false);
  assert.equal(isFreeDriveJumpGap(remoteCrossing), false);
});

test("两座断桥的两端都形成等高斜坡", () => {
  assert.equal(FREE_DRIVE_JUMP.gapMinX - FREE_DRIVE_JUMP.rampMinX, 32);
  assert.equal(FREE_DRIVE_JUMP.rampMaxX - FREE_DRIVE_JUMP.gapMaxX, 32);
  assert.equal(FREE_DRIVE_JUMP.rampRise, 5);
  for (const y of [34, -18]) {
    assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.rampMinX, y }), 0);
    assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.gapMinX, y }), FREE_DRIVE_JUMP.rampRise);
    assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.gapMaxX, y }), FREE_DRIVE_JUMP.rampRise);
    assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.rampMaxX, y }), 0);
  }
});

test("两座大桥达到 90 km/h 后从任一侧都能起跳", () => {
  for (const y of [34, -18]) {
    const fromLeft = resolveFreeDriveJumpLaunch({ x: 177, y }, { x: 25, y: 0 });
    const fromRight = resolveFreeDriveJumpLaunch({ x: 203, y }, { x: -25, y: 0 });
    assert.ok(fromLeft?.verticalSpeed >= 12);
    assert.ok(fromRight?.verticalSpeed >= 12);
    const flightDistance = 25 * (2 * fromLeft.verticalSpeed / FREE_DRIVE_JUMP.gravity);
    const targetDistance = FREE_DRIVE_JUMP.gapMaxX - FREE_DRIVE_JUMP.gapMinX
      + FREE_DRIVE_JUMP.landingRun;
    assert.ok(Math.abs(flightDistance - targetDistance) < 0.01);
  }
  assert.equal(resolveFreeDriveJumpLaunch({ x: 177, y: 34 }, { x: 20, y: 0 }), null);
});

test("Urus 以玩家实际遇到的 88 km/h 到达桥沿时仍能越过断口", () => {
  const speed = 88 / 3.6;
  const launch = resolveFreeDriveJumpLaunch({ x: 177, y: -18 }, { x: speed, y: 0 });
  assert.ok(launch);
  const flightDistance = speed * (2 * launch.verticalSpeed / FREE_DRIVE_JUMP.gravity);
  assert.ok(flightDistance >= FREE_DRIVE_JUMP.gapMaxX - FREE_DRIVE_JUMP.gapMinX
    + FREE_DRIVE_JUMP.landingRun);
});

test("断桥旁草地上有一对相向的等高特技坡道", () => {
  const y = FREE_DRIVE_STUNT_JUMP.centerY;
  assert.equal(FREE_DRIVE_STUNT_JUMP.leftTakeoffX - FREE_DRIVE_STUNT_JUMP.leftRampStartX, 20);
  assert.equal(FREE_DRIVE_STUNT_JUMP.rightRampEndX - FREE_DRIVE_STUNT_JUMP.rightTakeoffX, 20);
  assert.equal(FREE_DRIVE_STUNT_JUMP.rampRise, 6.2);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.leftRampStartX, y }), 0);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.leftTakeoffX, y }), FREE_DRIVE_STUNT_JUMP.rampRise);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.rightTakeoffX, y }), FREE_DRIVE_STUNT_JUMP.rampRise);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.rightRampEndX, y }), 0);
});

test("特技坡道为物理车辆提供与视觉坡面一致的碰撞体", () => {
  const colliders = createFreeDriveStuntRampColliderSpecs();
  assert.equal(colliders.length, 2);
  assert.deepEqual(colliders.map((collider) => collider.tag), ["stunt-ramp", "stunt-ramp"]);
  assert.deepEqual(colliders.map((collider) => collider.roll > 0 ? 1 : -1), [1, -1]);
  assert.ok(colliders.every((collider) => collider.width > 20));
  assert.ok(colliders.every((collider) => collider.depth === FREE_DRIVE_STUNT_JUMP.halfWidth * 2));
});
