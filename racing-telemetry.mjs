const DEFAULT_SAMPLE_WINDOW = 120;
const MIN_BENCHMARK_SECONDS = 1;
const MAX_BENCHMARK_SECONDS = 120;

export function createRacingTelemetry({ sampleWindow = DEFAULT_SAMPLE_WINDOW } = {}) {
  const windowSize = Math.max(1, Math.floor(finiteOr(sampleWindow, DEFAULT_SAMPLE_WINDOW)));
  const recentSamples = [];
  let benchmark = null;
  let completedBenchmark = null;

  function recordFrame(sample) {
    const normalized = normalizeSample(sample);
    recentSamples.push(normalized);
    if (recentSamples.length > windowSize) recentSamples.shift();

    if (!benchmark || !normalized.simulationActive) return snapshot();
    benchmark.samples.push(normalized);
    benchmark.elapsedSeconds += normalized.deltaSeconds;
    if (benchmark.elapsedSeconds >= benchmark.durationSeconds) {
      completedBenchmark = Object.freeze({
        status: "completed",
        label: benchmark.label,
        targetDurationSeconds: benchmark.durationSeconds,
        ...summarizeSamples(benchmark.samples)
      });
      benchmark = null;
    }
    return snapshot();
  }

  function startBenchmark({ label = "driving", durationSeconds = 10 } = {}) {
    benchmark = {
      label: String(label || "driving"),
      durationSeconds: clamp(
        finiteOr(durationSeconds, 10),
        MIN_BENCHMARK_SECONDS,
        MAX_BENCHMARK_SECONDS
      ),
      elapsedSeconds: 0,
      samples: []
    };
    completedBenchmark = null;
    return snapshot();
  }

  function cancelBenchmark() {
    benchmark = null;
    return snapshot();
  }

  function reset() {
    recentSamples.length = 0;
    benchmark = null;
    completedBenchmark = null;
  }

  function snapshot() {
    return Object.freeze({
      live: summarizeSamples(recentSamples),
      benchmark: benchmark
        ? Object.freeze({
            status: "running",
            label: benchmark.label,
            targetDurationSeconds: benchmark.durationSeconds,
            elapsedSeconds: round(benchmark.elapsedSeconds, 3),
            progress: round(benchmark.elapsedSeconds / benchmark.durationSeconds, 3),
            frameCount: benchmark.samples.length
          })
        : completedBenchmark ?? Object.freeze({ status: "idle" })
    });
  }

  return Object.freeze({ recordFrame, startBenchmark, cancelBenchmark, reset, snapshot });
}

export function summarizeRacingTelemetry(samples) {
  return summarizeSamples((samples ?? []).map(normalizeSample));
}

function normalizeSample({
  deltaSeconds = 0,
  cpuMs = 0,
  physicsMs = 0,
  renderMs = 0,
  physicsSteps = 0,
  simulationActive = true,
  render = null
} = {}) {
  return Object.freeze({
    deltaSeconds: Math.max(0, finiteOr(deltaSeconds, 0)),
    cpuMs: Math.max(0, finiteOr(cpuMs, 0)),
    physicsMs: Math.max(0, finiteOr(physicsMs, 0)),
    renderMs: Math.max(0, finiteOr(renderMs, 0)),
    physicsSteps: Math.max(0, Math.floor(finiteOr(physicsSteps, 0))),
    simulationActive: Boolean(simulationActive),
    render: render ? Object.freeze({
      calls: Math.max(0, Math.floor(finiteOr(render.calls, 0))),
      triangles: Math.max(0, Math.floor(finiteOr(render.triangles, 0))),
      points: Math.max(0, Math.floor(finiteOr(render.points, 0)))
    }) : null
  });
}

function summarizeSamples(samples) {
  if (!samples.length) {
    return Object.freeze({
      frameCount: 0,
      durationSeconds: 0,
      averageFps: 0,
      onePercentLowFps: 0,
      averageFrameMs: 0,
      p95FrameMs: 0,
      maximumFrameMs: 0,
      averageCpuMs: 0,
      p95PhysicsMs: 0,
      p95RenderMs: 0,
      averagePhysicsSteps: 0,
      maximumRenderCalls: 0,
      maximumTriangles: 0
    });
  }

  const frameMs = samples.map((sample) => sample.deltaSeconds * 1000);
  const durationSeconds = samples.reduce((sum, sample) => sum + sample.deltaSeconds, 0);
  const p99FrameMs = percentile(frameMs, 0.99);
  return Object.freeze({
    frameCount: samples.length,
    durationSeconds: round(durationSeconds, 3),
    averageFps: round(durationSeconds > 0 ? samples.length / durationSeconds : 0, 1),
    onePercentLowFps: round(p99FrameMs > 0 ? 1000 / p99FrameMs : 0, 1),
    averageFrameMs: round(average(frameMs), 2),
    p95FrameMs: round(percentile(frameMs, 0.95), 2),
    maximumFrameMs: round(Math.max(...frameMs), 2),
    averageCpuMs: round(average(samples.map((sample) => sample.cpuMs)), 2),
    p95PhysicsMs: round(percentile(samples.map((sample) => sample.physicsMs), 0.95), 2),
    p95RenderMs: round(percentile(samples.map((sample) => sample.renderMs), 0.95), 2),
    averagePhysicsSteps: round(average(samples.map((sample) => sample.physicsSteps)), 2),
    maximumRenderCalls: Math.max(0, ...samples.map((sample) => sample.render?.calls ?? 0)),
    maximumTriangles: Math.max(0, ...samples.map((sample) => sample.render?.triangles ?? 0))
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
