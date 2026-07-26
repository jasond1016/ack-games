const { test, expect } = require("@playwright/test");

const carIds = ["revuelto", "aventador", "veneno", "huracan-sto"];

test.setTimeout(90_000);

for (const carId of carIds) {
  test(`${carId} wheel roles, hubs and animation axes stay bounded`, async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ack-games:racing-challenge-unlocks:v1", JSON.stringify({
        unlockedCarIds: ["bolide", "veneno", "centodieci", "dbr9"]
      }));
    });
    await page.goto("/?quality=low#racing-select");
    await expect(page.locator("#racingMapSelectView")).toBeVisible({ timeout: 25_000 });
    await page.locator(
      '#racingPresetMaps .map-select-card[data-map-id="preset-proving-ground"] .map-select-card-button'
    ).click();
    await page.locator("#racingMapSelectRaceButton").click();
    await expect(page.locator("#racingStartOverlay")).toBeVisible({ timeout: 25_000 });
    await page.locator(`#racingCarOptions .race-car-option[data-car-id="${carId}"]`).click();
    await page.locator("#racingStartRaceButton").click();
    await expect(page.locator("#racingStartOverlay")).toBeHidden({ timeout: 60_000 });

    const initial = await page.evaluate(() =>
      globalThis.__ackGamesDebug.racing.diagnoseWheelVisuals()
    );
    expect(initial.wheelCount).toBe(4);
    expect(initial.shaderBindings).toBeGreaterThan(0);
    expect(initial.layouts.length).toBeGreaterThan(0);
    for (const layout of initial.layouts) {
      expect(layout.radiusLimit).toBeGreaterThanOrEqual(0.55);
    }
    for (const binding of initial.bindings) {
      expect(["x", "y", "z"]).toContain(binding.rollAxis);
      expect(["x", "y", "z"]).toContain(binding.steerAxis);
      expect(binding.rollAxis).not.toBe(binding.steerAxis);
      expect(binding.radiusLimit).toBeGreaterThanOrEqual(0.55);
      expect(binding.radiusLimit).toBeLessThan(2.5);
    }

    if (carId === "revuelto") {
      expect(initial.bindings.map(({ role }) => role).sort()).toEqual(
        ["caliper", "hub", "rim", "rotor", "tire"]
      );
      expect(initial.bindings.every(({ canonicalHubs }) => canonicalHubs)).toBe(true);
      expect(initial.bindings.every(({ rollAxis }) => rollAxis === "y")).toBe(true);
      expect(initial.bindings.every(({ steerAxis }) => steerAxis === "z")).toBe(true);
      expect(initial.bindings.find(({ role }) => role === "caliper")).toMatchObject({
        rollEnabled: false,
        spinAngle: 0
      });
      for (const binding of initial.bindings) {
        expect(binding.frontFlags.filter(Boolean)).toHaveLength(2);
        expect(binding.frontFlags.filter((flag) => !flag)).toHaveLength(2);
      }

      await page.evaluate(() => globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls({
        throttle: 0.55,
        brake: 0,
        steering: 0
      }));
      await expect.poll(() => page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.getState().speedKmh
      ), { timeout: 20_000 }).toBeGreaterThan(15);
      const straight = await page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.diagnoseWheelVisuals()
      );
      expect(straight.bindings.every(({ steeringAngle }) => steeringAngle === 0)).toBe(true);
      expect(straight.bindings.find(({ role }) => role === "caliper").spinAngle).toBe(0);

      await page.evaluate(() => globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls({
        throttle: 0.15,
        brake: 0,
        steering: -0.65
      }));
      await expect.poll(() => page.evaluate(() =>
        Math.abs(globalThis.__ackGamesDebug.racing.getState().vehiclePhysics.steeringDegrees)
      )).toBeGreaterThan(3);
      const steered = await page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.diagnoseWheelVisuals()
      );
      expect(steered.bindings.every(({ steeringAngle }) => Math.abs(steeringAngle) > 0.03)).toBe(true);
      expect(steered.bindings.find(({ role }) => role === "caliper").spinAngle).toBe(0);
      await page.evaluate(() =>
        globalThis.__ackGamesDebug.racing.setShowcaseMatrixControls(null)
      );
    }

    expect(pageErrors).toEqual([]);
  });
}
