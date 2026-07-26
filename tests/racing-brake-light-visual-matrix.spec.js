const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_BRAKE_VISUAL_MATRIX === "1";
const carIds = (process.env.RACING_BRAKE_VISUAL_CARS || [
  "aventador", "urus-se", "miura-p400", "countach-lpi-800-4", "dbr9", "bolide",
  "centodieci", "revuelto", "aventador-classic", "countach-5000qv", "huracan-sto", "veneno"
].join(","))
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const views = ["rear", "left-rear", "right-rear"];

test.skip(!enabled, "run explicitly with RACING_BRAKE_VISUAL_MATRIX=1");
test.setTimeout(carIds.length * 90_000 + 30_000);

test("all drivable cars keep brake light materials in their own tail lamps", async ({ page }, testInfo) => {
  const evidenceDir = path.join(process.cwd(), "output", "brake-light-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const report = [];

  for (const carId of carIds) {
    await page.addInitScript(() => {
      localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
        unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
      }));
    });
    await page.goto("/?quality=low");
    await page.goto("/#racing-select");
    await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
    await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-f1-practice"] .map-select-card-button').click();
    await page.locator("#racingMapSelectRaceButton").click();
    await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
    await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
    await page.locator("#racingStartRaceButton").click();
    await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });
    await page.locator("#racingCanvas").click({ force: true });

    await expect.poll(() => page.evaluate(() =>
      globalThis.__ackGamesDebug.racing.getState().brakeLights.count
    ), { timeout: 30_000 }).toBeGreaterThan(0);
    const beforeBrake = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().brakeLights);
    const lampCandidates = await page.evaluate(() => globalThis.__ackGamesDebug.racing.diagnoseBrakeLampCandidates());
    expect(beforeBrake.anchor, `${carId} brake anchor ${JSON.stringify(lampCandidates)}`).toBe("model-tail-lamps");
    expect(beforeBrake.materialCount, `${carId} brake material count`).toBeGreaterThan(0);
    expect(beforeBrake.active).toBe(false);
    expect(beforeBrake.intensity).toBe(beforeBrake.baselineIntensity);
    expect(beforeBrake.nodes.length).toBeGreaterThan(0);

    await page.keyboard.down("KeyS");
    await expect.poll(() => page.evaluate(() => {
      const brakeLights = globalThis.__ackGamesDebug.racing.getState().brakeLights;
      return brakeLights.active && brakeLights.intensity > brakeLights.baselineIntensity + 1;
    })).toBe(true);
    const braking = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().brakeLights);
    expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().opponentBrakeLights.active)).toBe(false);

    for (const view of views) {
      expect(await page.evaluate((nextView) =>
        globalThis.__ackGamesDebug.racing.setBrakeLightEvidenceView(nextView), view
      )).toBe(view);
      await page.waitForTimeout(120);
      await page.locator("#racingCanvas").screenshot({
        path: path.join(evidenceDir, `${carId}-${view}.png`)
      });
    }

    // The lamp meshes are model children. Moving the physical vehicle moves
    // their world position while their car-local anchor remains unchanged.
    await page.evaluate(() => globalThis.__ackGamesDebug.racing.placeTrackScenario(0.25));
    await page.waitForTimeout(180);
    const moved = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().brakeLights);
    const movedDistance = Math.hypot(
      moved.nodes[0].world[0] - braking.nodes[0].world[0],
      moved.nodes[0].world[1] - braking.nodes[0].world[1],
      moved.nodes[0].world[2] - braking.nodes[0].world[2]
    );
    expect(movedDistance).toBeGreaterThan(1);
    expect(moved.nodes.every((node, index) => node.local.every((value, axis) => (
      Math.abs(value - braking.nodes[index].local[axis]) <= 0.001
    )))).toBe(true);

    await page.keyboard.up("KeyS");
    await expect.poll(() => page.evaluate(() => {
      const brakeLights = globalThis.__ackGamesDebug.racing.getState().brakeLights;
      return !brakeLights.active && Math.abs(brakeLights.intensity - brakeLights.baselineIntensity) <= 0.01;
    })).toBe(true);
    await page.evaluate(() => globalThis.__ackGamesDebug.racing.setBrakeLightEvidenceView(null));

    report.push({
      carId,
      anchor: braking.anchor,
      materialCount: braking.materialCount,
      nodeCount: braking.nodes.length,
      views,
      movedDistance: Number(movedDistance.toFixed(2))
    });
  }

  const reportBody = `${JSON.stringify({ carIds, report }, null, 2)}\n`;
  fs.writeFileSync(path.join(evidenceDir, "report.json"), reportBody);
  await testInfo.attach("brake-light-visual-matrix.json", {
    body: Buffer.from(reportBody),
    contentType: "application/json"
  });
  expect(report).toHaveLength(carIds.length);
});
