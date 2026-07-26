const { test, expect } = require("@playwright/test");

/** Open classic map-select flow (editor / non-lobby entry). */
async function openRacingMapSelect(page) {
  await page.goto("/#racing-select");
  await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
}

/** #22 lobby path: home → Coastal free-cruise (no map select / start overlay). */
async function enterCoastalFreeCruiseFromLobby(page) {
  await page.goto("/");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await page.locator("#gameLifecycleEnterButton").click();
  await expect(page.locator("#racingHudOverlay")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#racingMapSelectView")).toBeHidden();
  await expect(page.locator("#racingStartOverlay")).toBeHidden();
}

module.exports = {
  openRacingMapSelect,
  enterCoastalFreeCruiseFromLobby
};
