import assert from "node:assert/strict";
import test from "node:test";

import { inspectRacingTrack } from "../racing-track.mjs";

const openTrack = {
  shape: "open",
  width: 14,
  samples: 240,
  controlPoints: [[0, 0], [30, 0], [60, 20], [90, 20]]
};

const loopTrack = {
  shape: "loop",
  width: 14,
  samples: 240,
  startPosition: { progress: 0.1 },
  controlPoints: [[-30, -20], [30, -20], [35, 25], [-35, 25]]
};

test("赛道语义只返回冻结普通数据", () => {
  const track = inspectRacingTrack(openTrack);
  assert.equal(track.validation.valid, true);
  assert.equal(track.summary.closed, false);
  assert.ok(track.summary.totalLength > 90);
  assert.deepEqual(Object.getPrototypeOf(track.sample(0.5).center), Object.prototype);
  assert.ok(Object.isFrozen(track.summary.samples));
});

test("自交候选可建立预览但不可保存", () => {
  const track = inspectRacingTrack({
    ...loopTrack,
    controlPoints: [[-20, -20], [20, 20], [-20, 20], [20, -20]]
  });
  assert.equal(track.geometryAvailable, true);
  assert.equal(track.validation.valid, false);
  assert.ok(track.summary.samples.length > 0);
});

test("开放赛道定向冲线且反向冲线忽略", () => {
  const track = inspectRacingTrack(openTrack);
  const finish = track.summary.finishLine.center;
  const direction = track.summary.finishLine.direction;
  const before = { x: finish.x - direction.x * 3, y: finish.y - direction.y * 3 };
  const after = { x: finish.x + direction.x * 3, y: finish.y + direction.y * 3 };
  assert.equal(track.observeMovement({ previousPosition: before, currentPosition: after, onRoad: true }).crossedFinish, true);
  assert.equal(track.observeMovement({ previousPosition: after, currentPosition: before, onRoad: true }).crossedFinish, false);
});

test("赛道外冲线忽略", () => {
  const track = inspectRacingTrack(openTrack);
  const finish = track.summary.finishLine.center;
  assert.equal(track.observeMovement({ previousPosition: { x: finish.x - 2, y: finish.y }, currentPosition: { x: finish.x + 2, y: finish.y }, onRoad: false }).crossedFinish, false);
});

test("闭环赛道发车基准来自起跑位置", () => {
  const track = inspectRacingTrack(loopTrack);
  assert.equal(track.summary.startProgress, 0.1);
  assert.equal(track.summary.finishProgress, 0.1);
  assert.equal(track.summary.raceMode, "lap");
});

test("中心线几何 golden fixtures 保持稳定", () => {
  const open = inspectRacingTrack(openTrack);
  const loop = inspectRacingTrack(loopTrack);
  assertClose(open.summary.totalLength, 96.6558486476);
  assertClose(open.sample(0.25).center.x, 24.1096594373);
  assertClose(open.sample(0.5).center.y, 10);
  assertClose(open.project({ x: 25, y: 5 }).progress, 0.2685479498);
  assertClose(loop.summary.totalLength, 231.4352236211);
  assertClose(loop.sample(0.25).center.y, -22.5352374780);
  assertClose(loop.project({ x: 25, y: 5 }).progress, 0.3817033094);
});

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}
