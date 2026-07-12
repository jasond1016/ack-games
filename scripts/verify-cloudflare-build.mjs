import { chromium } from "playwright";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const pagesDir = path.resolve("_deploy/pages");
async function findGlbs(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findGlbs(target));
    else if (entry.name.toLowerCase().endsWith(".glb")) matches.push(target);
  }
  return matches;
}
const pageGlbs = await findGlbs(pagesDir);
if (pageGlbs.length) throw new Error(`Pages output contains GLBs:\n${pageGlbs.join("\n")}`);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") failures.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.url().includes(".glb") && !response.ok()) failures.push(`${response.url()}: HTTP ${response.status()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().startsWith("Failed to load")) failures.push(message.text());
  });
  await page.goto("http://127.0.0.1:4173/_deploy/pages/");
  await page.locator("#racingGameCard").click();
  await page.locator("#racingMapSelectRaceButton").click();
  await page.locator("#racingCarOptions .race-car-option").last().click();
  await page.waitForTimeout(3_000);
  await page.locator("#racingStartRaceButton").click();
  await page.waitForTimeout(3_000);
  if (failures.length) throw new Error(`Cloudflare build load failures:\n${failures.join("\n")}`);
  console.log("Verified Pages split and optimized preview/race GLB loading.");
} finally {
  await browser.close();
}
