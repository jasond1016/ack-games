const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("I0–I4 coastal bridge near challenge is not blocked by invisible rails", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });
  await expect
    .poll(() => page.evaluate(() => Boolean(globalThis.__ackGamesDebug.racing.getState().playerPosition)))
    .toBe(true);
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    globalThis.__ackGamesDebug.racing.placeTrackScenario(0.11);
  });
  await page.waitForTimeout(300);

  const start = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().playerPosition);

  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh), {
      timeout: 12_000
    })
    .toBeGreaterThan(25);

  let peakSpeed = 0;
  let hitRail = false;
  for (let i = 0; i < 70; i += 1) {
    const sample = await page.evaluate(() => {
      const state = globalThis.__ackGamesDebug.racing.getState();
      return {
        speed: state.speedKmh,
        tag: state.lastCollision?.tag ?? null,
        x: state.playerPosition.x,
        y: state.playerPosition.y
      };
    });
    peakSpeed = Math.max(peakSpeed, sample.speed);
    if (sample.tag === "rail") hitRail = true;
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("KeyW");

  const end = await page.evaluate((origin) => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      travel: Math.hypot(
        state.playerPosition.x - origin.x,
        state.playerPosition.y - origin.y
      ),
      lastCollision: state.lastCollision
    };
  }, start);

  expect(peakSpeed).toBeGreaterThan(40);
  expect(end.travel).toBeGreaterThan(50);
  expect(hitRail).toBe(false);
  if (end.lastCollision) {
    expect(end.lastCollision.tag).not.toBe("rail");
  }
});
