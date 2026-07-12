import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";
import { createCloudflareAssetGraph, createCloudflareBuildPlan } from "./cloudflare-asset-graph.mjs";

const pagesDir = path.resolve("_deploy/pages");
const r2Dir = path.resolve("_deploy/r2");
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
if (pageGlbs.length) throw new Error(`Pages output contains GLBs:\n${pageGlbs.join("\n")}`);
await verifyPagesAllowlist();
await verifyLocalReferences();
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
