import assert from "node:assert/strict";
import test from "node:test";
import { createRacingTelemetry, summarizeRacingTelemetry } from "../racing-telemetry.mjs";

test("racing telemetry summarizes frame, phase, and renderer samples", () => {
  const summary = summarizeRacingTelemetry([
    { deltaSeconds: 0.01, cpuMs: 5, physicsMs: 2, renderMs: 3, physicsSteps: 1, render: { calls: 80, triangles: 120_000 } },
    { deltaSeconds: 0.02, cpuMs: 7, physicsMs: 3, renderMs: 4, physicsSteps: 2, render: { calls: 90, triangles: 140_000 } }
  ]);

  assert.equal(summary.frameCount, 2);
  assert.equal(summary.durationSeconds, 0.03);
  assert.equal(summary.averageCpuMs, 6);
  assert.equal(summary.averagePhysicsSteps, 1.5);
  assert.equal(summary.maximumRenderCalls, 90);
  assert.equal(summary.maximumTriangles, 140_000);
});

test("benchmark advances only while the simulation is active and completes deterministically", () => {
  const telemetry = createRacingTelemetry({ sampleWindow: 2 });
  telemetry.startBenchmark({ label: "asphalt", durationSeconds: 1 });
  telemetry.recordFrame({ deltaSeconds: 0.5, simulationActive: false });
  assert.equal(telemetry.snapshot().benchmark.elapsedSeconds, 0);

  telemetry.recordFrame({ deltaSeconds: 0.5, simulationActive: true, render: { calls: 40 } });
  telemetry.recordFrame({ deltaSeconds: 0.5, simulationActive: true, render: { calls: 44 } });

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.benchmark.status, "completed");
  assert.equal(snapshot.benchmark.label, "asphalt");
  assert.equal(snapshot.benchmark.frameCount, 2);
  assert.equal(snapshot.benchmark.maximumRenderCalls, 44);
  assert.equal(snapshot.live.frameCount, 2);
});

test("starting a new benchmark clears the previous result and clamps unsafe durations", () => {
  const telemetry = createRacingTelemetry();
  const short = telemetry.startBenchmark({ durationSeconds: 0 });
  assert.equal(short.benchmark.targetDurationSeconds, 1);
  telemetry.recordFrame({ deltaSeconds: 1 });
  assert.equal(telemetry.snapshot().benchmark.status, "completed");

  const long = telemetry.startBenchmark({ label: "long", durationSeconds: 999 });
  assert.equal(long.benchmark.status, "running");
  assert.equal(long.benchmark.targetDurationSeconds, 120);
});
