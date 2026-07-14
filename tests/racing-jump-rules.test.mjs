import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_DRIVE_JUMP,
  freeDriveJumpRampRise,
  isFreeDriveJumpGap,
  resolveFreeDriveJumpLaunch
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
