const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

async function enterLobbyCruise(page) {
  await page.goto("/?quality=low");
  await page.locator("#racingGameCard").click();
  await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  await page.keyboard.press("Enter");
  await expect(page.locator("#gameLifecycleView")).toBeHidden({ timeout: 15_000 });
}

async function captureLayout(page) {
  return page.evaluate(() => {
    const state = globalThis.__ackGamesDebug.racing.getState();
    return { layout: state.render.layout, camera: state.camera };
  });
}

function expectSynchronized({ layout }) {
  expect(layout.cameraAspect).toBeCloseTo(layout.cssWidth / layout.cssHeight, 5);
  expect(layout.bufferWidth).toBeCloseTo(layout.cssWidth * layout.devicePixelRatio, 0);
  expect(layout.bufferHeight).toBeCloseTo(layout.cssHeight * layout.devicePixelRatio, 0);
}

function expectSameComposition(left, right) {
  expect(right.layout.cssWidth).toBeCloseTo(left.layout.cssWidth, 0);
  expect(right.layout.cssHeight).toBeCloseTo(left.layout.cssHeight, 0);
  expect(right.layout.cameraAspect).toBeCloseTo(left.layout.cameraAspect, 5);
  expect(right.layout.cameraFov).toBeCloseTo(left.layout.cameraFov, 1);
}

test("100% direct entry matches the 90% to 100% renderer/camera composition", async ({ page }, testInfo) => {
  const outputDir = path.join(process.cwd(), "output", "racing-viewport-layout");
  fs.mkdirSync(outputDir, { recursive: true });
  await enterLobbyCruise(page);
  const direct = await captureLayout(page);
  expectSynchronized(direct);
  await page.screenshot({ path: path.join(outputDir, "direct-100.png") });

  const stageResizeCount = direct.layout.resizeSyncCount;
  await page.evaluate(() => { document.getElementById("racingView").style.width = "calc(100% - 80px)"; });
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().render.layout.resizeSyncCount))
    .toBeGreaterThan(stageResizeCount);
  const observerResize = await captureLayout(page);
  expectSynchronized(observerResize);
  expect(observerResize.layout.resizeSources.observer).toBeGreaterThan(direct.layout.resizeSources.observer);
  await page.evaluate(() => { document.getElementById("racingView").style.width = ""; });
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().render.layout.cssWidth))
    .toBeCloseTo(direct.layout.cssWidth, 0);

  const windowResizeCount = (await captureLayout(page)).layout.resizeSyncCount;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().render.layout.resizeSyncCount))
    .toBeGreaterThan(windowResizeCount);
  const reducedZoomShape = await captureLayout(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.evaluate(() => globalThis.__ackGamesDebug.racing.getState().render.layout.viewportWidth))
    .toBe(1440);
  const restored = await captureLayout(page);
  await page.screenshot({ path: path.join(outputDir, "after-90-100.png") });

  [direct, reducedZoomShape, restored].forEach(expectSynchronized);
  expect(restored.layout.resizeSources.window).toBeGreaterThan(direct.layout.resizeSources.window);
  expect(restored.layout.resizeSources["visual-viewport"]).toBeGreaterThan(direct.layout.resizeSources["visual-viewport"]);
  expectSameComposition(direct, restored);
  const report = { direct, reducedZoomShape, restored };
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach("racing-viewport-layout.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json"
  });
});

test("first entry keeps 16:9, 4:3, and mobile canvas projection synchronized", async ({ browser }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844, isMobile: true, hasTouch: true }
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: Boolean(viewport.isMobile),
      hasTouch: Boolean(viewport.hasTouch)
    });
    const page = await context.newPage();
    await enterLobbyCruise(page);
    expectSynchronized(await captureLayout(page));
    await context.close();
  }
});
