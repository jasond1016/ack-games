const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("J0–J3 rewind chase camera stays locked to car without high-frequency shake", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });

  await page.keyboard.down("KeyW");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh), {
      timeout: 20_000
    })
    .toBeGreaterThan(20);
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.bufferedSeconds), {
      timeout: 15_000
    })
    .toBeGreaterThan(1.2);
  await page.keyboard.up("KeyW");

  await page.keyboard.down("KeyZ");
  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.active))
    .toBe(true);

  const samples = [];
  for (let i = 0; i < 45; i += 1) {
    samples.push(
      await page.evaluate(() => {
        const state = globalThis.__ackGamesDebug.racing.getState();
        return {
          cam: state.camera,
          player: state.playerPosition,
          heading: state.heading,
          active: state.rewind.active,
          fov: state.camera?.fov
        };
      })
    );
    await page.waitForTimeout(32);
  }
  await page.keyboard.up("KeyZ");

  const active = samples.filter((sample) => sample.active && sample.cam);
  expect(active.length).toBeGreaterThan(20);

  // Camera should track the car: planar offset stays near followDistance, not thrashing.
  const offsets = active.map((sample) =>
    Math.hypot(sample.cam.x - sample.player.x, sample.cam.z - sample.player.y)
  );
  const meanOffset = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  const offsetVariance =
    offsets.reduce((sum, value) => sum + (value - meanOffset) ** 2, 0) / offsets.length;
  expect(meanOffset).toBeGreaterThan(4);
  expect(offsetVariance).toBeLessThan(0.35);

  // Frame-to-frame camera motion should be steady scrub, not alternating shake spikes.
  const camDeltas = [];
  for (let i = 1; i < active.length; i += 1) {
    const prev = active[i - 1].cam;
    const next = active[i].cam;
    camDeltas.push(Math.hypot(next.x - prev.x, next.y - prev.y, next.z - prev.z));
  }
  const meanDelta = camDeltas.reduce((sum, value) => sum + value, 0) / camDeltas.length;
  const deltaVariance =
    camDeltas.reduce((sum, value) => sum + (value - meanDelta) ** 2, 0) / camDeltas.length;
  const maxDelta = Math.max(...camDeltas);
  expect(meanDelta).toBeGreaterThan(0.02);
  expect(deltaVariance).toBeLessThan(Math.max(0.12, meanDelta * meanDelta * 2.5));
  expect(maxDelta).toBeLessThan(meanDelta * 4 + 0.5);

  // FOV must stay pinned (no kick oscillation) while rewinding.
  const fovSpread = Math.max(...active.map((sample) => sample.fov)) - Math.min(...active.map((sample) => sample.fov));
  expect(fovSpread).toBeLessThan(0.05);

  await expect
    .poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().rewind.active))
    .toBe(false);
});
