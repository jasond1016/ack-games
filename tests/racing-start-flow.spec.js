const { test, expect } = require("@playwright/test");

test("racing start flow stays usable across selection, race start, pause, and re-entry", async ({ page }) => {
  await page.goto("/");

  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
  await page.locator("#racingMapSelectRaceButton").click();

  const startOverlay = page.locator("#racingStartOverlay");
  await expect(startOverlay).toBeVisible();

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
  await expect(startOverlay).toBeVisible();

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
  const lifecycleView = page.locator("#gameLifecycleView");
  await expect(lifecycleView).toBeVisible();
  await expect(lifecycleView).toHaveAttribute("data-state", "failed");
  await expect(page.locator("#gameLifecycleRetryButton")).toBeVisible();

  await page.unroute("https://cdn.jsdelivr.net/**");
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.locator("#gameLifecycleRetryButton").click()
  ]);
  await expect(page).toHaveURL(/#racing-select$/);

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
