import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";

await mkdir("assets/cars-optimized", { recursive: true });
await mkdir("assets/cars-preview-optimized", { recursive: true });
const requestedIds = new Set((process.env.RACING_ASSET_CARS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const cars = requestedIds.size > 0
  ? racingCarCatalog.filter((car) => requestedIds.has(car.id))
  : racingCarCatalog;
if (requestedIds.size > 0 && cars.length !== requestedIds.size) {
  throw new Error(`Unknown car ids: ${[...requestedIds].filter((id) => !cars.some((car) => car.id === id)).join(", ")}`);
}
for (const car of cars) {
  const input = path.resolve("assets/cars", car.modelSourcePath);
  const output = path.resolve("assets/cars-optimized", `${car.id}.glb`);
  console.log(`Optimizing ${car.id}...`);
  const runOptimize = (target, extraArgs = []) => new Promise((resolve, reject) => {
    const cli = path.resolve("node_modules/@gltf-transform/cli/bin/cli.js");
    // Palette merging destroys material identity (e.g. a source `Red_Lights`
    // lens becomes an anonymous palette slot), preventing in-model brake-light
    // anchoring. Keep material boundaries while retaining Draco/WebP transport
    // compression and the rest of the optimization pipeline.
    const child = spawn(process.execPath, [cli, "optimize", input, target,
      "--compress", "draco", "--texture-compress", "webp", "--palette", "false", "--join", "false", ...extraArgs], { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`gltf-transform exited with ${code}`)));
  });
  await runOptimize(output);
  const previewOutput = path.resolve("assets/cars-preview-optimized", `${car.id}.glb`);
  await runOptimize(previewOutput, ["--simplify-ratio", "0.35", "--simplify-error", "0.01"]);
}
