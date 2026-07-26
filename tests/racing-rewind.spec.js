const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("R0–R5 rewind holds Z to scrub back within 10s and remaps camera off Y", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });

  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh), {
      timeout: 20_000
    })
    .toBeGreaterThan(12);

  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.bufferedSeconds), {
      timeout: 15_000
    })
    .toBeGreaterThan(0.4);

  const before = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      x: state.playerPosition.x,
      y: state.playerPosition.y,
      elapsed: state.elapsedSeconds,
      buffered: state.rewind.bufferedSeconds,
      cameraMode: state.cameraMode
    };
  });

  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyZ");

  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.active))
    .toBe(true);

  await expect(page.locator("#racingRewindHud")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate((origin) => {
        const state = globalThis.__ackGamesDebug.racing.getState();
        const dx = state.playerPosition.x - origin.x;
        const dy = state.playerPosition.y - origin.y;
        return Math.hypot(dx, dy);
      }, before)
    , { timeout: 8_000 })
    .toBeGreaterThan(2);

  await page.waitForTimeout(400);
  const during = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(during.rewind.active).toBe(true);
  expect(during.rewind.bufferSeconds).toBe(10);
  expect(during.rewind.bufferedSeconds).toBeLessThanOrEqual(10.01);
  expect(during.elapsedSeconds).toBeGreaterThan(before.elapsed);

  await page.keyboard.up("KeyZ");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.active))
    .toBe(false);
  await expect(page.locator("#racingRewindHud")).toBeHidden();

  // R2: free-cruise Esc opens car-select overlay — rewind must not activate.
  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.down("KeyZ");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.active)).toBe(false);
  await page.keyboard.up("KeyZ");
  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeHidden();

  // Camera still toggles with C (not dependent on Y).
  await page.locator("#racingCanvas").click({ force: true });
  const camBefore = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().cameraMode);
  await page.keyboard.press("KeyC");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().cameraMode))
    .not.toBe(camBefore);

  // Buffer never exceeds 10s after long drive.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  const buffered = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.bufferedSeconds);
  expect(buffered).toBeLessThanOrEqual(10.05);
});
