const { test, expect } = require("@playwright/test");

test("racing start flow stays usable across selection, race start, pause, and re-entry", async ({ page }) => {
  await page.goto("/");

  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible();
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

  await page.locator("#racingPauseHomeButton").click();
  await expect(page.locator("#homeView")).toBeVisible();

  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible();
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

test("editing a preset map creates a user-map copy before entering the editor", async ({ page }) => {
  await page.goto("/");

  await page.locator("#racingGameCard").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible();

  const presetCards = page.locator("#racingPresetMaps .map-select-card");
  await expect(presetCards.first()).toContainText("F1 练习场");
  await presetCards.first().locator(".map-select-card-button").click();
  await page.locator("#racingMapSelectEditButton").click();

  await expect(page.locator("#racingEditorView")).toBeVisible();
  await expect(page.locator("#racingEditorMapName")).toHaveValue(/F1 练习场 副本/);

  await page.locator("#racingEditorHomeButton").click();
  await expect(page.locator("#racingMapSelectView")).toBeVisible();
  await expect(page.locator("#racingUserMaps .map-select-card").first()).toContainText("F1 练习场 副本");
});
