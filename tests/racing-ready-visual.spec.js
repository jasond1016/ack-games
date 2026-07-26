const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const enabled = process.env.RACING_READY_VISUAL === "1";
test.skip(!enabled, "run explicitly with RACING_READY_VISUAL=1");
test.setTimeout(120_000);

test("archives ready-cover screenshots and responsive asset evidence", async ({ browser }, testInfo) => {
  const outputDir = path.join(process.cwd(), "output", "racing-ready-visual");
  fs.mkdirSync(outputDir, { recursive: true });
  const reports = [];
  for (const viewport of [
    { id: "wide-1440x900", width: 1440, height: 900 },
    { id: "classic-1024x768", width: 1024, height: 768 },
    { id: "mobile-390x844", width: 390, height: 844, isMobile: true, hasTouch: true }
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: Boolean(viewport.isMobile),
      hasTouch: Boolean(viewport.hasTouch)
    });
    const page = await context.newPage();
    await page.goto("/?quality=low");
    await page.locator("#racingGameCard").click();
    const loadingCover = await (await page.waitForFunction(() => {
      const view = document.getElementById("gameLifecycleView");
      const image = document.getElementById("gameLifecycleBackdropImage");
      return view?.dataset.state === "loading" && image?.getAttribute("src")
        ? { state: view.dataset.state, fallbackSrc: image.getAttribute("src"), source: image.currentSrc }
        : null;
    })).jsonValue();
    expect(loadingCover.state).toBe("loading");
    expect(loadingCover.fallbackSrc).toContain("/assets/racing/ready/");
    await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await expect(page.locator("#gameLifecycleView")).toHaveAttribute("data-racing-backdrop", "loaded", { timeout: 15_000 });
    await page.waitForFunction(() => {
      const view = document.getElementById("gameLifecycleView");
      const backdrop = document.getElementById("gameLifecycleBackdrop");
      const image = document.getElementById("gameLifecycleBackdropImage");
      if (!view || !backdrop || !image) return false;
      return image.naturalWidth > 0
        && image.currentSrc.includes("/assets/racing/ready/")
        && Number.parseFloat(getComputedStyle(backdrop).opacity) >= 0.99
        && Number.parseFloat(getComputedStyle(image).opacity) >= 0.99;
    }, null, { timeout: 5_000 });
    const screenshotPath = path.join(outputDir, `${viewport.id}.png`);
    await page.screenshot({ path: screenshotPath });
    const metrics = await page.evaluate(() => {
      const rect = document.getElementById("gameLifecycleEnterButton").getBoundingClientRect();
      const loadingMediaNodes = document.getElementById("gameLifecycleView")
        .querySelectorAll("video,audio,iframe,canvas").length;
      const backdrop = document.getElementById("gameLifecycleBackdrop");
      const image = document.getElementById("gameLifecycleBackdropImage");
      const resources = performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/assets/racing/ready/"))
        .map((entry) => ({ name: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize }));
      return {
        button: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        buttonInsideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        backdrop: {
          currentSrc: image.currentSrc,
          naturalWidth: image.naturalWidth,
          opacity: Number.parseFloat(getComputedStyle(image).opacity),
          containerOpacity: Number.parseFloat(getComputedStyle(backdrop).opacity)
        },
        loadingMediaNodes,
        resources
      };
    });
    reports.push({ viewport, loadingCover, ...metrics });
    expect(metrics.buttonInsideViewport).toBe(true);
    expect(metrics.loadingMediaNodes).toBe(0);
    expect(metrics.backdrop.currentSrc).toContain("/assets/racing/ready/");
    expect(metrics.backdrop.naturalWidth).toBeGreaterThan(0);
    expect(metrics.backdrop.opacity).toBeGreaterThanOrEqual(0.99);
    expect(metrics.backdrop.containerOpacity).toBeGreaterThanOrEqual(0.99);
    await context.close();
  }
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(reports, null, 2)}\n`);
  await testInfo.attach("racing-ready-visual-report.json", { body: Buffer.from(JSON.stringify(reports, null, 2)), contentType: "application/json" });
});
