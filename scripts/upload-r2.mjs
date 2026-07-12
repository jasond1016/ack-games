import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { createR2UploadPlan } from "./r2-upload-plan.mjs";

const bucket = process.env.R2_BUCKET;
if (!bucket) throw new Error("R2_BUCKET is required.");
const manifest = JSON.parse(await readFile("_deploy/r2-manifest.json", "utf8"));
const wranglerCli = path.resolve("node_modules/wrangler/bin/wrangler.js");

async function runWrangler(args, { message, quiet = false, allowFailure = false } = {}) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], { stdio: quiet ? "ignore" : "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (exitCode !== 0 && !allowFailure) throw new Error(message ?? `wrangler exited with ${exitCode}`);
  return exitCode;
}

await runWrangler(["r2", "bucket", "list"], {
  message: "Wrangler cannot access R2. Refresh the minimum OAuth permissions with `pnpm exec wrangler login --scopes account:read user:read workers:write pages:write`, then confirm `pnpm exec wrangler r2 bucket list` succeeds before retrying."
});

for (const entry of createR2UploadPlan(manifest)) {
  const file = path.resolve("_deploy/r2", entry.objectKey);
  const localBytes = await readFile(file);
  if (localBytes.length !== entry.bytes || createHash("sha256").update(localBytes).digest("hex") !== entry.sha256) {
    throw new Error(`Local R2 object does not match manifest: ${entry.objectKey}`);
  }
  const remoteFile = path.join(os.tmpdir(), `ack-games-r2-${process.pid}-${path.basename(entry.objectKey)}`);
  const getExit = await runWrangler(["r2", "object", "get", `${bucket}/${entry.objectKey}`, "--file", remoteFile, "--remote"], { quiet: true, allowFailure: true });
  if (getExit === 0) {
    const remoteBytes = await readFile(remoteFile);
    await rm(remoteFile, { force: true });
    if (remoteBytes.length !== entry.bytes || createHash("sha256").update(remoteBytes).digest("hex") !== entry.sha256) {
      throw new Error(`Immutable R2 object already exists with different content: ${entry.objectKey}`);
    }
    console.log(`Skipping existing ${entry.objectKey}`);
    continue;
  }
  await rm(remoteFile, { force: true });
  console.log(`Uploading ${entry.objectKey}`);
  await runWrangler(["r2", "object", "put", `${bucket}/${entry.objectKey}`, "--file", file, "--content-type", "model/gltf-binary", "--cache-control", "public, max-age=31536000, immutable", "--remote"]);
}
