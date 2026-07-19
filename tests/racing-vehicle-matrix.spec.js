const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_MATRIX === "1";
const carIds = (process.env.RACING_MATRIX_CARS || "miura-p400,veneno,urus-se")
  .split(",")
  .map((carId) => carId.trim())
  .filter(Boolean);

test.skip(!enabled, "run explicitly with pnpm run test:e2e:matrix");
test.setTimeout(carIds.length * 60_000 + 30_000);

test("builds a real-Rapier vehicle dynamics comparison matrix", async ({ page }, testInfo) => {
  const cars = [];

  for (const carId of carIds) {
    await startProvingGround(page, carId);
    const initialState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
    const protocols = {};

    for (const testId of ["zero-to-100", "100-to-zero", "skidpad", "fixed-steer"]) {
      expect(await page.evaluate((id) => globalThis.__ackGamesDebug.racing.startProvingGroundTest(id), testId)).toBe(true);
      await expect.poll(() => page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.getState().provingGround.status
      ), { timeout: 30_000 }).toBe("completed");
      protocols[testId] = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
      expect(protocols[testId].roadContactRatio).toBeGreaterThan(0.95);
    }

    const radiusErrorMeters = Number((protocols.skidpad.averageRadiusMeters - 30).toFixed(3));
    const drivetrainConfig = {
      wheelRadius: initialState.vehiclePhysics.wheelRadius,
      finalDrive: initialState.vehiclePhysics.finalDrive,
      gearRatios: initialState.vehiclePhysics.gearRatios,
      upshiftRpm: initialState.vehiclePhysics.upshiftRpm
    };
    cars.push({
      carId,
      label: initialState.playerCar,
      massKg: initialState.vehiclePhysics.mass,
      driveLayout: initialState.vehiclePhysics.driveLayout,
      topSpeedKmh: initialState.vehiclePhysics.topSpeedKmh,
      drivetrainConfig,
      accelerationDiagnostics: summarizeAccelerationTrace(protocols["zero-to-100"], drivetrainConfig),
      handlingDiagnostics: summarizeFixedSteer(protocols["fixed-steer"]),
      radiusErrorMeters,
      radiusTracking: radiusErrorMeters > 1 ? "outside" : radiusErrorMeters < -1 ? "inside" : "on-target",
      protocols
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: "preset-proving-ground",
    surface: "road",
    cars
  };
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = path.join(process.cwd(), "output", "racing-vehicle-matrix.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportBody);
  await testInfo.attach("racing-vehicle-matrix.json", {
    body: Buffer.from(reportBody),
    contentType: "application/json"
  });

  expect(cars).toHaveLength(carIds.length);
});

async function startProvingGround(page, carId) {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
}

function summarizeAccelerationTrace(result, config) {
  const trace = result.drivetrainTrace;
  expect(trace.length).toBeGreaterThan(10);
  const firstRatio = config.gearRatios[0];
  const firstGearUpshiftSpeedKmh = config.upshiftRpm
    / (firstRatio * config.finalDrive)
    * Math.PI * 2 / 60
    * config.wheelRadius * 3.6;
  return {
    firstGearUpshiftSpeedKmh: Number(firstGearUpshiftSpeedKmh.toFixed(2)),
    highestGear: Math.max(...trace.map(({ gear }) => gear)),
    peakEngineRpm: Math.max(...trace.map(({ engineRpm }) => engineRpm)),
    minimumTcsEngineScale: Math.min(...trace.map(({ tcsEngineScale }) => tcsEngineScale)),
    averageTcsEngineScale: Number((
      trace.reduce((sum, { tcsEngineScale }) => sum + tcsEngineScale, 0) / trace.length
    ).toFixed(3)),
    peakEngineForcePerWheel: Math.max(...trace.map(({ engineForcePerWheel }) => engineForcePerWheel))
  };
}

function summarizeFixedSteer(result) {
  const retention = result.curvatureGainRetention;
  return {
    curvatureGainRetention: retention,
    trend: retention < 0.9
      ? "falling-curvature-gain"
      : retention > 1.1 ? "rising-curvature-gain" : "stable-curvature-gain",
    steadyRadiusMeters: result.steadyRadiusMeters,
    maximumLateralAcceleration: result.maximumLateralAcceleration
  };
}
