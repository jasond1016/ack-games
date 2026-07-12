import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createR2UploadPlan } from "./r2-upload-plan.mjs";

const bucket = process.env.R2_BUCKET;
if (!bucket) throw new Error("R2_BUCKET is required.");
const manifest = JSON.parse(await readFile("_deploy/r2-manifest.json", "utf8"));
const wranglerCli = path.resolve("node_modules/wrangler/bin/wrangler.js");

async function runWrangler(args, { message } = {}) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exitCode !== 0) throw new Error(message ?? `wrangler exited with ${exitCode}`);
}

await runWrangler(["r2", "bucket", "list"], {
  message: "Wrangler cannot access R2. Refresh the minimum OAuth permissions with `pnpm exec wrangler login --scopes account:read user:read workers:write pages:write`, then confirm `pnpm exec wrangler r2 bucket list` succeeds before retrying."
});

for (const entry of createR2UploadPlan(manifest)) {
  const file = path.resolve("_deploy/r2", entry.objectKey);
  console.log(`Uploading ${entry.objectKey}`);
  await runWrangler(["r2", "object", "put", `${bucket}/${entry.objectKey}`, "--file", file, "--content-type", "model/gltf-binary", "--cache-control", "public, max-age=31536000, immutable", "--remote"]);
}
