const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_LOADING_BASELINE === "1";
const samplesPerMode = Number(process.env.RACING_LOADING_SAMPLES || 5);
const reportName = process.env.RACING_LOADING_REPORT_NAME || "racing-loading-baseline.json";

test.skip(!enabled, "run explicitly with RACING_LOADING_BASELINE=1");
test.setTimeout(samplesPerMode * 2 * 90_000 + 30_000);

test("archives cold and hot lobby-to-cruise loading stage baselines", async ({ browser }, testInfo) => {
  const cold = [];
  for (let index = 0; index < samplesPerMode; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    cold.push(await launchAndReadReport(page));
    await context.close();
  }

  const hot = [];
  const hotContext = await browser.newContext();
  const hotPage = await hotContext.newPage();
  // Prime module and model caches; the next launches represent revisit/hot
  // behavior rather than a fresh context's first navigation.
  await launchAndReadReport(hotPage);
  for (let index = 0; index < samplesPerMode; index += 1) {
    hot.push(await launchAndReadReport(hotPage));
  }
  await hotContext.close();

  const report = { cold, hot, summary: { cold: summarize(cold), hot: summarize(hot) } };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(reportName)) {
    throw new Error("RACING_LOADING_REPORT_NAME must be a simple .json filename.");
  }
  const outputPath = path.join(process.cwd(), "output", reportName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body);
  await testInfo.attach("racing-loading-baseline.json", { body: Buffer.from(body), contentType: "application/json" });
  expect(cold).toHaveLength(samplesPerMode);
  expect(hot).toHaveLength(samplesPerMode);
});

async function launchAndReadReport(page) {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#gameLifecycleView")).toBeVisible();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await page.locator("#gameLifecycleEnterButton").click();
  await expect(page.locator("#racingView")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 60_000 });
  return page.evaluate(() => globalThis.__ackGamesDebug.lifecycle.getLastLoadReport());
}

function summarize(reports) {
  const totals = reports.map((report) => report.totalMs).sort((a, b) => a - b);
  const stageDurations = {};
  for (const report of reports) {
    for (const event of report.timeline) {
      if (!stageDurations[event.stage]) stageDurations[event.stage] = [];
      stageDurations[event.stage].push(event.elapsedMs);
    }
  }
  return {
    totalMs: { p50: percentile(totals, 0.5), p95: percentile(totals, 0.95) },
    stages: Object.fromEntries(Object.entries(stageDurations).map(([stage, values]) => {
      const sorted = values.sort((a, b) => a - b);
      return [stage, { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }];
    }))
  };
}

function percentile(values, ratio) {
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
}
