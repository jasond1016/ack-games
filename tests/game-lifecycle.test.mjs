import assert from "node:assert/strict";
import test from "node:test";

import { createGameLifecycle } from "../game-lifecycle.mjs";

function createHarness(loaders) {
  const events = [];
  const registry = Object.fromEntries(Object.entries(loaders).map(([id, load]) => [id, { title: id, load }]));
  const lifecycle = createGameLifecycle({
    registry,
    diagnostics: { error: () => {} },
    history: {
      pathname: () => "/",
      push: (_, url) => events.push(`push:${url}`),
      replace: (_, url) => events.push(`replace:${url}`),
      reload: () => events.push("reload")
    },
    view: {
      getGameRoot: () => ({}),
      showLoading: ({ gameId }) => events.push(`loading:${gameId}`),
      prepareGame: ({ gameId }) => events.push(`prepare:${gameId}`),
      showGame: ({ gameId }) => events.push(`game:${gameId}`),
      showFailure: ({ gameId }) => events.push(`failed:${gameId}`),
      showHome: () => events.push("home")
    }
  });
  return { lifecycle, events };
}

function gameModule(id, events) {
  return {
    createGame: () => ({
      start: async () => events.push(`start:${id}`),
      stop: () => events.push(`stop:${id}`),
      destroy: async () => events.push(`destroy:${id}`)
    })
  };
}

test("打开新游戏时先销毁旧实例但保留已加载 module", async () => {
  let loads = 0;
  const harness = createHarness({
    one: async () => { loads += 1; return gameModule("one", harness.events); },
    two: async () => gameModule("two", harness.events)
  });
  await harness.lifecycle.open("one");
  await harness.lifecycle.open("two");
  assert.equal(loads, 1);
  assert.ok(harness.events.indexOf("destroy:one") < harness.events.indexOf("start:two"));
});

test("game stays covered until its async start finishes", async () => {
  const events = [];
  let resolveStart;
  const lifecycle = createGameLifecycle({
    registry: {
      race: {
        title: "race",
        load: async () => ({
          createGame: () => ({
            start: () => new Promise((resolve) => { resolveStart = () => { events.push("start:race"); resolve(); }; }),
            stop: () => {},
            destroy: async () => {}
          })
        })
      }
    },
    diagnostics: { error: () => {} },
    history: { pathname: () => "/", push: () => {}, replace: () => {}, reload: () => {} },
    view: {
      getGameRoot: () => ({}),
      showLoading: () => events.push("loading:race"),
      prepareGame: () => events.push("prepare:race"),
      showGame: () => events.push("game:race"),
      showFailure: () => {},
      showHome: () => {}
    }
  });
  const opening = lifecycle.open("race");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.join("|"), "loading:race|prepare:race");
  resolveStart();
  await opening;
  assert.equal(events.join("|"), "loading:race|prepare:race|start:race|game:race");
});

test("ready-to-enter keeps a prepared game covered until one confirmation", async () => {
  const events = [];
  let confirms = 0;
  const lifecycle = createGameLifecycle({
    registry: {
      race: {
        title: "race",
        load: async () => ({
          createGame: () => ({
            requiresPlayerConfirmation: true,
            start: async () => events.push("prepared:race"),
            confirmStart: async () => { confirms += 1; events.push("confirmed:race"); },
            stop: () => {},
            destroy: async () => {}
          })
        })
      }
    },
    diagnostics: { error: () => {} },
    history: { pathname: () => "/", push: () => {}, replace: () => {}, reload: () => {} },
    view: {
      getGameRoot: () => ({}),
      showLoading: () => events.push("loading:race"),
      prepareGame: () => events.push("prepare:race"),
      showReady: () => events.push("ready:race"),
      showConfirming: () => events.push("confirming:race"),
      showGame: () => events.push("game:race"),
      showFailure: () => {},
      showHome: () => {}
    }
  });

  await lifecycle.open("race");
  assert.deepEqual(events, ["loading:race", "prepare:race", "prepared:race", "ready:race"]);
  assert.equal(lifecycle.getLastLoadReport().awaitingConfirmation, true);
  await Promise.all([lifecycle.confirm(), lifecycle.confirm()]);
  assert.equal(confirms, 1);
  assert.deepEqual(events, ["loading:race", "prepare:race", "prepared:race", "ready:race", "confirming:race", "confirmed:race", "game:race"]);
  assert.equal(lifecycle.getLastLoadReport().timeline.at(-1).stage, "first-drivable-frame");
});

test("a stalled start keeps the cover up and exposes a retryable timeout", async () => {
  const events = [];
  let failureMessage = null;
  const lifecycle = createGameLifecycle({
    registry: {
      race: {
        title: "race",
        load: async () => ({
          createGame: () => ({
            start: () => new Promise(() => {}),
            stop: () => events.push("stop:race"),
            destroy: async () => events.push("destroy:race")
          })
        })
      }
    },
    diagnostics: { error: () => {} },
    history: { pathname: () => "/", push: () => {}, replace: () => {}, reload: () => {} },
    view: {
      getGameRoot: () => ({}),
      showLoading: () => events.push("loading:race"),
      prepareGame: () => events.push("prepare:race"),
      showGame: () => events.push("game:race"),
      showFailure: ({ message }) => { failureMessage = message; events.push("failed:race"); },
      showHome: () => {}
    },
    startTimeoutMs: 1
  });

  await lifecycle.open("race");
  assert.deepEqual(events, ["loading:race", "prepare:race", "stop:race", "destroy:race", "failed:race"]);
  assert.equal(failureMessage, "准备时间过长，请重试。");
  assert.equal(lifecycle.getLastLoadReport().timeline.at(-1).stage, "failed");
});

test("load report records real module, game, and drivable milestones", async () => {
  let tick = 0;
  const lifecycle = createGameLifecycle({
    registry: {
      race: {
        title: "race",
        load: async () => ({
          createGame: (context) => ({
            start: async () => context.reportLoading("physics", "physics ready"),
            stop: () => {},
            destroy: async () => {}
          })
        })
      }
    },
    diagnostics: { error: () => {} },
    history: { pathname: () => "/", push: () => {}, replace: () => {}, reload: () => {} },
    view: { getGameRoot: () => ({}), showLoading: () => {}, showGame: () => {}, showFailure: () => {}, showHome: () => {} },
    now: () => tick += 10
  });
  await lifecycle.open("race");
  const report = lifecycle.getLastLoadReport();
  assert.equal(report.gameId, "race");
  assert.ok(report.timeline.some(({ stage }) => stage === "module-ready"));
  assert.ok(report.timeline.some(({ stage }) => stage === "physics"));
  assert.equal(report.timeline.at(-1).stage, "first-drivable-frame");
});

test("快速导航只有最后请求创建实例", async () => {
  let resolveSlow;
  const harness = createHarness({
    slow: () => new Promise((resolve) => { resolveSlow = resolve; }),
    fast: async () => gameModule("fast", harness.events)
  });
  const slow = harness.lifecycle.open("slow");
  await Promise.resolve();
  const fast = harness.lifecycle.open("fast");
  resolveSlow(gameModule("slow", harness.events));
  await Promise.all([slow, fast]);
  assert.ok(harness.events.includes("start:fast"));
  assert.ok(!harness.events.includes("start:slow"));
});

test("失败后重试原地刷新且不新增 history", async () => {
  const harness = createHarness({
    race: async () => { throw new Error("cdn"); }
  });
  await harness.lifecycle.open("race");
  await harness.lifecycle.retry();
  assert.deepEqual(harness.events.filter((event) => event.startsWith("push:")), ["push:#race"]);
  assert.ok(harness.events.includes("failed:race"));
  assert.ok(harness.events.includes("reload"));
});

test("replaceSelf 重建当前实例且不新增 history", async () => {
  let context;
  const events = [];
  const lifecycle = createGameLifecycle({
    registry: { race: { title: "race", load: async () => ({ createGame: (nextContext) => { context = nextContext; return gameModule("race", events).createGame(); } }) } },
    history: { pathname: () => "/", push: (_, url) => events.push(`push:${url}`), replace: () => {}, reload: () => {} },
    view: { getGameRoot: () => ({}), showLoading: () => {}, showGame: () => {}, showFailure: () => {}, showHome: () => {} }
  });
  await lifecycle.open("race");
  await context.replaceSelf({ seed: 4 });
  assert.deepEqual(events.filter((event) => event.startsWith("push:")), ["push:#race"]);
  assert.equal(events.filter((event) => event === "start:race").length, 2);
});
