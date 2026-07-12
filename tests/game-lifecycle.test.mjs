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
