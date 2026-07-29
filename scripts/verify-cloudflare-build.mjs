import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";
import { createCloudflareAssetGraph, createCloudflareBuildPlan } from "./cloudflare-asset-graph.mjs";

const pagesDir = path.resolve("_deploy/pages");
const r2Dir = path.resolve("_deploy/r2");
const pagesUrl = process.env.PAGES_VERIFY_URL ?? "http://127.0.0.1:4173/_deploy/pages/";
const assetGraph = createCloudflareAssetGraph(racingCarCatalog);
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
const unexpectedPageGlbs = pageGlbs.filter((file) =>
  !["assets/freedrive/models/", "assets/tennis/models/"].some((directory) =>
    path.relative(pagesDir, file).replaceAll("\\", "/").startsWith(directory)
  )
);
if (unexpectedPageGlbs.length) throw new Error(`Pages output contains unexpected GLBs:\n${unexpectedPageGlbs.join("\n")}`);
await verifyPagesAllowlist();
await verifyLocalReferences();
await verifyFreeDriveAssets();
await verifyR2Manifest();

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
    if (
      (message.type() === "warning" && message.text().startsWith("Failed to load"))
      || (message.type() === "error" && message.text().includes("Failed to start racing session"))
    ) failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(pagesUrl);
  await page.locator("#racingEditorCard").click();
  await page.locator('#racingPresetMaps .map-select-card[data-map-id="preset-island-freedrive"] .map-select-card-button').click();
  await page.locator("#racingMapSelectRaceButton").click();
  await page.locator("#racingCarOptions .race-car-option:not(:disabled)").last().click();
  await page.waitForTimeout(3_000);
  await page.locator("#racingStartRaceButton").click();
  await page.waitForFunction(() => document.getElementById("racingStartOverlay")?.hidden === true, null, { timeout: 45_000 });
  await page.waitForTimeout(3_000);
  if (failures.length) throw new Error(`Cloudflare build load failures:\n${failures.join("\n")}`);
  console.log("Verified Pages free-drive assets and optimized preview/race GLB loading.");
} finally {
  await browser.close();
}

async function verifyPagesAllowlist() {
  const plan = createCloudflareBuildPlan(assetGraph);
  const allowedRoots = new Set([
    ...plan.pagesFiles.map((file) => file.split("/")[0]),
    ...plan.pagesDirectories.map((directory) => directory.split("/")[0]),
    ...assetGraph.pages.generated.map((file) => file.split("/")[0]),
    "assets"
  ]);
  for (const entry of await readdir(pagesDir, { withFileTypes: true })) {
    if (!allowedRoots.has(entry.name)) throw new Error(`Unknown root entry in Pages output: ${entry.name}`);
  }
}

async function verifyLocalReferences() {
  const files = await walkFiles(pagesDir);
  for (const file of files.filter((target) => /\.(?:html|css|js|mjs)$/.test(target))) {
    const content = await readFile(file, "utf8");
    const references = [
      ...content.matchAll(/(?:from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g),
      ...content.matchAll(/(?:src|href)=["'](\.\/?[^"']+)["']/g),
      ...content.matchAll(/url\(["']?(\.\/?[^"')]+)["']?\)/g)
    ].map((match) => match[2] ?? match[1]).filter(Boolean);
    for (const reference of references) {
      const clean = reference.split(/[?#]/)[0];
      const target = path.resolve(path.dirname(file), clean);
      if (!target.startsWith(pagesDir) || !await exists(target)) throw new Error(`Missing local reference from ${path.relative(pagesDir, file)}: ${reference}`);
    }
  }
}

async function verifyFreeDriveAssets() {
  const hdrPath = path.join(pagesDir, "assets/freedrive/environment/qwantani-noon-puresky-1k.hdr");
  const hdr = await readFile(hdrPath);
  if (!hdr.subarray(0, 10).equals(Buffer.from("#?RADIANCE"))) {
    throw new Error("Free-drive HDR is missing or invalid in the Pages output.");
  }
  const requiredDirectories = ["environment", "models", "textures"];
  for (const directory of requiredDirectories) {
    if (!await exists(path.join(pagesDir, "assets/freedrive", directory))) {
      throw new Error(`Free-drive Pages directory is missing: ${directory}`);
    }
  }
}

async function verifyR2Manifest() {
  const manifest = JSON.parse(await readFile(path.resolve("_deploy/r2-manifest.json"), "utf8"));
  for (const entry of Object.values(manifest)) {
    for (const [keyName, bytesName, hashName] of [["objectKey", "bytes", "sha256"], ["previewObjectKey", "previewBytes", "previewSha256"]]) {
      const target = path.join(r2Dir, entry[keyName]);
      const bytes = await readFile(target);
      if (bytes.length !== entry[bytesName]) throw new Error(`R2 size mismatch: ${entry[keyName]}`);
      if (createHash("sha256").update(bytes).digest("hex") !== entry[hashName]) throw new Error(`R2 hash mismatch: ${entry[keyName]}`);
    }
  }
}

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target)); else files.push(target);
  }
  return files;
}

async function exists(target) { return stat(target).then(() => true).catch(() => false); }
