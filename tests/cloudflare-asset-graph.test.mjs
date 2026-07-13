import assert from "node:assert/strict";
import test from "node:test";
import { createCloudflareAssetGraph, createCloudflareBuildPlan } from "../scripts/cloudflare-asset-graph.mjs";

test("Cloudflare asset graph is fail-closed and excludes repository internals", () => {
  const graph = createCloudflareAssetGraph([{ id: "car", modelSourcePath: "car.glb" }]);
  const plan = createCloudflareBuildPlan(graph);
  assert.ok(plan.pagesFiles.includes("index.html"));
  assert.ok(plan.pagesFiles.includes("game-lifecycle.mjs"));
  assert.ok(plan.pagesFiles.includes("racing-driving-dynamics.mjs"));
  assert.ok(plan.pagesFiles.includes("racing-jump-rules.mjs"));
  for (const forbidden of ["package.json", "CONTEXT.md", "tests", "docs", "scripts"]) {
    assert.ok(!plan.pagesFiles.includes(forbidden));
    assert.ok(!plan.pagesDirectories.includes(forbidden));
  }
  assert.equal(plan.cars.length, graph.cars.length);
});

test("Cloudflare asset graph rejects duplicate targets and car ids", () => {
  assert.throws(() => createCloudflareBuildPlan({ pages: { files: ["index.html", "index.html"], generated: [], directories: [] }, cars: [] }), /Duplicate Pages target/);
  assert.throws(() => createCloudflareBuildPlan({ pages: { files: [], generated: [], directories: [] }, cars: [{ id: "same" }, { id: "same" }] }), /Duplicate racing car id/);
});
