import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve("output");
const read = (name) => JSON.parse(fs.readFileSync(path.join(outputDir, name), "utf8"));
const before = read("racing-loading-before.json");
const after = read("racing-loading-after-final.json");
const preloadEnabled = read("racing-modulepreload-with-preload.json");
const preloadDisabled = read("racing-modulepreload-without-preload.json");

const report = {
  schemaVersion: 1,
  build: {
    id: process.env.RACING_LOADING_AUDIT_BUILD ?? "unknown",
    tree: "dirty working tree; only the listed experiment toggles were temporarily applied while sampling"
  },
  commands: {
    loading: "RACING_LOADING_BASELINE=1 RACING_LOADING_SAMPLES=5 RACING_LOADING_REPORT_NAME=<name>.json pnpm exec playwright test tests/racing-loading-baseline.spec.js --reporter=line",
    preload: "RACING_MODULEPRELOAD_AUDIT=1 RACING_MODULEPRELOAD_SAMPLES=5 RACING_MODULEPRELOAD_VARIANT=<variant> pnpm exec playwright test tests/racing-modulepreload-audit.spec.js --reporter=line"
  },
  methodology: {
    device: "same local Playwright Chromium runner; one fresh browser context per cold sample; one primed context for the five hot samples",
    before: "no vehicle-template warmup and no modulepreload",
    after: "uncached vehicle-template warmup overlaps scene construction; hot cache skips that work; no modulepreload",
    samples: "five cold and five hot launches in each report"
  },
  before,
  after,
  deltas: summarizeDelta(before, after),
  modulePreloadExperiment: {
    finalDecision: "removed",
    reason: "The temporary preload experiment improved neither lobby p95 nor its strict non-negative-cost gate, so it is intentionally not shipped.",
    enabled: preloadEnabled,
    disabled: preloadDisabled
  },
  loading: {
    addedNetworkResources: 0,
    mediaNodes: 0,
    evidence: "The lifecycle DOM contains no img/video/audio/canvas/iframe descendants in every audit sample; game view remains covered until first-drivable-frame in racing-loading-lifecycle.spec.js."
  }
};

fs.writeFileSync(path.join(outputDir, "racing-loading-audit.json"), `${JSON.stringify(report, null, 2)}\n`);

function summarizeDelta(beforeReport, afterReport) {
  return Object.fromEntries(["cold", "hot"].map((mode) => {
    const beforeStages = beforeReport.summary[mode].stages;
    const afterStages = afterReport.summary[mode].stages;
    const vehiclePhase = (report) =>
      report.summary[mode].stages.vehicles.p50 - report.summary[mode].stages.physics.p50;
    return [mode, {
      totalMs: {
        p50: afterReport.summary[mode].totalMs.p50 - beforeReport.summary[mode].totalMs.p50,
        p95: afterReport.summary[mode].totalMs.p95 - beforeReport.summary[mode].totalMs.p95
      },
      physicsToVehiclesP50Ms: {
        before: vehiclePhase(beforeReport),
        after: vehiclePhase(afterReport),
        delta: vehiclePhase(afterReport) - vehiclePhase(beforeReport)
      },
      moduleReadyP50Ms: {
        before: beforeStages["module-ready"].p50,
        after: afterStages["module-ready"].p50
      }
    }];
  }));
}
