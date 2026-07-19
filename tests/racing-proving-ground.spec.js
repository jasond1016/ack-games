const { test, expect } = require("@playwright/test");

test("proving ground runs acceleration, braking, and skidpad protocols against the Rapier vehicle", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="veneno"]').click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });

  const tests = await page.evaluate(() => globalThis.__ackGamesDebug.racing.listProvingGroundTests());
  expect(tests.map(({ id }) => id)).toEqual(["zero-to-100", "zero-to-200", "100-to-zero", "skidpad", "fixed-steer"]);
  const world = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().worldColliders);
  expect(world.tunnelPieces).toBe(0);
  expect(world.rallyDirtMeshes).toBe(0);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().traffic)).toEqual([]);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.placeStuntJumpScenario())).toBe(false);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.placeTunnelScenario())).toBe(false);

  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.startProvingGroundTest("zero-to-100"))).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().provingGround.status
  ), { timeout: 20_000 }).toBe("completed");
  const acceleration = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
  expect(acceleration.zeroTo100Seconds).toBeGreaterThan(0);
  expect(acceleration.zeroTo100Seconds).toBeLessThan(15);
  expect(acceleration.distanceMeters).toBeGreaterThan(0);
  expect(acceleration.drivetrainTrace.length).toBeGreaterThan(10);
  await page.evaluate(() => globalThis.__ackGamesDebug.racing.resetRace());
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround)).toEqual({ status: "idle" });

  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.startProvingGroundTest("100-to-zero"))).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().provingGround.status
  ), { timeout: 30_000 }).toBe("completed");
  const braking = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
  expect(braking.brakingSeconds).toBeGreaterThan(0);
  expect(braking.brakingDistanceMeters).toBeGreaterThan(0);
  expect(braking.startSpeedKmh).toBeGreaterThanOrEqual(100);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh)).toBeLessThanOrEqual(1);

  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.startProvingGroundTest("skidpad"))).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().provingGround.status
  ), { timeout: 20_000 }).toBe("completed");
  const skidpad = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
  expect(skidpad.maximumSpeedKmh).toBeGreaterThan(0);
  expect(skidpad.maximumLateralAcceleration).toBeGreaterThan(0);
  expect(skidpad.averageRadiusMeters).toBeGreaterThanOrEqual(27);
  expect(skidpad.averageRadiusMeters).toBeLessThanOrEqual(33);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().surface.id)).toBe("road");

  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.startProvingGroundTest("fixed-steer"))).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().provingGround.status
  ), { timeout: 20_000 }).toBe("completed");
  const fixedSteer = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
  expect(fixedSteer.earlyCurvatureGain).toBeGreaterThan(0);
  expect(fixedSteer.steadyCurvatureGain).toBeGreaterThan(0);
  expect(fixedSteer.steadyRadiusMeters).toBeGreaterThan(0);
});
