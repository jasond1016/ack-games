const { test, expect } = require("@playwright/test");

async function reachReady(page) {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
}

test("mouse confirmation is atomic and pre-ready controls do not run the cruise", async ({ page }) => {
  await reachReady(page);
  await page.keyboard.press("Escape");
  const before = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(before.lifecycle.simulationStarted).toBe(false);
  expect(before.paused).toBe(false);

  await page.locator("#gameLifecycleEnterButton").dblclick();
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 15_000 });
  const after = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(after.lifecycle.lobbyConfirmationCount).toBe(1);
  expect(after.lifecycle.simulationStartCount).toBe(1);
  expect(after.lifecycle.simulationStarted).toBe(true);
});

test("touch confirmation starts the prepared cruise once", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await reachReady(page);
  await page.locator("#gameLifecycleEnterButton").tap();
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 15_000 });
  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(state.lifecycle.lobbyConfirmationCount).toBe(1);
  expect(state.lifecycle.simulationStartCount).toBe(1);
  await context.close();
});

test("Xbox A confirmation starts the prepared cruise once", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__ackReadyPadPressed = false;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [{
        connected: true,
        id: "Xbox Test Pad",
        index: 0,
        mapping: "standard",
        axes: [0, 0],
        buttons: Array.from({ length: 16 }, (_, index) => ({
          pressed: index === 0 && globalThis.__ackReadyPadPressed,
          value: index === 0 && globalThis.__ackReadyPadPressed ? 1 : 0
        }))
      }]
    });
  });
  await reachReady(page);
  await page.evaluate(() => { globalThis.__ackReadyPadPressed = true; });
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 15_000 });
  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(state.lifecycle.lobbyConfirmationCount).toBe(1);
  expect(state.lifecycle.simulationStartCount).toBe(1);
});
