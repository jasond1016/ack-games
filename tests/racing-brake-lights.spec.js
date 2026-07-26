const { test, expect } = require("@playwright/test");

test("brake lights light while braking and extinguish on release", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  const startRaceButton = page.locator("#racingStartRaceButton");
  await expect(startRaceButton).toBeEnabled({ timeout: 60_000 });
  await startRaceButton.click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });

  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().brakeLights?.count ?? 0
  )).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().brakeLights?.anchor
  )).toBe("model-tail-lamps");
  const baseline = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().brakeLights);

  await page.keyboard.down("KeyS");
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().brakeLights.active
  )).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().brakeLights.intensity
  )).toBeGreaterThan(1);

  await page.keyboard.up("KeyS");
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().brakeLights
  )).toMatchObject({ active: false, intensity: baseline.baselineIntensity });
});
