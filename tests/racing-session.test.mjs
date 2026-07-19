import assert from "node:assert/strict";
import test from "node:test";

import {
  createRacingSession,
  createRacingResult,
  createRacingSnapshot,
  createSeededRandom
} from "../racing-session.mjs";

test("比赛快照冻结地图、开赛配置与随机种子", () => {
  const map = { name: "测试赛道", track: { shape: "open" } };
  const startConfig = { playerCarId: "car-1", cameraMode: "chase" };
  const snapshot = createRacingSnapshot({ map, startConfig, environmentProfile: "coastal-showcase", randomSeed: 42 });

  map.name = "已修改";
  startConfig.playerCarId = "car-2";

  assert.equal(snapshot.map.name, "测试赛道");
  assert.equal(snapshot.startConfig.playerCarId, "car-1");
  assert.equal(snapshot.environmentProfile, "coastal-showcase");
  assert.equal(snapshot.randomSeed, 42);
  assert.ok(Object.isFrozen(snapshot.map.track));
});

test("相同随机种子产生相同序列", () => {
  const left = createSeededRandom(20260713);
  const right = createSeededRandom(20260713);
  assert.deepEqual(Array.from({ length: 8 }, left), Array.from({ length: 8 }, right));
});

test("比赛结果冻结胜负与比赛快照", () => {
  const snapshot = createRacingSnapshot({ map: {}, startConfig: {}, randomSeed: 7 });
  const result = createRacingResult({
    snapshot,
    winner: "player",
    playerPlace: 1,
    elapsedSeconds: 12.5,
    details: { mode: "sprint" }
  });
  assert.equal(result.winner, "player");
  assert.equal(result.snapshot.randomSeed, 7);
  assert.ok(Object.isFrozen(result.details));
});

test("比赛会话只能启动一次并通过画面 adapter 发布阶段", async () => {
  const rendered = [];
  const session = createRacingSession({
    snapshot: createRacingSnapshot({ map: {}, startConfig: {}, randomSeed: 1 }),
    view: { render: (model) => rendered.push(model.phase) },
    implementation: { start: async () => {}, destroy: async () => {} }
  });

  await session.start();
  assert.deepEqual(rendered, ["loading", "running"]);
  await assert.rejects(session.start(), /只能启动一次/);
});

test("离开意图先销毁且只报告一次", async () => {
  const order = [];
  let controls;
  const session = createRacingSession({
    snapshot: createRacingSnapshot({ map: {}, startConfig: {}, randomSeed: 1 }),
    onIntent: (intent) => order.push(`intent:${intent.type}`),
    implementation: {
      start: async (nextControls) => { controls = nextControls; },
      destroy: async () => { order.push("destroy"); }
    }
  });

  await session.start();
  await controls.requestIntent({ type: "replace-session" });
  await controls.requestIntent({ type: "exit-to-map-select" });
  assert.deepEqual(order, ["destroy", "intent:replace-session"]);
});

test("销毁是幂等的且吞掉清理错误", async () => {
  let destroyCalls = 0;
  const errors = [];
  const session = createRacingSession({
    snapshot: createRacingSnapshot({ map: {}, startConfig: {}, randomSeed: 1 }),
    diagnostics: { error: (...args) => errors.push(args) },
    implementation: {
      start: async () => {},
      destroy: async () => { destroyCalls += 1; throw new Error("cleanup"); }
    }
  });

  await session.start();
  await Promise.all([session.destroy(), session.destroy()]);
  assert.equal(destroyCalls, 1);
  assert.equal(errors.length, 1);
});

test("销毁加载中的会话时，迟到失败不进入 failed", async () => {
  let rejectStart;
  const rendered = [];
  const session = createRacingSession({
    snapshot: createRacingSnapshot({ map: {}, startConfig: {}, randomSeed: 1 }),
    view: { render: (model) => rendered.push(model.phase) },
    implementation: {
      start: () => new Promise((_, reject) => { rejectStart = reject; }),
      destroy: async () => {}
    }
  });

  const starting = session.start();
  await Promise.resolve();
  await session.destroy();
  rejectStart(new Error("late"));
  await starting;
  assert.deepEqual(rendered, ["loading"]);
});
