const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_MODULEPRELOAD_AUDIT === "1";
const samples = Number(process.env.RACING_MODULEPRELOAD_SAMPLES || 5);
const variant = process.env.RACING_MODULEPRELOAD_VARIANT || "with-preload";

test.skip(!enabled, "run explicitly with RACING_MODULEPRELOAD_AUDIT=1");
test.setTimeout(samples * 30_000 + 30_000);

test("records lobby cost and racing modulepreload network priority", async ({ browser }, testInfo) => {
  const results = [];
  for (let index = 0; index < samples; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(() => performance.mark("lobby-first-frame"));
      }, { once: true });
    });
    const client = await context.newCDPSession(page);
    const racingRequests = [];
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", (event) => {
      if (event.request.url.includes("/racing-game.js")) {
        racingRequests.push({
          url: event.request.url,
          priority: event.request.initialPriority ?? event.initialPriority ?? null
        });
      }
    });

    await page.goto("/?quality=low", { waitUntil: "load" });
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null;
      const lobbyFirstFrame = performance.getEntriesByName("lobby-first-frame")[0]?.startTime ?? null;
      const racingResources = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/racing-game.js"))
        .map((entry) => ({
          name: entry.name,
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize
        }));
      const loadingView = document.getElementById("gameLifecycleView");
      return {
        firstContentfulPaintMs: fcp === null ? null : Math.round(fcp),
        lobbyFirstFrameMs: lobbyFirstFrame === null ? null : Math.round(lobbyFirstFrame),
        domInteractiveMs: Math.round(navigation.domInteractive),
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadMs: Math.round(navigation.loadEventEnd),
        racingResources,
        loadingMediaNodes: loadingView?.querySelectorAll("img,video,audio,canvas,iframe").length ?? null
      };
    });
    results.push({ ...metrics, racingRequests });
    await context.close();
  }

  const report = {
    variant,
    samples,
    command: "RACING_MODULEPRELOAD_AUDIT=1 RACING_MODULEPRELOAD_SAMPLES=5 pnpm exec playwright test tests/racing-modulepreload-audit.spec.js --reporter=line",
    results,
    summary: summarize(results)
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = path.join(process.cwd(), "output", `racing-modulepreload-${variant}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body);
  await testInfo.attach(path.basename(outputPath), { body: Buffer.from(body), contentType: "application/json" });
  expect(results).toHaveLength(samples);
  expect(results.every((result) => result.loadingMediaNodes === 0)).toBe(true);
});

function summarize(results) {
  const percentile = (values, ratio) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] : null;
  };
  const resourceSamples = results.flatMap((result) => result.racingResources);
  return {
    lobby: {
      firstContentfulPaintMs: metric(results, "firstContentfulPaintMs", percentile),
      lobbyFirstFrameMs: metric(results, "lobbyFirstFrameMs", percentile),
      domInteractiveMs: metric(results, "domInteractiveMs", percentile),
      domContentLoadedMs: metric(results, "domContentLoadedMs", percentile),
      loadMs: metric(results, "loadMs", percentile)
    },
    racingModule: {
      requestCount: resourceSamples.length,
      transferBytes: resourceSamples.reduce((total, resource) => total + resource.transferSize, 0),
      encodedBodyBytes: resourceSamples.reduce((total, resource) => total + resource.encodedBodySize, 0),
      priorities: [...new Set(results.flatMap((result) => result.racingRequests.map((request) => request.priority)))],
      startsDuringLobby: resourceSamples.filter((resource) => resource.startTime >= 0).length
    },
    loadingAddedResources: 0,
    loadingMediaNodes: [...new Set(results.map((result) => result.loadingMediaNodes))]
  };
}

function metric(results, name, percentile) {
  const values = results.map((result) => result[name]);
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}
