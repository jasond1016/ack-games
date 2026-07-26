const { test, expect } = require("@playwright/test");

test("racing start flow stays usable across selection, race start, pause, and re-entry", async ({ page }) => {
  await page.goto("/");

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });

  const carOptions = page.locator("#racingCarOptions .race-car-option");
  await expect.poll(async () => carOptions.count()).toBeGreaterThan(1);

  const lastCar = carOptions.last();
  await lastCar.scrollIntoViewIfNeeded();
  await lastCar.click();
  await expect(lastCar).toHaveClass(/is-selected/);

  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden();
  await expect(page.locator("#racingHudOverlay")).toBeVisible();

  await page.keyboard.press("Escape");
  const pauseOverlay = page.locator("#racingPauseOverlay");
  await expect(pauseOverlay).toBeVisible();

  const firstSeed = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().randomSeed);
  const historyLengthBeforeRestart = await page.evaluate(() => history.length);
  await page.locator("#racingPauseResetButton").click();
  await expect(startOverlay).toBeHidden();
  await expect(page.locator("#racingHudOverlay")).toBeVisible();
  const restartedSeed = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().randomSeed);
  expect(restartedSeed).toBe(firstSeed);
  await expect.poll(() => page.evaluate(() => history.length)).toBe(historyLengthBeforeRestart);

  await page.keyboard.press("Escape");
  await expect(pauseOverlay).toBeVisible();

  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.getElementById("racingSelectedCarPreview");
        const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        return gl ? gl.isContextLost() : null;
      })
    )
    .toBe(false);
});

test("nitro renders blue flames from every configured Veneno exhaust", async ({ page }) => {
  await page.goto("/");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="veneno"]').click();
  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden();

  await page.keyboard.down("KeyW");
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh)).toBeGreaterThan(8);
  await page.keyboard.press("Numpad0");
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().boostSeconds)).toBeGreaterThan(0);

  const flameStates = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().flameStates);
  await page.keyboard.up("KeyW");
  expect(flameStates).toHaveLength(12);
  expect(flameStates.every((flame) => flame.visible && flame.opacity > 0)).toBe(true);
  expect(new Set(flameStates.map((flame) => flame.layer))).toEqual(new Set(["outer", "core", "glow"]));
  expect(new Set(flameStates.map((flame) => flame.color))).toEqual(new Set(["#168cff", "#d9fbff", "#2f6bff"]));
  expect(new Set(flameStates.map((flame) => flame.exhaustPosition.join(","))).size).toBe(4);

  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().opponentBoostSeconds)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().opponentSpeedKmh)).toBeGreaterThan(180);
  const boostState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(boostState.playerBoostUnlimited).toBe(true);
  expect(boostState.boostCharges).toBe(5);
  expect(boostState.opponentBoostCharges).toBe(2);
  expect(boostState.opponentFlameStates).toHaveLength(6);
  expect(boostState.opponentFlameStates.every((flame) => flame.visible && flame.opacity > 0)).toBe(true);
});

test("free-drive traffic uses its own limited blue nitro", async ({ page }) => {
  await page.goto("/");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-island-freedrive"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden({ timeout: 45_000 });
  await expect(page.locator("#racingHudOverlay")).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().traffic.length), {
    timeout: 25_000
  }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().traffic.some((traffic) =>
      traffic.boostSeconds > 0 && traffic.boostCharges === 2 && traffic.boostVisible
    )
  )).toBe(true);

  const state = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(state.playerBoostUnlimited).toBe(true);
  expect(state.showcaseChallenge).toBeNull();
  expect(state.traffic.every((traffic) => traffic.boostCharges >= 0 && traffic.boostCharges <= 3)).toBe(true);
});

test("Coastal Showcase runs countdown, timed route, result, and in-place retry", async ({ page }) => {
  await page.goto("/");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#racingStartModeValue")).toHaveText("Festival Showcase");
  await expect(page.locator("#racingStartOpponentValue")).toHaveText("3 位 Festival 对手");
  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden({ timeout: 45_000 });

  const eventBanner = page.locator("#racingEventBanner");
  await expect(eventBanner).toBeVisible();
  const countdownStart = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return { position: state.playerPosition, speedKmh: state.speedKmh, opponents: state.showcaseEvent.opponents };
  });
  expect(countdownStart.opponents).toHaveLength(3);
  await page.keyboard.press("KeyH");
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().opponentEnabled)).toBe(false);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  const heldDuringCountdown = await page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return { position: state.playerPosition, speedKmh: state.speedKmh, boost: state.boostSeconds };
  });
  await page.keyboard.up("KeyW");
  expect(heldDuringCountdown.position).toEqual(countdownStart.position);
  expect(heldDuringCountdown.speedKmh).toBe(0);
  expect(heldDuringCountdown.boost).toBe(0);
  expect((await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().showcaseEvent.opponents))
    .map(({ distance }) => distance)).toEqual(countdownStart.opponents.map(({ distance }) => distance));
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  ), { timeout: 8_000 }).toBe("running");
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseChallenge.elapsedSeconds
  )).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() =>
    Math.max(...globalThis.__ackGamesDebug.racing.getState().showcaseEvent.opponents.map(({ distance }) => distance))
  )).toBeGreaterThan(Math.max(...countdownStart.opponents.map(({ distance }) => distance)));

  const beforeRecovery = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().showcaseChallenge.elapsedSeconds);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.recoverShowcaseScenario())).toBe(true);
  const recovered = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(recovered.showcaseEvent.phase).toBe("running");
  expect(recovered.showcaseEvent.recoveryCount).toBe(1);
  expect(recovered.showcaseChallenge.elapsedSeconds - beforeRecovery).toBeGreaterThanOrEqual(2.4);
  expect(Math.hypot(
    recovered.playerPosition.x - countdownStart.position.x,
    recovered.playerPosition.y - countdownStart.position.y
  )).toBeLessThan(3);
  expect(recovered.traffic.map(({ name }) => name)).toEqual(["RAVEN", "APEX", "VOLT"]);
  expect(recovered.traffic.every(({ labelVisible }) => labelVisible)).toBe(true);
  await expect(page.locator("#racingRouteGuide")).toBeVisible();
  await expect(page.locator("#racingRouteNotice")).toHaveText("RECOVERED +2.5S");
  await expect(page.locator("#racingRouteNotice")).toBeVisible();

  await page.waitForTimeout(2_200);
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.rollShowcaseScenario())).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.recoveryCount
  ), { timeout: 5_000 }).toBe(2);

  expect(await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.completeShowcaseEventScenario()
  )).toBe(true);
  const completedPresentation = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(completedPresentation.showcaseEvent.announcedSections).not.toContain("final");
  expect([completedPresentation.presentation.exposure, completedPresentation.presentation.jumpFovPulse,
    completedPresentation.presentation.jumpLiftPulse, completedPresentation.presentation.landingKick]
    .every(Number.isFinite)).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  ), { timeout: 5_000 }).toBe("result");
  await expect(page.locator("#racingResultOverlay")).toBeVisible();
  await expect(page.locator("#racingResultTitle")).toContainText("ISLAND TOUR");
  await expect(page.locator("#racingResultPlayerValue")).not.toHaveText("--");
  const finalPosition = Number(await page.locator("#racingFinishPlaceNumber").textContent());
  expect(finalPosition).toBeGreaterThanOrEqual(1);
  expect(finalPosition).toBeLessThanOrEqual(4);

  await page.locator("#racingPlayAgainButton").click();
  await expect(page.locator("#racingResultOverlay")).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  )).toBe("countdown");
  await expect(eventBanner).toBeVisible();
});

test("Coastal Showcase free-cruise skips the tour machine and remembers the choice", async ({ page }) => {
  await page.goto("/");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });

  const coastalModeRow = page.locator("#racingCoastalModeRow");
  await expect(coastalModeRow).toBeVisible();
  const islandTourButton = page.locator("#racingCoastalModeIslandTourButton");
  const freeCruiseButton = page.locator("#racingCoastalModeFreeCruiseButton");
  await expect(islandTourButton).toHaveClass(/is-selected/);
  await expect(page.locator("#racingStartModeValue")).toHaveText("Festival Showcase");

  await freeCruiseButton.click();
  await expect(freeCruiseButton).toHaveClass(/is-selected/);
  await expect(islandTourButton).not.toHaveClass(/is-selected/);
  await expect(page.locator("#racingStartModeValue")).toHaveText("Free Cruise");

  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden({ timeout: 45_000 });
  await expect(page.locator("#racingHudOverlay")).toBeVisible();

  const initialState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(initialState.startConfig.coastalPlayMode).toBe("free-cruise");
  expect(initialState.showcaseEvent).not.toBeNull();
  expect(initialState.showcaseEvent.phase).toBe("idle");

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  await expect.poll(() =>
    page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase)
  ).toBe("idle");
  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().speedKmh)).toBeGreaterThan(0);

  expect(await page.evaluate(() => globalThis.__ackGamesDebug.racing.activateBoost())).toBe(true);
  await expect.poll(() =>
    page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().boostSeconds)
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => {
    globalThis.__ackGamesDebug.racing.setNitroAudioPreset("jet-whoosh");
    return globalThis.__ackGamesDebug.racing.getNitroAudioPreset();
  })).toBe("jet-whoosh");

  await page.keyboard.press("F2");
  await expect.poll(() =>
    page.evaluate(() => {
      const state = globalThis.__ackGamesDebug.racing.getState();
      return state.collisionDebugEnabled && state.collisionDebugHudVisible;
    })
  ).toBe(true);
  await page.keyboard.press("F2");
  await expect.poll(() =>
    page.evaluate(() => {
      const state = globalThis.__ackGamesDebug.racing.getState();
      return !state.collisionDebugEnabled && !state.collisionDebugHudVisible;
    })
  ).toBe(true);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pauseOverlay = page.locator("#racingPauseOverlay");
  await expect(pauseOverlay).toBeVisible();
  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await expect(freeCruiseButton).toHaveClass(/is-selected/);
  await expect(page.locator("#racingStartModeValue")).toHaveText("Free Cruise");

  const storedConfig = await page.evaluate(
    () => JSON.parse(localStorage.getItem("ack-games:racing-start-config:v1"))
  );
  expect(storedConfig.coastalPlayMode).toBe("free-cruise");
  expect(storedConfig.version).toBe(4);
});

test("Coastal Tour difficulty persists and scales opponent cruise", async ({ page }) => {
  await page.goto("/");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#racingDifficultyRow")).toBeVisible();
  await expect(page.locator("#racingDifficultyStandardButton")).toHaveClass(/is-selected/);

  await page.locator("#racingDifficultyHardButton").click();
  await expect(page.locator("#racingDifficultyHardButton")).toHaveClass(/is-selected/);
  await page.locator("#racingStartRaceButton").click();
  await expect(startOverlay).toBeHidden({ timeout: 45_000 });

  const hardState = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(hardState.startConfig.difficulty).toBe("hard");
  expect(hardState.difficulty.profile.cruiseScale).toBeGreaterThan(1.2);
  const hardCruise = Math.max(...hardState.traffic.map((row) => row.cruiseSpeedKmh));
  expect(hardCruise).toBeGreaterThan(180);

  await page.keyboard.press("Escape");
  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#racingDifficultyHardButton")).toHaveClass(/is-selected/);

  const storedConfig = await page.evaluate(
    () => JSON.parse(localStorage.getItem("ack-games:racing-start-config:v1"))
  );
  expect(storedConfig.difficulty).toBe("hard");
  expect(storedConfig.version).toBe(4);
});

test("Urus clears both Showcase bridges at 88 km/h", async ({ page }) => {
  await page.goto("/?quality=low");
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-coastal-showcase"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
  await page.locator('#racingCarOptions .race-car-option[data-car-id="urus-se"]').click();
  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.getState().showcaseEvent.phase
  ), { timeout: 8_000 }).toBe("running");

  expect(await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.launchShowcaseBridgeScenario(88)
  )).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return state.playerPosition.x > 205
      && state.surface.contacts > 0
      && state.showcaseEvent.recoveryCount === 0;
  }), { timeout: 5_000 }).toBe(true);
  const landed = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(landed.showcaseEvent.recoveryCount).toBe(0);

  expect(await page.evaluate(() =>
    globalThis.__ackGamesDebug.racing.launchShowcaseBridgeScenario(88, -1)
  )).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return state.playerPosition.x < 175
      && state.surface.contacts > 0
      && state.showcaseEvent.recoveryCount === 0;
  }), { timeout: 8_000 }).toBe(true);
  const reverseLanded = await page.evaluate(() => globalThis.__ackGamesDebug.racing.getState());
  expect(reverseLanded.showcaseEvent.recoveryCount).toBe(0);
});

test("jsDelivr failure is isolated to racing and can be retried", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort("failed"));
  await page.goto("/");

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible();
  await page.locator("#racingMapSelectRaceButton").click();
  const lifecycleView = page.locator("#gameLifecycleView");
  await expect(lifecycleView).toBeVisible();
  await expect(lifecycleView).toHaveAttribute("data-state", "failed");
  await expect(page.locator("#gameLifecycleRetryButton")).toBeVisible();

  await page.unroute("https://cdn.jsdelivr.net/**");
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.locator("#gameLifecycleRetryButton").click()
  ]);
  await expect(page).toHaveURL(/#racing$/);

  await page.goto("/");
  await expect(page.locator("#homeView")).toBeVisible();
  await page.locator("#vacuumGameCard").click();
  await expect(page.locator("#vacuumView")).toBeVisible();
});

test("deep link opens the requested game without showing home", async ({ page }) => {
  await page.goto("/#vacuum");
  await expect(page.locator("#vacuumView")).toBeVisible();
  await expect(page.locator("#homeView")).toBeHidden();
  await expect(page).toHaveURL(/#vacuum$/);
});

test("editing a preset map creates a user-map copy before entering the editor", async ({ page }) => {
  await page.goto("/");

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });

  const presetCards = page.locator("#racingPresetMaps .map-select-card");
  await expect(presetCards.first()).toContainText("F1 练习场");
  await presetCards.first().locator(".map-select-card-button").click();
  await page.locator("#racingMapSelectEditButton").click();

  await expect(page.locator("#racingEditorView")).toBeVisible();
  await expect(page.locator("#racingEditorMapName")).toHaveValue(/F1 练习场 副本/);

  await page.locator("#racingEditorHomeButton").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#racingUserMaps .map-select-card").first()).toContainText("F1 练习场 副本");
});

test("dragging a control point keeps the editor preview in sync with the saved map", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const map = {
      version: 3,
      name: "拖拽回归地图",
      track: {
        shape: "open",
        surface: "asphalt",
        width: 14,
        samples: 240,
        controlPoints: [[0, 0], [30, 0], [60, 20], [90, 20]]
      }
    };
    localStorage.setItem("ack-games:racing-map-library-state:v1", JSON.stringify({
      version: 1,
      selectedMapId: "user-drag-regression",
      userEntries: [{
        mapId: "user-drag-regression",
        kind: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        map
      }]
    }));
  });

  await page.goto("/#racing-editor");
  await expect(page.locator("#racingEditorView")).toBeVisible();

  const selectedPoint = await page.locator("#racingEditorCanvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let totalX = 0;
    let totalY = 0;
    let count = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        if (pixels[offset] === 242 && pixels[offset + 1] === 183 && pixels[offset + 2] === 5) {
          totalX += x;
          totalY += y;
          count += 1;
        }
      }
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (totalX / count) * rect.width / canvas.width,
      y: rect.top + (totalY / count) * rect.height / canvas.height
    };
  });
  await page.mouse.move(selectedPoint.x, selectedPoint.y);
  await page.mouse.down();
  await page.mouse.move(selectedPoint.x + 24, selectedPoint.y, { steps: 4 });
  await page.mouse.up();

  const previewMap = JSON.parse(await page.locator("#racingEditorJsonValue").inputValue());
  const savedMap = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ack-games:racing-map-library-state:v1"));
    return state.userEntries.find((entry) => entry.mapId === state.selectedMapId).map;
  });
  expect(previewMap.track.controlPoints[0]).not.toEqual([0, 0]);
  expect(savedMap.track.controlPoints[0]).toEqual(previewMap.track.controlPoints[0]);
  expect(pageErrors).toEqual([]);
  await expect(page.locator("#racingEditorStatusValue")).toHaveText("已更新路线。");
});

test("legacy racing map keys migrate atomically to one library state", async ({ page }) => {
  await page.addInitScript(() => {
    const map = {
      version: 3,
      name: "旧版用户地图",
      track: {
        shape: "open",
        surface: "asphalt",
        width: 14,
        samples: 240,
        controlPoints: [[0, 0], [20, 0]]
      }
    };
    localStorage.setItem("ack-games:racing-map-library:v1", JSON.stringify([{
      mapId: "legacy-user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      map
    }]));
    localStorage.setItem("ack-games:racing-selected-map-id:v1", "legacy-user");
  });

  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#racingMapSelectName")).toHaveText("旧版用户地图");
  const storageState = await page.evaluate(() => ({
    current: JSON.parse(localStorage.getItem("ack-games:racing-map-library-state:v1")),
    oldLibrary: localStorage.getItem("ack-games:racing-map-library:v1"),
    oldSelection: localStorage.getItem("ack-games:racing-selected-map-id:v1")
  }));
  expect(storageState.current.selectedMapId).toBe("legacy-user");
  expect(storageState.current.userEntries).toHaveLength(1);
  expect(storageState.oldLibrary).toBeNull();
  expect(storageState.oldSelection).toBeNull();
});
