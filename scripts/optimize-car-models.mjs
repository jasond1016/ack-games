import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { racingCarCatalog } from "../racing-car-config.js";

await mkdir("assets/cars-optimized", { recursive: true });
await mkdir("assets/cars-preview-optimized", { recursive: true });
for (const car of racingCarCatalog) {
  const input = path.resolve("assets/cars", car.modelSourcePath);
  const output = path.resolve("assets/cars-optimized", `${car.id}.glb`);
  console.log(`Optimizing ${car.id}...`);
  const runOptimize = (target, extraArgs = []) => new Promise((resolve, reject) => {
    const cli = path.resolve("node_modules/@gltf-transform/cli/bin/cli.js");
    const child = spawn(process.execPath, [cli, "optimize", input, target, "--compress", "draco", "--texture-compress", "webp", ...extraArgs], { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`gltf-transform exited with ${code}`)));
  });
  await runOptimize(output);
  const previewOutput = path.resolve("assets/cars-preview-optimized", `${car.id}.glb`);
  await runOptimize(previewOutput, ["--simplify-ratio", "0.35", "--simplify-error", "0.01"]);
}
