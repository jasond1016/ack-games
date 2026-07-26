const { test, expect } = require("@playwright/test");

test("lobby cruise stays in the ready image until Enter atomically starts it", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();

  await expect(page.locator("#gameLifecycleView")).toBeVisible();
  await expect(page.locator("#racingView")).toBeHidden();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await expect(page.locator("#gameLifecycleEnterButton")).toBeVisible();
  const beforeWait = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  await page.waitForTimeout(2_100);
  const afterWait = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(beforeWait.lifecycle.simulationStarted).toBe(false);
  expect(afterWait.lifecycle).toEqual(beforeWait.lifecycle);
  expect(afterWait.elapsedSeconds).toBe(beforeWait.elapsedSeconds);
  expect(afterWait.audio).toEqual(beforeWait.audio);

  await page.keyboard.press("Enter");
  await expect(page.locator("#racingView")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().lifecycle.simulationStarted)).toBe(true);

  const report = await page.evaluate(() => globalThis.__ackGamesDebug.lifecycle.getLastLoadReport());
  expect(report.gameId).toBe("racing");
  expect(report.timeline.map(({ stage }) => stage)).toEqual(expect.arrayContaining([
    "loading-first-frame",
    "module-ready",
    "scene",
    "physics",
    "vehicles",
    "input",
    "ready",
    "first-drivable-frame"
  ]));
  expect(report.awaitingConfirmation).toBe(false);
  expect(report.totalMs).toBeGreaterThan(0);
});
