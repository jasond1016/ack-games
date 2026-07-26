const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("B0 reverse bridge approach does not yank onto showcase landing line", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });
  await page.waitForTimeout(1500);

  // Approach the gap from the far (right) side, heading back toward start (-X).
  // Gap is ~x 178–202; place just past max on the jump corridor (|z|>8).
  const placed = await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.placeWorldScenario(210, -40, -Math.PI * 0.5)
  );
  expect(placed).toBe(true);

  const start = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      x: state.playerPosition.x,
      y: state.playerPosition.y,
      heading: state.playerHeading
    };
  });
  expect(start.x).toBeGreaterThan(205);
  // Facing -X (heading ≈ -π/2).
  expect(Math.abs(Math.sin(start.heading) + 1)).toBeLessThan(0.35);

  await page.evaluate(() => globalThis.__ackGamesDebug.racing.setPlayerPlanarSpeed(28));
  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh), {
      timeout: 12_000
    })
    .toBeGreaterThan(40);

  const path = [];
  for (let i = 0; i < 90; i += 1) {
    path.push(
      await page.evaluate(() => {
        const state = globalThis.__ackGamesDebug.racing.getState();
        return {
          x: state.playerPosition.x,
          y: state.playerPosition.y,
          speed: state.speedKmh,
          assist: state.airYaw?.attitudeAssistSeconds ?? 0,
          airborne: state.airborne ?? false
        };
      })
    );
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("KeyW");

  // Crossed or at least entered the gap region while driving reverse (-X).
  const minX = Math.min(...path.map((sample) => sample.x));
  expect(minX).toBeLessThan(200);

  // Free-cruise must not arm showcase landing-line attitude assist (#30).
  const maxAssist = Math.max(...path.map((sample) => sample.assist));
  expect(maxAssist).toBe(0);

  // Lateral yank toward the yellow-marker / showcase line would spike |Δy|.
  let maxStepDy = 0;
  for (let i = 1; i < path.length; i += 1) {
    maxStepDy = Math.max(maxStepDy, Math.abs(path[i].y - path[i - 1].y));
  }
  expect(maxStepDy).toBeLessThan(6);

  const end = path[path.length - 1];
  expect(Math.abs(end.y - start.y)).toBeLessThan(18);
});
