const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("diagnostic: coastal start nearby colliders and forward drive clearance", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    globalThis.__ackGamesDebug.racing.placeTrackScenario(0.11);
  });
  await page.waitForTimeout(400);

  const near = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return {
      player: state.playerPosition,
      nearby: state.worldColliders?.nearbyStatic ?? [],
      challenges: state.worldColliders?.challengePoints ?? [],
      activity: state.map?.activity,
      coastalPlayMode: state.startConfig?.coastalPlayMode
    };
  });
  console.log("near-0.11", JSON.stringify(near, null, 2));

  await page.keyboard.down("KeyW");
  const path = [];
  for (let i = 0; i < 60; i += 1) {
    path.push(await page.evaluate(() => {
      const state = globalThis.__ackGamesDebug.racing.getState();
      return {
        x: state.playerPosition.x,
        y: state.playerPosition.y,
        speed: state.speedKmh,
        physicsHeight: state.physicsHeight,
        airborne: state.airborne,
        grounded: state.surface?.grounded,
        surfaceId: state.surface?.id,
        lastCollision: state.lastCollision,
        nearby: (state.worldColliders?.nearbyStatic ?? []).slice(0, 8)
      };
    }));
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("KeyW");

  const maxSpeed = Math.max(...path.map((sample) => sample.speed));
  const stuckSamples = path.filter((sample) => sample.speed < 5);
  console.log(JSON.stringify({
    maxSpeed,
    travel: Math.hypot(path.at(-1).x - near.player.x, path.at(-1).y - near.player.y),
    firstStuck: stuckSamples[0] ?? null,
    last: path.at(-1),
    aroundStuck: path.slice(20, 35)
  }, null, 2));
});
