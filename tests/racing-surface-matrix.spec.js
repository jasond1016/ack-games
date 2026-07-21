const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_SURFACE_MATRIX === "1";
const carId = process.env.RACING_SURFACE_MATRIX_CAR || "veneno";

test.skip(!enabled, "run explicitly with RACING_SURFACE_MATRIX=1");
test.setTimeout(240_000);

test("builds asphalt vs gravel vs ground surface comparison for P0 G4/G5", async ({ page }, testInfo) => {
  await startProvingGround(page, carId);

  const asphalt = await runSurfaceProtocols(page, "road");
  const gravel = await runSurfaceProtocols(page, "gravel");
  const groundCruise = await measureSteadyCruise(page, "ground");
  const roadCruise = await measureSteadyCruise(page, "road");

  const surfaces = {
    asphalt: summarizeSurface(asphalt),
    gravel: summarizeSurface(gravel),
    ground: {
      steadySpeedKmh: groundCruise.steadySpeedKmh,
      surfaceId: "ground"
    },
    roadCruise: {
      steadySpeedKmh: roadCruise.steadySpeedKmh,
      surfaceId: "road"
    }
  };

  const g4 = evaluateG4(surfaces.asphalt, surfaces.gravel);
  const g5Ratio = surfaces.roadCruise.steadySpeedKmh > 0
    ? surfaces.ground.steadySpeedKmh / surfaces.roadCruise.steadySpeedKmh
    : 0;
  const g5 = {
    ratio: Number(g5Ratio.toFixed(4)),
    passed: g5Ratio >= 0.75 && g5Ratio <= 0.92
  };
  const g6 = {
    asphaltRoadContactOk: asphalt.every((row) => row.roadContactRatio > 0.95),
    gravelRoadContactOk: gravel.every((row) => row.roadContactRatio > 0.95)
  };

  const report = {
    generatedAt: new Date().toISOString(),
    carId,
    surfaces,
    gates: { g4, g5, g6 }
  };
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = path.join(process.cwd(), "output", "racing-surface-matrix.p0-g4g5.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, reportBody);
  await testInfo.attach("racing-surface-matrix.p0-g4g5.json", {
    body: Buffer.from(reportBody),
    contentType: "application/json"
  });

  console.log(`G4/G5 surface matrix: ${JSON.stringify(report.gates)}`);
  expect(g4.passedSeparations).toBeGreaterThanOrEqual(2);
  expect(g5.passed).toBe(true);
  expect(g6.asphaltRoadContactOk).toBe(true);
  expect(g6.gravelRoadContactOk).toBe(true);
});

async function startProvingGround(page, selectedCarId) {
  await page.addInitScript(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
    }));
  });
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${selectedCarId}"]`).click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
}

async function runSurfaceProtocols(page, surfaceId) {
  expect(await page.evaluate((id) =>
    globalThis.__ackGamesDebug.racing.setProvingSurfaceOverride(id), surfaceId
  )).toBe(surfaceId === "road" ? "road" : surfaceId);

  const rows = [];
  for (const testId of ["zero-to-100", "100-to-zero", "fixed-steer"]) {
    expect(await page.evaluate((id) =>
      globalThis.__ackGamesDebug.racing.startProvingGroundTest(id), testId
    )).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      globalThis.__ackGamesDebug.racing.getState().provingGround.status
    ), { timeout: 45_000 }).toBe("completed");
    const proving = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
    rows.push({
      testId,
      zeroTo100Seconds: proving.zeroTo100Seconds ?? null,
      brakingDistanceMeters: proving.brakingDistanceMeters ?? null,
      maximumTireSlip: proving.maximumTireSlip ?? null,
      roadContactRatio: proving.roadContactRatio ?? 0,
      surfaceId
    });
  }
  return rows;
}

async function measureSteadyCruise(page, surfaceId) {
  expect(await page.evaluate((id) =>
    globalThis.__ackGamesDebug.racing.setProvingSurfaceOverride(id), surfaceId
  )).toBe(surfaceId);
  expect(await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.placeWorldScenario(-200, -60, Math.PI * 0.5)
  )).toBe(true);

  const softCapMps = await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().playerMaxForwardSpeed
  );
  // Seed just under the soft cap; hold throttle so terminal speed settles at the surface limit.
  expect(await page.evaluate((speedMps) => {
    const api = globalThis.__ackGamesDebug.racing;
    api.setShowcaseMatrixControls({ throttle: 1, brake: 0, steering: 0 });
    return api.setPlayerPlanarSpeed(speedMps * 0.97);
  }, softCapMps)).toBe(true);

  for (let step = 0; step < 80; step += 1) {
    await page.waitForTimeout(50);
  }
  const samples = [];
  for (let step = 0; step < 40; step += 1) {
    await page.waitForTimeout(50);
    const speedKmh = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh);
    samples.push(speedKmh);
  }
  await page.evaluate(() => globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls(null));
  const steadySpeedKmh = average(samples.slice(-20));
  return {
    surfaceId,
    steadySpeedKmh: Number(steadySpeedKmh.toFixed(2)),
    softCapKmh: Number((softCapMps * 3.6).toFixed(2))
  };
}

function summarizeSurface(rows) {
  const byId = Object.fromEntries(rows.map((row) => [row.testId, row]));
  return {
    zeroTo100Seconds: byId["zero-to-100"]?.zeroTo100Seconds ?? null,
    brakingDistanceMeters: byId["100-to-zero"]?.brakingDistanceMeters ?? null,
    maximumTireSlip: Math.max(
      byId["zero-to-100"]?.maximumTireSlip ?? 0,
      byId["100-to-zero"]?.maximumTireSlip ?? 0,
      byId["fixed-steer"]?.maximumTireSlip ?? 0
    ),
    roadContactRatioMin: Math.min(...rows.map((row) => row.roadContactRatio))
  };
}

function evaluateG4(asphalt, gravel) {
  const metrics = [
    {
      field: "zeroTo100Seconds",
      asphalt: asphalt.zeroTo100Seconds,
      gravel: gravel.zeroTo100Seconds,
      sameDirection: gravel.zeroTo100Seconds > asphalt.zeroTo100Seconds
    },
    {
      field: "brakingDistanceMeters",
      asphalt: asphalt.brakingDistanceMeters,
      gravel: gravel.brakingDistanceMeters,
      sameDirection: gravel.brakingDistanceMeters > asphalt.brakingDistanceMeters
    },
    {
      field: "maximumTireSlip",
      asphalt: asphalt.maximumTireSlip,
      gravel: gravel.maximumTireSlip,
      sameDirection: gravel.maximumTireSlip > asphalt.maximumTireSlip
    }
  ].map((metric) => {
    const base = Math.abs(metric.asphalt) > 1e-6 ? Math.abs(metric.asphalt) : 1e-6;
    const relative = Math.abs(metric.gravel - metric.asphalt) / base;
    return {
      ...metric,
      relativeDifference: Number(relative.toFixed(4)),
      passes: metric.sameDirection && relative >= 0.08
    };
  });
  return {
    metrics,
    passedSeparations: metrics.filter((metric) => metric.passes).length
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
