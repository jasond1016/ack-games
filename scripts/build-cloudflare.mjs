import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";
import { createCloudflareAssetGraph, createCloudflareBuildPlan } from "./cloudflare-asset-graph.mjs";

const root = path.resolve(".");
const deployRoot = path.join(root, "_deploy");
const stagingRoot = path.join(deployRoot, `.staging-${process.pid}-${Date.now()}`);
const pagesDir = path.join(stagingRoot, "pages");
const r2Dir = path.join(stagingRoot, "r2");
const modelBaseUrl = process.env.MODEL_ASSET_BASE_URL;
if (!modelBaseUrl) throw new Error("MODEL_ASSET_BASE_URL is required, e.g. https://assets.example.com/");

const assetGraph = createCloudflareAssetGraph(racingCarCatalog);
const plan = createCloudflareBuildPlan(assetGraph);
await mkdir(pagesDir, { recursive: true });
await mkdir(r2Dir, { recursive: true });

try {
  for (const relative of plan.pagesFiles) await copyRequired(relative, pagesDir);
  for (const relative of plan.pagesDirectories) await copyRequired(relative, pagesDir, true);

  const manifest = {};
  for (const car of plan.cars) {
    const optimizedPath = path.join(root, "assets/cars-optimized", `${car.id}.glb`);
    const originalPath = path.join(root, "assets/cars", car.modelSourcePath);
    const sourcePath = await exists(optimizedPath) ? optimizedPath : originalPath;
    const bytes = await readFile(sourcePath);
    const full = await writeHashedR2Object(car.id, bytes, "cars");
    const previewPath = path.join(root, "assets/cars-preview-optimized", `${car.id}.glb`);
    const previewBytes = await readFile(previewPath).catch(() => bytes);
    const preview = await writeHashedR2Object(car.id, previewBytes, "cars/previews");
    const thumbnailBytes = await readFile(path.join(root, car.thumbnailSource));
    const thumbnailHash = shortHash(thumbnailBytes);
    const thumbnailUrl = `./assets/car-thumbnails/${car.id}.${thumbnailHash}.webp`;
    const thumbnailTarget = path.join(pagesDir, thumbnailUrl.slice(2));
    await mkdir(path.dirname(thumbnailTarget), { recursive: true });
    await writeFile(thumbnailTarget, thumbnailBytes);
    manifest[car.id] = {
      objectKey: full.objectKey,
      previewObjectKey: preview.objectKey,
      thumbnailUrl,
      bytes: bytes.length,
      previewBytes: previewBytes.length,
      sha256: sha256(bytes),
      previewSha256: sha256(previewBytes)
    };
  }

  const serializedManifest = JSON.stringify(manifest, null, 2);
  // Bump the cache generation when response metadata such as R2 CORS changes,
  // even if the immutable model bytes themselves stay identical.
  const modelAssetVersion = shortHash(Buffer.from(`${serializedManifest}\ncors-v2`));
  await writeFile(path.join(pagesDir, "racing-model-manifest.js"), `export const racingModelManifest = Object.freeze(${serializedManifest});\n`);
  await writeFile(path.join(stagingRoot, "r2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(pagesDir, "racing-deployment-config.js"), `export const racingDeploymentConfig = Object.freeze({\n  modelAssetBaseUrl: ${JSON.stringify(new URL("./", modelBaseUrl).href)},\n  previewModelAssetBaseUrl: ${JSON.stringify(new URL("./", modelBaseUrl).href)},\n  modelAssetVersion: ${JSON.stringify(modelAssetVersion)},\n  useHashedModelAssets: true\n});\n`);
  await writeFile(path.join(pagesDir, "_headers"), buildHeaders());
  await validateStaging();
  await promoteStaging();
  console.log(`Pages: ${path.join(deployRoot, "pages")}`);
  console.log(`R2: ${path.join(deployRoot, "r2")}`);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function copyRequired(relative, targetRoot, recursive = false) {
  const source = path.join(root, relative);
  if (!await exists(source)) throw new Error(`Declared runtime asset is missing: ${relative}`);
  const target = path.join(targetRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive });
}

async function writeHashedR2Object(id, bytes, directory) {
  const hash = shortHash(bytes);
  const objectKey = `${directory}/${id}.${hash}.glb`;
  const target = path.join(r2Dir, objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { objectKey };
}

async function validateStaging() {
  const files = await walkFiles(pagesDir);
  if (files.length > assetGraph.pages.limits.maxFiles) throw new Error(`Pages output has ${files.length} files; limit is ${assetGraph.pages.limits.maxFiles}.`);
  for (const file of files) {
    const info = await stat(file);
    if (info.size > assetGraph.pages.limits.maxFileBytes) throw new Error(`Pages asset exceeds 25 MiB: ${path.relative(pagesDir, file)}`);
    const relative = path.relative(pagesDir, file).replaceAll("\\", "/");
    const allowedPageModel = relative.startsWith("assets/freedrive/models/") || relative.startsWith("assets/tennis/models/");
    if (file.toLowerCase().endsWith(".glb") && !allowedPageModel) {
      throw new Error(`Unexpected GLB leaked into Pages: ${relative}`);
    }
  }
  for (const relative of ["package.json", "CONTEXT.md", "docs", "tests", "scripts"]) {
    if (await exists(path.join(pagesDir, relative))) throw new Error(`Forbidden repository content leaked into Pages: ${relative}`);
  }
}

async function promoteStaging() {
  const backup = path.join(deployRoot, `.previous-${process.pid}`);
  await rm(backup, { recursive: true, force: true });
  await mkdir(backup, { recursive: true });
  const targets = ["pages", "r2", "r2-manifest.json"];
  try {
    for (const target of targets) if (await exists(path.join(deployRoot, target))) await rename(path.join(deployRoot, target), path.join(backup, target));
    for (const target of targets) await rename(path.join(stagingRoot, target), path.join(deployRoot, target));
    await rm(backup, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const target of targets) {
      await rm(path.join(deployRoot, target), { recursive: true, force: true });
      if (await exists(path.join(backup, target))) await rename(path.join(backup, target), path.join(deployRoot, target));
    }
    throw error;
  }
}

function buildHeaders() {
  return `/index.html\n  Cache-Control: no-cache\n\n/*.js\n  Cache-Control: public, max-age=0, must-revalidate\n\n/*.mjs\n  Cache-Control: public, max-age=0, must-revalidate\n\n/styles.css\n  Cache-Control: public, max-age=0, must-revalidate\n\n/racing-model-manifest.js\n  Cache-Control: public, max-age=0, must-revalidate\n\n/racing-deployment-config.js\n  Cache-Control: public, max-age=0, must-revalidate\n\n/assets/car-thumbnails/*.*.webp\n  Cache-Control: public, max-age=31536000, immutable\n`;
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
function shortHash(bytes) { return sha256(bytes).slice(0, 12); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
