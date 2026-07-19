const { test, expect } = require("@playwright/test");

test("free-drive benchmark exposes stable telemetry and scene-complexity budgets", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });

  const scenarios = await page.evaluate(() => globalThis.__ackGamesDebug.racing.listTestScenarios());
  expect(scenarios.map(({ id }) => id)).toEqual(["asphalt", "rally", "tunnel", "stunt-jump"]);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  ), { timeout: 8_000 }).toBe("running");
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.placeTestScenario("asphalt"))).toBe(true);
  await page.evaluate(() => globalThis.__ackGamesDebug.racing.startBenchmark({ label: "ci-asphalt", durationSeconds: 1 }));

  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getTelemetry().benchmark.status
  ), { timeout: 10_000 }).toBe("completed");

  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(state.quality).toBe("low");
  expect(state.showcaseChallenge.phase).toBe("running");
  expect(state.showcaseChallenge.checkpointCount).toBeGreaterThanOrEqual(7);
  expect(state.telemetry.benchmark.frameCount).toBeGreaterThan(0);
  expect(state.telemetry.benchmark.durationSeconds).toBeGreaterThanOrEqual(1);
  expect(Number.isFinite(state.telemetry.benchmark.averageFrameMs)).toBe(true);
  expect(state.telemetry.benchmark.maximumRenderCalls).toBeGreaterThan(0);
  expect(state.telemetry.benchmark.maximumRenderCalls).toBeLessThan(1_500);
  expect(state.telemetry.benchmark.maximumTriangles).toBeGreaterThan(10_000);
  expect(state.telemetry.benchmark.maximumTriangles).toBeLessThan(5_000_000);
  expect(state.surfaceValidation.valid).toBe(true);
});
