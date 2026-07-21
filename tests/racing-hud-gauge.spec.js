const { test, expect } = require("@playwright/test");

test("left HUD gauge binds real drivetrain and freezes on pause", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="urus-se"]').click();
  const startRaceButton = page.locator("#racingStartRaceButton");
  await expect(startRaceButton).toBeEnabled({ timeout: 60_000 });
  await startRaceButton.click();
  await expect(startOverlay).toBeHidden({ timeout: 60_000 });

  const gauge = page.locator("#racingGaugePanel");
  await expect(gauge).toBeVisible();
  await expect(page.locator("#racingSpeedValue")).toBeVisible();
  await expect(page.locator("#racingRpmValue")).toBeVisible();
  await expect(page.locator("#racingGearValue")).toBeVisible();

  const box = await gauge.boundingBox();
  const viewport = page.viewportSize();
  expect(box).toBeTruthy();
  expect(box.x).toBeLessThan((viewport?.width ?? 1280) * 0.35);
  expect(box.y).toBeGreaterThan((viewport?.height ?? 720) * 0.45);

  await page.keyboard.down("KeyW");
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    const rpmDom = Number(document.getElementById("racingRpmValue")?.textContent);
    return state.engineRpm > 900 && rpmDom === state.gauge.engineRpm;
  })).toBe(true);

  const live = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      engineRpm: state.engineRpm,
      gear: state.gear,
      gauge: state.gauge,
      rpmDom: document.getElementById("racingRpmValue")?.textContent,
      gearDom: document.getElementById("racingGearValue")?.textContent,
      speedDom: document.getElementById("racingSpeedValue")?.textContent
    };
  });
  expect(live.gauge.visible).toBe(true);
  expect(live.gauge.frozen).toBe(false);
  expect(live.gauge.params.redlineRpm).toBe(6800);
  expect(live.gauge.params.gearCount).toBe(8);
  expect(live.gauge.params.topSpeedKmh).toBe(312);
  expect(Number(live.rpmDom)).toBe(live.gauge.engineRpm);
  expect(live.gearDom).toBe(live.gauge.gearLabel);
  expect(Number(live.speedDom)).toBe(live.gauge.speedKmh);

  await page.keyboard.up("KeyW");
  await page.keyboard.press("Escape");
  await expect(page.locator("#racingPauseOverlay")).toBeVisible();

  const paused = await page.evaluate(() => {
    const before = globalThis.__ackGamesDebug.racing.getState();
    return {
      frozen: before.gauge.frozen,
      rpmText: document.getElementById("racingRpmValue")?.textContent,
      gearText: document.getElementById("racingGearValue")?.textContent
    };
  });
  expect(paused.frozen).toBe(true);

  await page.waitForTimeout(400);
  const still = await page.evaluate(() => ({
    rpmText: document.getElementById("racingRpmValue")?.textContent,
    gearText: document.getElementById("racingGearValue")?.textContent
  }));
  expect(still.rpmText).toBe(paused.rpmText);
  expect(still.gearText).toBe(paused.gearText);
});

test("HUD gauge params differ between cars", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });

  await page.locator('#racingCarOptions .race-car-option[data-car-id="miura-p400"]').click();
  await expect(page.locator("#racingStartRaceButton")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });

  const miura = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().gauge.params);
  expect(miura.redlineRpm).toBe(7700);
  expect(miura.gearCount).toBe(5);

  await page.keyboard.press("Escape");
  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();

  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="urus-se"]').click();
  await expect(page.locator("#racingStartRaceButton")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });

  const urus = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().gauge.params);
  expect(urus.redlineRpm).toBe(6800);
  expect(urus.gearCount).toBe(8);
  expect(urus.redlineRpm).not.toBe(miura.redlineRpm);
});
