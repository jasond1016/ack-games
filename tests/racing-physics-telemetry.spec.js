const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("Physics Telemetry HUD defaults hidden and toggles with F2", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.waitForTimeout(400);

  const initial = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(initial.collisionDebugEnabled).toBe(false);
  expect(initial.collisionDebugHudVisible).toBe(false);

  await page.locator("#racingCanvas").click({ force: true });
  await page.keyboard.press("F2");
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return state.collisionDebugEnabled && state.collisionDebugHudVisible;
  })).toBe(true);

  await page.keyboard.press("F2");
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return !state.collisionDebugEnabled && !state.collisionDebugHudVisible;
  })).toBe(true);

  await page.keyboard.press("F2");
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return state.collisionDebugEnabled && state.collisionDebugHudVisible;
  })).toBe(true);
});
