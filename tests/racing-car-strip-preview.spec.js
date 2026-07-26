const { test, expect } = require("@playwright/test");
const { openRacingMapSelect } = require("./racing-test-helpers");

async function openStartOverlay(page) {
  await openRacingMapSelect(page);
  await page.locator("#racingMapSelectRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
}

test("P0–P5 car strip uses prebaked thumbnails at ≥2× with no WebGL bake", async ({ page }) => {
  await openStartOverlay(page);

  const options = page.locator("#racingCarOptions .race-car-option");
  await expect.poll(async () => options.count()).toBeGreaterThan(1);

  const thumbs = page.locator("#racingCarOptions .race-car-strip-thumb");
  await expect.poll(async () => thumbs.count()).toBe(await options.count());
  // P0/P1: every slot is an <img> with a non-empty src (prebaked), no strip canvas.
  await expect(page.locator("#racingCarOptions .race-car-strip-canvas")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const images = [...document.querySelectorAll("#racingCarOptions .race-car-strip-thumb")];
        return images.length > 0 && images.every((img) => Boolean(img.getAttribute("src")));
      })
    )
    .toBe(true);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const strip = globalThis.__ackGamesDebug.racing.getState().carStripPreview;
        return (
          strip
          && strip.usesPrebakedFrames === true
          && strip.sharedRenderer === false
          && strip.activeDraws === 0
          && strip.cameraYawDegrees === 45
          && strip.optionWidthPx >= 264
          && strip.optionHeightPx >= 192
          && typeof strip.strategy === "string"
          && strip.strategy.includes("prebaked")
        );
      })
    )
    .toBe(true);

  // P2: computed box ≥ 264×192.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selected = document.querySelector("#racingCarOptions .race-car-option.is-selected");
        if (!selected) return null;
        const rect = selected.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      })
    )
    .toEqual(expect.objectContaining({
      width: expect.any(Number),
      height: expect.any(Number)
    }));

  const size = await page.evaluate(() => {
    const selected = document.querySelector("#racingCarOptions .race-car-option.is-selected");
    const rect = selected.getBoundingClientRect();
    // Selected uses scale(1.1); compare unscaled layout size via offsetWidth/Height.
    return { width: selected.offsetWidth, height: selected.offsetHeight };
  });
  expect(size.width).toBeGreaterThanOrEqual(264);
  expect(size.height).toBeGreaterThanOrEqual(192);

  // P4: no borders / box-shadow on selected.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selected = document.querySelector("#racingCarOptions .race-car-option.is-selected");
        const style = getComputedStyle(selected);
        return {
          borderWidth: style.borderTopWidth,
          borderStyle: style.borderTopStyle,
          boxShadow: style.boxShadow
        };
      })
    )
    .toMatchObject({
      borderWidth: "0px",
      borderStyle: "none",
      boxShadow: "none"
    });

  // P3: horizontal scroll when strip overflows; click + stage sync.
  const scrollable = await page.evaluate(() => {
    const grid = document.getElementById("racingCarOptions");
    return grid.scrollWidth > grid.clientWidth + 8;
  });
  expect(scrollable).toBe(true);

  const lastUnlocked = page.locator("#racingCarOptions .race-car-option:not(.is-locked)").last();
  const lastId = await lastUnlocked.getAttribute("data-car-id");
  await lastUnlocked.click();
  await expect(lastUnlocked).toHaveClass(/is-selected/);
  await expect(lastUnlocked).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().startConfig?.playerCarId)
    )
    .toBe(lastId);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const grid = document.getElementById("racingCarOptions");
        return grid.scrollLeft > 0;
      })
    )
    .toBe(true);

  // P4: locked cars stay disabled.
  const locked = page.locator("#racingCarOptions .race-car-option.is-locked").first();
  if ((await locked.count()) > 0) {
    await expect(locked).toBeDisabled();
  }

  await page.locator("#racingStartRaceButton").click();
  await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 45_000 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const strip = globalThis.__ackGamesDebug.racing.getState().carStripPreview;
        return strip && strip.activeDraws === 0 && strip.entryCount === 0 && strip.sharedRenderer === false;
      })
    )
    .toBe(true);

  // P5: #23 F2 still works.
  await page.locator("#racingCanvas").click({ force: true });
  await page.keyboard.press("F2");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = globalThis.__ackGamesDebug.racing.getState();
        return state.collisionDebugEnabled && state.collisionDebugHudVisible;
      })
    )
    .toBe(true);
});
