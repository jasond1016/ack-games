import assert from "node:assert/strict";
import test from "node:test";
import { createFreeDriveTimeTrial, sampleGhostPose } from "../racing-free-drive-challenge.mjs";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

const checkpoints = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }];

test("进入起点后依次通过检查点完成计时", () => {
  const trial = createFreeDriveTimeTrial({ checkpoints, storage: memoryStorage() });
  trial.update({ x: 0, z: 0 });
  assert.equal(trial.getState().phase, "running");
  trial.update({ x: 10, z: 0, deltaSeconds: 4 });
  assert.equal(trial.getState().nextCheckpoint, 2);
  trial.update({ x: 20, z: 0, deltaSeconds: 3 });
  assert.equal(trial.getState().phase, "finished");
  assert.equal(trial.getState().bestTimeSeconds, 7);
});

test("更快成绩覆盖最佳幽灵，较慢成绩不会覆盖", () => {
  const storage = memoryStorage();
  const first = createFreeDriveTimeTrial({ checkpoints, storage, storageKey: "test" });
  first.update({ x: 0, z: 0 });
  first.update({ x: 10, z: 0, deltaSeconds: 5 });
  first.update({ x: 20, z: 0, deltaSeconds: 5 });

  const second = createFreeDriveTimeTrial({ checkpoints, storage, storageKey: "test" });
  assert.equal(second.getState().bestTimeSeconds, 10);
  second.update({ x: 0, z: 0 });
  second.update({ x: 10, z: 0, deltaSeconds: 6 });
  second.update({ x: 20, z: 0, deltaSeconds: 6 });
  assert.equal(second.getState().bestTimeSeconds, 10);
});

test("幽灵车在相邻记录点之间插值并处理航向回绕", () => {
  const pose = sampleGhostPose([
    { time: 0, x: 0, z: 0, heading: Math.PI * 0.95 },
    { time: 2, x: 10, z: 4, heading: -Math.PI * 0.95 }
  ], 1);
  assert.deepEqual({ x: pose.x, z: pose.z }, { x: 5, z: 2 });
  assert.ok(Math.abs(pose.heading) > 3);
});

test("reset starts a fresh run while retaining the best ghost", () => {
  const trial = createFreeDriveTimeTrial({ checkpoints, storage: memoryStorage() });
  trial.update({ x: 0, z: 0 });
  trial.update({ x: 10, z: 0, deltaSeconds: 2 });
  trial.update({ x: 20, z: 0, deltaSeconds: 2 });
  assert.equal(trial.getState().bestTimeSeconds, 4);

  const reset = trial.reset();
  assert.equal(reset.phase, "ready");
  assert.equal(reset.elapsedSeconds, 0);
  assert.equal(reset.nextCheckpoint, 1);
  assert.equal(reset.bestTimeSeconds, 4);
});

test("a closed route waits for the player to leave before starting again", () => {
  const trial = createFreeDriveTimeTrial({
    checkpoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 0 }],
    storage: memoryStorage(),
    gateRadius: 2
  });
  trial.update({ x: 0, z: 0 });
  trial.update({ x: 10, z: 0, deltaSeconds: 2 });
  trial.update({ x: 0, z: 0, deltaSeconds: 2 });
  assert.equal(trial.getState().phase, "finished");

  trial.update({ x: 0, z: 0, deltaSeconds: 1 });
  assert.equal(trial.getState().phase, "finished");
  trial.update({ x: 5, z: 0 });
  trial.update({ x: 0, z: 0 });
  assert.equal(trial.getState().phase, "running");
  assert.equal(trial.getState().elapsedSeconds, 0);
});

test("explicit time trials wait for the event countdown before starting", () => {
  const trial = createFreeDriveTimeTrial({
    checkpoints,
    storage: memoryStorage(),
    autoStart: false
  });

  trial.update({ x: 0, z: 0, deltaSeconds: 2 });
  assert.equal(trial.getState().phase, "ready");
  trial.start({ x: 0, z: 0, heading: 0 });
  trial.update({ x: 10, z: 0, deltaSeconds: 2 });
  assert.equal(trial.getState().phase, "running");
  assert.equal(trial.getState().elapsedSeconds, 2);
  assert.equal(trial.getState().nextCheckpoint, 2);
});

test("a running time trial accepts an explicit time penalty", () => {
  const trial = createFreeDriveTimeTrial({ checkpoints, storage: memoryStorage(), autoStart: false });
  trial.start({ x: 0, z: 0, heading: 0 });
  trial.update({ x: 4, z: 0, deltaSeconds: 1.5 });
  trial.addPenalty(2.5);
  assert.equal(trial.getState().elapsedSeconds, 4);

  trial.addPenalty(-1);
  assert.equal(trial.getState().elapsedSeconds, 4);
  trial.reset();
  trial.addPenalty(2.5);
  assert.equal(trial.getState().elapsedSeconds, 0);
});
