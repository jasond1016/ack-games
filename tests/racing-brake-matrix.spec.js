const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_BRAKE_MATRIX === "1";
const phase = process.env.RACING_BRAKE_PHASE || "after";
const carIds = (process.env.RACING_BRAKE_CARS || "aventador,urus-se,huracan-sto")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

test.skip(!enabled, "run explicitly with RACING_BRAKE_MATRIX=1");
test.setTimeout(carIds.length * 90_000 + 30_000);

async function unlockChallengeCars(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
    }));
  });
}

async function startProvingGround(page, carId) {
  await unlockChallengeCars(page);
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
  const startRaceButton = page.locator("#racingStartRaceButton");
  await expect(startRaceButton).toBeEnabled({ timeout: 60_000 });
  await startRaceButton.click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });
}

test(`archives 100-to-zero brake distances (${phase})`, async ({ page }, testInfo) => {
  const cars = [];

  for (const carId of carIds) {
    await startProvingGround(page, carId);
    const massKg = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().vehiclePhysics.mass);
    expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.startProvingGroundTest("100-to-zero"))).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      globalThis.__ackGamesDebug.racing.getState().provingGround.status
    ), { timeout: 40_000 }).toBe("completed");
    const proving = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
    expect(proving.brakingDistanceMeters).toBeGreaterThan(0);
    cars.push({
      carId,
      massKg,
      brakingDistanceMeters: Number(proving.brakingDistanceMeters.toFixed(3)),
      brakingSeconds: Number(proving.brakingSeconds.toFixed(3)),
      startSpeedKmh: Number(proving.startSpeedKmh.toFixed(2)),
      roadContactRatio: Number(proving.roadContactRatio.toFixed(4))
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase,
    protocol: "100-to-zero",
    cars
  };
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `racing-brake-${phase}.json`);
  fs.writeFileSync(reportPath, reportBody);
  await testInfo.attach(`racing-brake-${phase}.json`, {
    body: Buffer.from(reportBody),
    contentType: "application/json"
  });

  if (phase === "after") {
    const baselinePath = path.join(outDir, "racing-brake-baseline.json");
    expect(fs.existsSync(baselinePath), "missing baseline; run RACING_BRAKE_PHASE=baseline first").toBe(true);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const byId = Object.fromEntries(baseline.cars.map((row) => [row.carId, row]));
    for (const row of cars) {
      const before = byId[row.carId];
      expect(before, `missing baseline car ${row.carId}`).toBeTruthy();
      const reduction = (before.brakingDistanceMeters - row.brakingDistanceMeters) / before.brakingDistanceMeters;
      expect(reduction, `${row.carId} reduction ${reduction}`).toBeGreaterThanOrEqual(0.1);
    }
    const urus = cars.find((row) => row.carId === "urus-se");
    const supercar = cars.find((row) => row.carId === "huracan-sto");
    if (urus && supercar) {
      expect(urus.brakingDistanceMeters).toBeGreaterThan(supercar.brakingDistanceMeters);
    }
  }

  expect(cars).toHaveLength(carIds.length);
});
