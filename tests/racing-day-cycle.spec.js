const { test, expect } = require("@playwright/test");

test("Coastal day cycle probe exposes phase and freeze day/night", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingCoastalModeFreeCruiseButton").click();
  const startRaceButton = page.locator("#racingStartRaceButton");
  await expect(startRaceButton).toBeEnabled({ timeout: 90_000 });
  await startRaceButton.click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 90_000 });

  const live = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().dayCycle);
  expect(live.enabled).toBe(true);
  expect(live.cycleSeconds).toBe(240);
  expect(["day", "dusk", "night", "dawn"]).toContain(live.phase);
  expect(live.timeOfDay).toBe(live.phase);

  await page.evaluate(() => globalThis.__ackGamesDebug.racing.setDayCycleFreeze("night"));
  const night = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().dayCycle);
  expect(night.frozenPhase).toBe("night");
  expect(night.phase).toBe("night");
  expect(night.exposureScale).toBeLessThan(0.7);
  expect(night.headlightBoost).toBeGreaterThan(0.5);

  await page.keyboard.press("Escape");
  await expect(page.locator("#racingPauseOverlay")).toBeVisible();
  await expect(page.locator("#racingDayCycleRow")).toBeVisible();
  await page.locator("#racingDayCycleDayButton").click();
  const day = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().dayCycle);
  expect(day.frozenPhase).toBe("day");
  expect(day.phase).toBe("day");
  expect(day.sunIntensity).toBeGreaterThan(2);

  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();
});
