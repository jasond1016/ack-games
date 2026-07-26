const { test, expect } = require("@playwright/test");
const { openRacingMapSelect } = require("./racing-test-helpers");

test("W0–W3 aventador wheels stay hub-bound under accel and steer", async ({ page }) => {
  await openRacingMapSelect(page);
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="aventador"]').click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingHudOverlay")).toBeVisible({ timeout: 90_000 });
  await page.locator("#racingCanvas").click({ force: true });

  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh), {
      timeout: 25_000
    })
    .toBeGreaterThan(20);
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(900);

  const report = await page.evaluate(() => globalThis.__ackGamesDebug.racing.diagnoseWheelVisuals());
  await page.keyboard.up("KeyA");
  await page.keyboard.up("KeyW");

  expect(report.wheelCount).toBe(4);
  expect(report.contacts).toBeGreaterThanOrEqual(2);
  expect(report.layouts.length).toBeGreaterThan(0);
  for (const layout of report.layouts) {
    expect(layout.type).toBe("four-wheel");
    expect(layout.centers).toHaveLength(4);
    expect(layout.radiusLimit).toBeGreaterThanOrEqual(0.55);
    expect(layout.radiusLimit).toBeLessThan(2.5);
    for (const center of layout.centers) {
      expect(Math.abs(center.x)).toBeGreaterThan(0.4);
      expect(Math.abs(center.x)).toBeLessThan(1.6);
      expect(Math.abs(center.z)).toBeGreaterThan(0.8);
      expect(Math.abs(center.z)).toBeLessThan(2.2);
    }
  }

  // Road contact / suspension stay sane (W1 spirit).
  for (const length of report.suspensionLengths) {
    expect(length).toBeGreaterThan(0.15);
    expect(length).toBeLessThan(0.75);
  }
});
