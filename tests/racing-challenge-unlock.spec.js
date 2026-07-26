const { test, expect } = require("@playwright/test");

test("challenge reward cars stay locked until unlock storage is set", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });

  const veneno = page.locator('#racingCarOptions .race-car-option[data-car-id="veneno"]');
  await expect(veneno).toHaveClass(/is-locked/);
  await expect(veneno).toBeDisabled();

  await page.evaluate(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["veneno"]
    }));
  });
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('#racingCarOptions .race-car-option[data-car-id="veneno"]')).not.toHaveClass(/is-locked/);
  await expect(page.locator('#racingCarOptions .race-car-option[data-car-id="veneno"]')).toBeEnabled();
});
