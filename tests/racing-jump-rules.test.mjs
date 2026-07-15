import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_DRIVE_JUMP,
  FREE_DRIVE_STUNT_JUMP,
  freeDriveStuntRampRise,
  freeDriveJumpRampRise,
  isFreeDriveJumpGap,
  resolveFreeDriveJumpLaunch,
  resolveFreeDriveStuntBoost,
  resolveFreeDriveStuntLaunch
} from "../racing-jump-rules.mjs";

test("两座大桥都切开中央桥面", () => {
  assert.equal(isFreeDriveJumpGap({ x: 190, y: 34 }), true);
  assert.equal(isFreeDriveJumpGap({ x: 190, y: -18 }), true);
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

test("断桥旁草地上有一对相向的等高特技坡道", () => {
  const y = FREE_DRIVE_STUNT_JUMP.centerY;
  assert.equal(FREE_DRIVE_STUNT_JUMP.leftTakeoffX - FREE_DRIVE_STUNT_JUMP.leftRampStartX, 20);
  assert.equal(FREE_DRIVE_STUNT_JUMP.rightRampEndX - FREE_DRIVE_STUNT_JUMP.rightTakeoffX, 20);
  assert.equal(FREE_DRIVE_STUNT_JUMP.rampRise, 6.2);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.leftRampStartX, y }), 0);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.leftTakeoffX, y }), FREE_DRIVE_STUNT_JUMP.rampRise);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.rightTakeoffX, y }), FREE_DRIVE_STUNT_JUMP.rampRise);
  assert.equal(freeDriveStuntRampRise({ x: FREE_DRIVE_STUNT_JUMP.rightRampEndX, y }), 0);
  assert.equal(resolveFreeDriveStuntBoost({ x: 168, y }, { x: 10, y: 0 }), 1);
  assert.equal(resolveFreeDriveStuntBoost({ x: 212, y }, { x: -10, y: 0 }), -1);
});

test("草地坡道飞跃对面坡道后才落地", () => {
  const y = FREE_DRIVE_STUNT_JUMP.centerY;
  for (const [position, velocity] of [
    [{ x: 177, y }, { x: 20, y: 0 }],
    [{ x: 203, y }, { x: -20, y: 0 }]
  ]) {
    const launch = resolveFreeDriveStuntLaunch(position, velocity);
    assert.ok(launch);
    const flightDistance = Math.abs(launch.horizontalSpeed)
      * (2 * launch.verticalSpeed / FREE_DRIVE_STUNT_JUMP.gravity);
    assert.ok(Math.abs(flightDistance - Math.abs(launch.landingX - position.x)) < 0.01);
    const peakHeight = launch.verticalSpeed ** 2 / (2 * FREE_DRIVE_STUNT_JUMP.gravity);
    assert.ok(peakHeight > 6.5);
    if (launch.direction > 0) assert.ok(launch.landingX > FREE_DRIVE_STUNT_JUMP.rightRampEndX);
    else assert.ok(launch.landingX < FREE_DRIVE_STUNT_JUMP.leftRampStartX);
  }
});
