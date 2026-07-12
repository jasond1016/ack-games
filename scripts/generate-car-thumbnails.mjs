import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GAME_BASE_URL ?? "http://127.0.0.1:4173";
const outputDir = path.resolve("assets/car-thumbnails");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.error(`[browser:error] ${error.message}`));
  await page.goto(baseUrl);
  await page.locator("#racingGameCard").click();
  await page.locator("#racingMapSelectRaceButton").click();
  const buttons = page.locator("#racingCarOptions .race-car-option");
  const canvas = page.locator("#racingSelectedCarPreview");
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const carId = await button.getAttribute("data-car-id");
    await button.scrollIntoViewIfNeeded();
    await button.click();
    // A local GLB is normally ready in under a second; the larger production
    // models need extra decode/upload time before the preview frame is stable.
    await page.waitForTimeout(4_000);
    const png = await canvas.screenshot({ type: "png" });
    const converted = await page.evaluate(async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const targetWidth = 640;
      const targetHeight = 360;
      const output = new OffscreenCanvas(targetWidth, targetHeight);
      output.getContext("2d").drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const webp = await output.convertToBlob({ type: "image/webp", quality: 0.82 });
      return Array.from(new Uint8Array(await webp.arrayBuffer()));
    }, [...png]);
    await writeFile(path.join(outputDir, `${carId}.webp`), Buffer.from(converted));
    console.log(`Generated ${carId}.webp`);
  }
} finally {
  await browser.close();
}
