import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const command = isWindows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
const args = isWindows
  ? ["/d", "/s", "/c", "pnpm exec playwright test tests/racing-vehicle-matrix.spec.js"]
  : ["exec", "playwright", "test", "tests/racing-vehicle-matrix.spec.js"];
const child = spawn(command, args, {
  env: { ...process.env, RACING_MATRIX: "1" },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
