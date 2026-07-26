const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_VIEWPORT_SYNC_AB === "1";
const pairsPerMode = Number(process.env.RACING_VIEWPORT_SYNC_PAIRS || 5);

test.skip(!enabled, "run explicitly with RACING_VIEWPORT_SYNC_AB=1");
test.setTimeout(pairsPerMode * 4 * 90_000 + 30_000);

test("pairs viewport-sync on/off under the same cold and hot noise", async ({ browser }, testInfo) => {
  const cold = await runColdPairs(browser);
  const hot = await runHotPairs(browser);
  const report = { cold, hot, summary: { cold: summarizePairs(cold), hot: summarizePairs(hot) } };
  const outputPath = path.join(process.cwd(), "output", "racing-viewport-sync-ab.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("racing-viewport-sync-ab.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json"
  });
  expect(cold).toHaveLength(pairsPerMode);
  expect(hot).toHaveLength(pairsPerMode);
});

async function runColdPairs(browser) {
  const pairs = [];
  for (let index = 0; index < pairsPerMode; index += 1) {
    const order = index % 2 === 0 ? ["off", "on"] : ["on", "off"];
    const samples = {};
    for (const variant of order) {
      const context = await browser.newContext();
      const page = await context.newPage();
      samples[variant] = await launchAndMeasure(page, variant);
      await context.close();
    }
    pairs.push(makePair(index, order, samples));
  }
  return pairs;
}

async function runHotPairs(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await launchAndMeasure(page, "off");
  await launchAndMeasure(page, "on");
  const pairs = [];
  for (let index = 0; index < pairsPerMode; index += 1) {
    const order = index % 2 === 0 ? ["off", "on"] : ["on", "off"];
    const samples = {};
    for (const variant of order) samples[variant] = await launchAndMeasure(page, variant);
    pairs.push(makePair(index, order, samples));
  }
  await context.close();
  return pairs;
}

function makePair(index, order, samples) {
  return {
    index,
    order,
    off: samples.off,
    on: samples.on,
    deltaMs: samples.on.report.totalMs - samples.off.report.totalMs
  };
}

async function launchAndMeasure(page, variant) {
  await page.goto(`/?quality=low&viewportSyncFix=${variant}`);
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const ready = await page.evaluate(() => ({
    rootHidden: document.getElementById("racingView").hidden,
    lifecycle: globalThis.__ackGamesDebug.racing.getState().lifecycle,
    readyResources: performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/assets/racing/ready/"))
      .map((entry) => entry.name)
  }));
  await page.locator("#gameLifecycleEnterButton").click();
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 15_000 });
  return page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      report: globalThis.__ackGamesDebug.lifecycle.getLastLoadReport(),
      ready: globalThis.__ackGamesDebug.racing.getState().lifecycle,
      rendered: state.render.layout,
      readyResources: performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/assets/racing/ready/"))
        .map((entry) => entry.name)
    };
  }).then((post) => ({ report: post.report, ready, post }));
}

function summarizePairs(pairs) {
  const deltas = pairs.map((pair) => pair.deltaMs).sort((a, b) => a - b);
  return {
    deltaMs: { values: deltas, median: deltas[Math.floor(deltas.length / 2)] },
    readyPathIdentical: pairs.every((pair) => JSON.stringify(pair.off.ready.readyResources) === JSON.stringify(pair.on.ready.readyResources)),
    onAspectSynchronized: pairs.every((pair) => {
      const layout = pair.on.post.rendered;
      return Math.abs(layout.cameraAspect - layout.cssWidth / layout.cssHeight) < 0.00001;
    })
  };
}
