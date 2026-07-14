const { test, expect } = require("@playwright/test");

test("racing start flow stays usable across selection, race start, pause, and re-entry", async ({ page }) => {
  await page.goto("/");

  await page.locator("#racingGameCard").click();
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

  await page.locator("#racingGameCard").click();
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

test("jsDelivr failure is isolated to racing and can be retried", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort("failed"));
  await page.goto("/");

  await page.locator("#racingGameCard").click();
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

  await page.locator("#racingGameCard").click();
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
