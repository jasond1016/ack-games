const { test, expect } = require("@playwright/test");

test("Coastal free-cruise spawns four typed civilian traffic vehicles", async ({ page }) => {
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
  await expect(page.locator("#racingHudOverlay")).toBeVisible();
  await page.waitForTimeout(800);

  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.listTraffic?.()?.length
      ?? globalThis.__ackGamesDebug.racing.getState().traffic?.length
      ?? 0
  ), { timeout: 20_000 }).toBe(4);

  const traffic = await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.listTraffic?.()
      ?? globalThis.__ackGamesDebug.racing.getState().traffic
  );
  expect(traffic.map(({ typeId }) => typeId).sort()).toEqual(["mini", "sedan", "suv", "truck"]);
  expect(traffic.every(({ eventOpponent }) => eventOpponent === false)).toBe(true);
  expect(traffic.every(({ cruiseSpeedKmh }) => cruiseSpeedKmh >= 48 && cruiseSpeedKmh <= 72)).toBe(true);
  expect(new Set(traffic.map(({ trafficId }) => trafficId)).size).toBe(4);
});
