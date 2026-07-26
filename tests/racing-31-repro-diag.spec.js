const { test, expect } = require("@playwright/test");
const { enterCoastalFreeCruiseFromLobby } = require("./racing-test-helpers");

test("#31 free-cruise reverse then left path cannot activate an invisible opponent", async ({ page }) => {
  await enterCoastalFreeCruiseFromLobby(page);
  await page.locator("#racingCanvas").click({ force: true });

  await expect.poll(() => page.evaluate(() => (
    globalThis.__ackGamesDebug.racing.getState().opponentColliderEnabled
  )), { timeout: 20_000 }).toBe(false);
  const initial = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(initial.opponentEnabled).toBe(false);
  expect(initial.opponentColliderEnabled).toBe(false);
  expect(initial.opponentCollisionGroups).toBe(0);

  // H is the opponent-toggle binding. Free-cruise must reject it so an old
  // session or accidental input cannot put an invisible opponent at spawn.
  await page.keyboard.press("KeyH");
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return state.opponentEnabled === false
      && state.opponentColliderEnabled === false
      && state.opponentCollisionGroups === 0;
  })).toBe(true);

  await page.keyboard.down("KeyS");
  await page.waitForTimeout(6_500);
  await page.keyboard.up("KeyS");
  await page.waitForTimeout(300);
  const afterReverse = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());

  await page.keyboard.down("KeyW");
  await page.keyboard.down("ArrowLeft");
  const trace = [];
  for (let index = 0; index < 80; index += 1) {
    trace.push(await page.evaluate(() => {
      const state = globalThis.__ackGamesDebug.racing.getState();
      return {
        x: state.playerPosition.x,
        z: state.playerPosition.y,
        speed: state.speedKmh,
        onRoad: state.onRoad,
        surface: state.surface.id,
        collision: state.lastCollision?.tag ?? null,
        opponentEnabled: state.opponentEnabled,
        opponentColliderEnabled: state.opponentColliderEnabled,
        opponentCollisionGroups: state.opponentCollisionGroups,
        near: state.worldColliders.nearbyStatic
      };
    }));
    await page.waitForTimeout(50);
  }
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("KeyW");

  const opponentImpact = trace.find((entry) => entry.collision === "opponent");
  expect(opponentImpact).toBeUndefined();
  expect(trace.every((entry) => (
    entry.opponentEnabled === false
      && entry.opponentColliderEnabled === false
      && entry.opponentCollisionGroups === 0
  ))).toBe(true);
  const finalState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(finalState.opponentEnabled).toBe(false);
  expect(finalState.opponentColliderEnabled).toBe(false);
  expect(finalState.opponentCollisionGroups).toBe(0);
  await test.info().attach("reverse-left-path.json", {
    body: Buffer.from(JSON.stringify({
      afterReverse: {
        position: afterReverse.playerPosition,
        surface: afterReverse.surface.id,
        lastCollision: afterReverse.lastCollision?.tag ?? null
      },
      end: {
        position: finalState.playerPosition,
        surface: finalState.surface.id,
        lastCollision: finalState.lastCollision?.tag ?? null
      },
      collisionChanges: trace.filter((entry, index) => index === 0 || entry.collision !== trace[index - 1].collision),
      allOpponentCollidersDisabled: trace.every((entry) => (
        entry.opponentEnabled === false
          && entry.opponentColliderEnabled === false
          && entry.opponentCollisionGroups === 0
      ))
    }, null, 2)),
    contentType: "application/json"
  });
});
