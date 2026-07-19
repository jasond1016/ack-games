const defaultStorageKey = "ack-games:racing:rally-ghost:v1";

export function createFreeDriveTimeTrial({
  checkpoints,
  storage = globalThis.localStorage,
  storageKey = defaultStorageKey,
  gateRadius = 6,
  sampleInterval = 0.08,
  autoStart = true
} = {}) {
  if (!Array.isArray(checkpoints) || checkpoints.length < 2) {
    throw new Error("计时挑战至少需要起点和终点。");
  }
  let phase = "ready";
  let elapsedSeconds = 0;
  let nextCheckpoint = 1;
  let recording = [];
  let sampleCarry = 0;
  let leftStartGate = false;
  let newBest = false;
  let best = loadBest(storage, storageKey);

  function start(pose) {
    phase = "running";
    elapsedSeconds = 0;
    nextCheckpoint = 1;
    recording = [ghostSample(0, pose)];
    sampleCarry = 0;
    leftStartGate = false;
    newBest = false;
  }

  function update({ x, z, heading = 0, deltaSeconds = 0 } = {}) {
    const pose = { x, z, heading };
    if (![x, z, heading].every(Number.isFinite)) return getState();
    const atStart = distanceTo(pose, checkpoints[0]) <= gateRadius;
    if (phase !== "running") {
      if (!autoStart) return getState();
      if (!atStart) leftStartGate = true;
      if (atStart && (phase === "ready" || leftStartGate)) start(pose);
      return getState();
    }

    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    elapsedSeconds += delta;
    sampleCarry += delta;
    if (sampleCarry >= sampleInterval) {
      sampleCarry %= sampleInterval;
      recording.push(ghostSample(elapsedSeconds, pose));
    }
    if (!atStart) leftStartGate = true;

    const target = checkpoints[nextCheckpoint];
    if (target && distanceTo(pose, target) <= gateRadius) {
      nextCheckpoint += 1;
      if (nextCheckpoint >= checkpoints.length) finish(pose);
    }
    return getState();
  }

  function finish(pose) {
    recording.push(ghostSample(elapsedSeconds, pose));
    phase = "finished";
    leftStartGate = false;
    newBest = !best || elapsedSeconds < best.timeSeconds;
    if (newBest) {
      best = Object.freeze({
        timeSeconds: elapsedSeconds,
        samples: Object.freeze(recording.map((sample) => Object.freeze(sample)))
      });
      saveBest(storage, storageKey, best);
    }
  }

  function reset() {
    phase = "ready";
    elapsedSeconds = 0;
    nextCheckpoint = 1;
    recording = [];
    sampleCarry = 0;
    leftStartGate = false;
    newBest = false;
    return getState();
  }

  function addPenalty(seconds) {
    if (phase !== "running" || !Number.isFinite(seconds) || seconds <= 0) return getState();
    elapsedSeconds += seconds;
    return getState();
  }

  function getState() {
    return Object.freeze({
      phase,
      elapsedSeconds,
      nextCheckpoint,
      checkpointCount: checkpoints.length,
      bestTimeSeconds: best?.timeSeconds ?? null,
      bestGhost: best?.samples ?? Object.freeze([]),
      recordingSampleCount: recording.length,
      newBest
    });
  }

  return Object.freeze({ start, update, reset, addPenalty, getState });
}

export function sampleGhostPose(samples, elapsedSeconds) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (elapsedSeconds <= samples[0].time) return samples[0];
  const duration = samples.at(-1).time;
  const time = duration > 0 ? elapsedSeconds % duration : 0;
  let nextIndex = samples.findIndex((sample) => sample.time >= time);
  if (nextIndex <= 0) nextIndex = 1;
  const previous = samples[nextIndex - 1];
  const next = samples[nextIndex] ?? samples.at(-1);
  const blend = clamp01((time - previous.time) / Math.max(next.time - previous.time, 0.0001));
  return Object.freeze({
    x: previous.x + (next.x - previous.x) * blend,
    z: previous.z + (next.z - previous.z) * blend,
    heading: interpolateAngle(previous.heading, next.heading, blend)
  });
}

function ghostSample(time, pose) {
  return { time, x: pose.x, z: pose.z, heading: pose.heading };
}

function distanceTo(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function interpolateAngle(from, to, blend) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * blend;
}

function loadBest(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) ?? "null");
    if (!Number.isFinite(parsed?.timeSeconds) || !Array.isArray(parsed?.samples) || parsed.samples.length < 2) return null;
    return Object.freeze({
      timeSeconds: parsed.timeSeconds,
      samples: Object.freeze(parsed.samples.filter((sample) =>
        [sample.time, sample.x, sample.z, sample.heading].every(Number.isFinite)
      ).map((sample) => Object.freeze(sample)))
    });
  } catch {
    return null;
  }
}

function saveBest(storage, key, best) {
  try { storage?.setItem?.(key, JSON.stringify(best)); } catch {}
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
