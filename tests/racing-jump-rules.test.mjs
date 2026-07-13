import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_DRIVE_JUMP,
  freeDriveJumpRampRise,
  isFreeDriveJumpGap,
  resolveFreeDriveJumpLaunch
} from "../racing-jump-rules.mjs";

test("断桥只切开城市回程方向的一座桥", () => {
  assert.equal(isFreeDriveJumpGap({ x: 190, y: 34 }), true);
  assert.equal(isFreeDriveJumpGap({ x: 190, y: -18 }), false);
});

test("断桥两端形成等高斜坡且中央没有桥面", () => {
  assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.rampMinX, y: 34 }), 0);
  assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.gapMinX, y: 34 }), FREE_DRIVE_JUMP.rampRise);
  assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.gapMaxX, y: 34 }), FREE_DRIVE_JUMP.rampRise);
  assert.equal(freeDriveJumpRampRise({ x: FREE_DRIVE_JUMP.rampMaxX, y: 34 }), 0);
});

test("达到 90 km/h 后从任一侧冲坡都会获得足够的起跳速度", () => {
  const fromLeft = resolveFreeDriveJumpLaunch({ x: 177, y: 34 }, { x: 25, y: 0 });
  const fromRight = resolveFreeDriveJumpLaunch({ x: 203, y: 34 }, { x: -25, y: 0 });
  assert.ok(fromLeft?.verticalSpeed >= 8);
  assert.ok(fromRight?.verticalSpeed >= 8);
  assert.equal(resolveFreeDriveJumpLaunch({ x: 177, y: 34 }, { x: 20, y: 0 }), null);
});
