const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("E0 lobby racing card launches Coastal free-cruise without map/start overlays", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(state.startConfig.coastalPlayMode).toBe("free-cruise");
  expect(state.map.name).toBe("Coastal Festival Showcase");
  expect(state.map.environmentProfile).toBe("coastal-showcase");
  expect(state.showcaseEvent.phase).toBe("idle");
  expect(state.entryAutostart).toBe(true);
});

test("E1 missing memory prefers veneno when unlocked, else unlocked starter", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("ack-games:racing-start-config:v1");
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["veneno"]
    }));
  });
  await enterCoastalFreeCruiseFromLobby(page);
  const carId = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().startConfig.playerCarId);
  expect(carId).toBe("veneno");
});

test("E2 Esc opens car select; confirm keeps pose; Esc cancels", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
    }));
  });
  await enterCoastalFreeCruiseFromLobby(page);
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => {
    const s = globalThis.__ackGamesDebug.racing.getState();
    return { x: s.playerPosition.x, y: s.playerPosition.y, heading: s.playerHeading, carId: s.startConfig.playerCarId };
  });

  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().carSelectMode
  )).toBe("cruise-swap");
  await expect(page.locator("#racingStartHomeButton")).toHaveText("大厅");
  await expect(page.locator("#racingStartRaceButton")).toHaveText("确认");

  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().carSelectMode
  )).toBeNull();

  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeVisible();
  const nextCarId = before.carId === "aventador" ? "huracan-sto" : "aventador";
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${nextCarId}"]`).click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 30_000 });

  const after = await page.evaluate(() => {
    const s = globalThis.__ackGamesDebug.racing.getState();
    return { x: s.playerPosition.x, y: s.playerPosition.y, heading: s.playerHeading, carId: s.startConfig.playerCarId };
  });
  expect(after.carId).toBe(nextCarId);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(3);
  expect(Math.abs(after.heading - before.heading)).toBeLessThan(0.35);
});

test("E3 car-select 大厅 returns home; focus-loss pauses without car select", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.waitForTimeout(400);

  // Blur must not open car select.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().carSelectMode)).toBeNull();
  await expect(page.locator("#racingStartOverlay")).toBeHidden();

  // Tab hide / visibility pause (same product rule as 失焦).
  await page.evaluate(() => globalThis.__ackGamesDebug.racing.setPaused(true));
  await expect(page.locator("#racingPauseOverlay")).toBeVisible();
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().carSelectMode)).toBeNull();

  await page.locator("#racingResumeButton").click();
  await expect(page.locator("#racingPauseOverlay")).toBeHidden();

  await page.locator("#racingCanvas").click({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().carSelectMode))
    .toBe("cruise-swap");
  await expect(page.locator("#racingStartHomeButton")).toHaveText("大厅");
  await page.locator("#racingStartHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible({ timeout: 20_000 });
});
