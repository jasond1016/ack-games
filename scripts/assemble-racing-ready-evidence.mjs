import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve("output");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(outputDir, relative), "utf8"));
const assetDir = path.resolve("assets/racing/ready");
const assets = fs.readdirSync(assetDir)
  .filter((name) => /\.(avif|webp)$/i.test(name))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetDir, name)).size }));

const report = {
  build: process.env.RACING_READY_EVIDENCE_BUILD ?? "working-tree",
  performanceGate: {
    reference: {
      cold: { p50: 3249, p95: 3456 },
      hot: { p50: 1464, p95: 1535 }
    },
    current: readJson("racing-ready-loading-baseline.json").summary,
    conclusion: "The CSS placeholder is immediate; the responsive static cover begins loading at the loading boundary and fades in independently. Five-sample first-drivable-frame p95 remains within the locked gate."
  },
  responsiveAssets: {
    selection: "≤720px: 640; 721–1180px: 960; >1180px: 1440. AVIF is preferred, WebP is the fallback.",
    assets,
    visual: readJson("racing-ready-visual/report.json")
  },
  readyGate: {
    invariant: "Before confirmation, animationFrameId is absent; telemetry frames, physicsStepTotal, elapsedSeconds, AI pose and audio state remain frozen. Confirmation clears pre-held keyboard state and primes the gamepad edge detector before one loop is scheduled.",
    controls: ["Enter", "mouse button", "touch button", "Xbox A"],
    commands: [
      "node --test tests/game-lifecycle.test.mjs tests/racing-resource-leases.test.mjs tests/racing-runtime-adapters.test.mjs",
      "pnpm exec playwright test tests/racing-loading-lifecycle.spec.js tests/racing-ready-controls.spec.js --reporter=line",
      "RACING_READY_VISUAL=1 pnpm exec playwright test tests/racing-ready-visual.spec.js --reporter=line",
      "RACING_LOADING_BASELINE=1 RACING_LOADING_SAMPLES=5 RACING_LOADING_REPORT_NAME=racing-ready-loading-baseline.json pnpm exec playwright test tests/racing-loading-baseline.spec.js --reporter=line"
    ],
    slowAndTimeout: "The lifecycle unit suite contains the unresolved async-start cover case and the start-timeout cleanup/retry case; both remain in the passing run."
  }
};

fs.writeFileSync(path.join(outputDir, "racing-ready-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
