import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";

const root = path.resolve(".");
const deployRoot = path.join(root, "_deploy");
const pagesDir = path.join(deployRoot, "pages");
const r2Dir = path.join(deployRoot, "r2");
const modelBaseUrl = process.env.MODEL_ASSET_BASE_URL;
if (!modelBaseUrl) throw new Error("MODEL_ASSET_BASE_URL is required, e.g. https://assets.example.com/cars/");

await rm(deployRoot, { recursive: true, force: true });
await mkdir(pagesDir, { recursive: true });
await mkdir(r2Dir, { recursive: true });

const excluded = new Set([".git", ".agents", ".playwright-cli", ".wrangler", "_deploy", "node_modules", "output", "test-results", "tests", "scripts", "kenney_car-kit"]);
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  await cp(path.join(root, entry.name), path.join(pagesDir, entry.name), {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source).replaceAll("\\", "/");
      return !["assets/cars", "assets/cars-optimized", "assets/cars-preview-optimized"].some((directory) => relative === directory || relative.startsWith(`${directory}/`));
    }
  });
}

const manifest = {};
for (const car of racingCarCatalog) {
  const optimizedPath = path.join(root, "assets/cars-optimized", `${car.id}.glb`);
  const originalPath = path.join(root, "assets/cars", car.modelSourcePath);
  const sourcePath = await stat(optimizedPath).then(() => optimizedPath).catch(() => originalPath);
  const bytes = await readFile(sourcePath);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const objectKey = `cars/${car.id}.${hash}.glb`;
  const objectPath = path.join(r2Dir, objectKey);
  await mkdir(path.dirname(objectPath), { recursive: true });
  await writeFile(objectPath, bytes);
  const previewSource = path.join(root, "assets/cars-preview-optimized", `${car.id}.glb`);
  const previewBytes = await readFile(previewSource).catch(() => bytes);
  const previewHash = createHash("sha256").update(previewBytes).digest("hex").slice(0, 12);
  const previewObjectKey = `cars/previews/${car.id}.${previewHash}.glb`;
  const previewObjectPath = path.join(r2Dir, previewObjectKey);
  await mkdir(path.dirname(previewObjectPath), { recursive: true });
  await writeFile(previewObjectPath, previewBytes);
  manifest[car.id] = {
    objectKey,
    previewObjectKey,
    bytes: bytes.length,
    previewBytes: previewBytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

const manifestModule = `export const racingModelManifest = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`;
await writeFile(path.join(pagesDir, "racing-model-manifest.js"), manifestModule);
await writeFile(path.join(deployRoot, "r2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(pagesDir, "racing-deployment-config.js"), `export const racingDeploymentConfig = Object.freeze({\n  modelAssetBaseUrl: ${JSON.stringify(new URL("./", modelBaseUrl).href)},\n  useHashedModelAssets: true\n});\n`);
await writeFile(path.join(pagesDir, "_headers"), `/assets/car-thumbnails/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/*.js\n  Cache-Control: public, max-age=0, must-revalidate\n`);
console.log(`Pages: ${pagesDir}`);
console.log(`R2: ${r2Dir}`);
