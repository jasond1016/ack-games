const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_MATRIX === "1";
const carIds = (process.env.RACING_MATRIX_CARS || "veneno")
  .split(",")
  .map((carId) => carId.trim())
  .filter(Boolean);
const showcaseOnly = process.env.RACING_MATRIX_SHOWCASE_ONLY === "1";
const showcaseTimeoutMs = Number(process.env.RACING_MATRIX_SHOWCASE_TIMEOUT_MS || 210_000);

test.skip(!enabled, "run explicitly with pnpm run test:e2e:matrix");
test.setTimeout(carIds.length * (showcaseTimeoutMs + 60_000) + 30_000);

test("builds a real-Rapier vehicle dynamics comparison matrix", async ({ page }, testInfo) => {
  const cars = [];

  for (const carId of carIds) {
    await startProvingGround(page, carId);
    const initialState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
    const protocols = {};

    for (const testId of showcaseOnly ? [] : ["zero-to-100", "100-to-zero", "skidpad", "fixed-steer"]) {
      expect(await page.evaluate((id) => globalThis.__ackGamesDebug.racing.startProvingGroundTest(id), testId)).toBe(true);
      await expect.poll(() => page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.getState().provingGround.status
      ), { timeout: 30_000 }).toBe("completed");
      protocols[testId] = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().provingGround);
      expect(protocols[testId].roadContactRatio).toBeGreaterThan(0.95);
    }

    await startShowcase(page, carId);
    const showcase = await driveShowcase(page);
    console.log(`${carId} Showcase: ${JSON.stringify(showcase)}`);

    const radiusErrorMeters = protocols.skidpad
      ? Number((protocols.skidpad.averageRadiusMeters - 30).toFixed(3)) : null;
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
      accelerationDiagnostics: protocols["zero-to-100"]
        ? summarizeAccelerationTrace(protocols["zero-to-100"], drivetrainConfig) : null,
      handlingDiagnostics: protocols["fixed-steer"] ? summarizeFixedSteer(protocols["fixed-steer"]) : null,
      radiusErrorMeters,
      radiusTracking: radiusErrorMeters === null
        ? null : radiusErrorMeters > 1 ? "outside" : radiusErrorMeters < -1 ? "inside" : "on-target",
      showcase,
      protocols
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environments: ["preset-proving-ground", "preset-coastal-showcase"],
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
  expect(cars.every(({ showcase }) => showcase.passed), JSON.stringify(
    cars.map(({ carId, showcase }) => ({ carId, showcase })), null, 2
  )).toBe(true);
});

async function startProvingGround(page, carId) {
  await page.addInitScript(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
    }));
  });
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
}

async function startShowcase(page, carId) {
  await page.addInitScript(() => {
    localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
      unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
    }));
  });
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  ), { timeout: 8_000 }).toBe("running");
}

async function driveShowcase(page) {
  const route = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getShowcaseDrivingLine());
  const sections = new Set();
  let maximumSpeedKmh = 0;
  let maximumRecoveryCount = 0;
  const trace = [];
  let nextTraceAt = 0;
  let furthestDistance = 0;
  let lastProgressAt = Date.now();
  const initialBoostCharges = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().boostCharges);
  const deadline = Date.now() + showcaseTimeoutMs;

  try {
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
      if (state.showcaseEvent.phase === "settling" || state.showcaseEvent.phase === "result") {
        return summarizeShowcase(state, "completed");
      }
      sections.add(state.showcaseEvent.currentSection);
      maximumSpeedKmh = Math.max(maximumSpeedKmh, state.speedKmh);
      maximumRecoveryCount = Math.max(maximumRecoveryCount, state.showcaseEvent.recoveryCount);
      if (state.showcaseChallenge.elapsedSeconds >= nextTraceAt) {
        trace.push({
          elapsedSeconds: state.showcaseChallenge.elapsedSeconds,
          distance: state.showcaseEvent.playerDistance,
          checkpoint: state.showcaseChallenge.nextCheckpoint,
          position: state.playerPosition,
          speedKmh: state.speedKmh,
          heading: state.playerHeading,
          recoveryCount: state.showcaseEvent.recoveryCount
        });
        nextTraceAt += 5;
      }
      if (state.showcaseEvent.playerDistance >= furthestDistance + 5) {
        furthestDistance = state.showcaseEvent.playerDistance;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt >= 15_000) {
        return summarizeShowcase(state, "blocked");
      }
      const controls = showcaseControls(route, state);
      expect(await page.evaluate((next) =>
        globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls(next), controls
      )).toBe(true);
      await page.waitForTimeout(50);
    }
  } finally {
    await page.evaluate(() => globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls(null));
  }

  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  return {
    ...summarizeShowcase(state, "timeout"),
    sections: [...sections],
    maximumSpeedKmh,
    recoveryCount: maximumRecoveryCount,
    boostChargesUsed: initialBoostCharges - state.boostCharges
  };

  function summarizeShowcase(state, status) {
    const sectionsDriven = [...sections];
    const passed = status === "completed"
      && state.showcaseChallenge.nextCheckpoint === state.showcaseChallenge.checkpointCount
      && state.showcaseChallenge.elapsedSeconds >= 105
      && state.showcaseChallenge.elapsedSeconds <= 135
      && initialBoostCharges === state.boostCharges
      && ["road", "tunnel"].every((section) => sectionsDriven.includes(section))
      && !sectionsDriven.includes("rally");
    return {
      status,
      passed,
      phase: state.showcaseEvent.phase,
      elapsedSeconds: state.showcaseChallenge.elapsedSeconds,
      nextCheckpoint: state.showcaseChallenge.nextCheckpoint,
      checkpointCount: state.showcaseChallenge.checkpointCount,
      finalPlace: state.showcaseEvent.playerPlace,
      sections: sectionsDriven,
      maximumSpeedKmh,
      recoveryCount: Math.max(maximumRecoveryCount, state.showcaseEvent.recoveryCount),
      boostChargesUsed: initialBoostCharges - state.boostCharges,
      trace
    };
  }
}

function showcaseControls(route, state) {
  const speedMps = state.speedKmh / 3.6;
  const distance = state.showcaseEvent.playerDistance;
  const target = sampleRoute(route, distance + Math.max(10, Math.min(30, 8 + speedMps * 0.65)));
  const lookAhead = sampleRoute(route, distance + Math.max(24, speedMps * 1.4));
  let desiredHeading = Math.atan2(
    target.x - state.playerPosition.x,
    target.z - state.playerPosition.y
  );
  const bridgeEntry = state.playerPosition.x > 70
    && state.playerPosition.x <= 155
    && state.playerPosition.y < -8;
  const bridgeApproach = state.playerPosition.x > 155
    && state.playerPosition.x < 245
    && state.playerPosition.y < -8;
  const reverseBridgeEntry = state.playerPosition.x > 220
    && state.playerPosition.x < 320
    && state.playerPosition.y > 8
    && state.playerPosition.y < 80;
  const reverseBridgeApproach = state.playerPosition.x > 135
    && state.playerPosition.x <= 220
    && state.playerPosition.y > 8
    && state.playerPosition.y < 80;
  if (bridgeApproach && state.playerPosition.x < 202) {
    desiredHeading = Math.atan2(212 - state.playerPosition.x, -18 - state.playerPosition.y);
  }
  if (reverseBridgeApproach && state.playerPosition.x > 178) {
    desiredHeading = Math.atan2(168 - state.playerPosition.x, 18 - state.playerPosition.y);
  }
  const headingError = angleDelta(state.playerHeading, desiredHeading);
  const routeTurn = Math.abs(angleDelta(target.heading, lookAhead.heading));
  let targetSpeedKmh = target.section === "rally" ? 55 : target.section === "tunnel" ? 82 : 108;
  if (routeTurn > 0.75) targetSpeedKmh = Math.min(targetSpeedKmh, 38);
  else if (routeTurn > 0.45) targetSpeedKmh = Math.min(targetSpeedKmh, 52);
  else if (routeTurn > 0.25) targetSpeedKmh = Math.min(targetSpeedKmh, 72);
  if (Math.abs(headingError) > 0.65) targetSpeedKmh = Math.min(targetSpeedKmh, 32);
  else if (Math.abs(headingError) > 0.35) targetSpeedKmh = Math.min(targetSpeedKmh, 50);
  if (bridgeEntry) targetSpeedKmh = 100;
  if (bridgeApproach) targetSpeedKmh = 100;
  if (reverseBridgeEntry || reverseBridgeApproach) targetSpeedKmh = 100;
  const steering = Math.max(-1, Math.min(1, headingError * 1.9));
  return {
    throttle: state.speedKmh < targetSpeedKmh - 2 ? 1 : 0,
    brake: state.speedKmh > targetSpeedKmh + 5 ? Math.min(1, (state.speedKmh - targetSpeedKmh) / 18) : 0,
    steering
  };
}

function sampleRoute(route, requestedDistance) {
  const distance = Math.max(0, Math.min(route.at(-1).distance, requestedDistance));
  let low = 0;
  let high = route.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (route[middle].distance <= distance) low = middle;
    else high = middle;
  }
  const start = route[low];
  const end = route[high];
  const ratio = (distance - start.distance) / Math.max(0.001, end.distance - start.distance);
  return {
    x: start.x + (end.x - start.x) * ratio,
    z: start.z + (end.z - start.z) * ratio,
    heading: start.heading + angleDelta(start.heading, end.heading) * ratio,
    section: ratio < 0.5 ? start.section : end.section
  };
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
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
