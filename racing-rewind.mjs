/** Rolling pose buffer for Motorfest-style rewind (hold to scrub back ≤ capacitySeconds). */

export const REWIND_BUFFER_SECONDS = 10;
export const REWIND_SAMPLE_HZ = 30;

export function createRewindBuffer({
  capacitySeconds = REWIND_BUFFER_SECONDS,
  sampleHz = REWIND_SAMPLE_HZ
} = {}) {
  const maxSamples = Math.max(2, Math.ceil(capacitySeconds * sampleHz));
  /** @type {object[]} */
  const samples = [];
  let sampleAccumulator = 0;
  let cursorTime = null;
  let active = false;

  function newest() {
    return samples.length ? samples[samples.length - 1] : null;
  }

  function oldest() {
    return samples.length ? samples[0] : null;
  }

  function bufferedSeconds() {
    if (samples.length < 2) return 0;
    return Math.max(0, newest().time - oldest().time);
  }

  function trimToCapacity() {
    while (samples.length > maxSamples) samples.shift();
    const tip = newest();
    if (!tip) return;
    while (samples.length > 1 && tip.time - samples[0].time > capacitySeconds) {
      samples.shift();
    }
  }

  function findSampleAtOrBefore(time) {
    if (!samples.length) return null;
    let best = samples[0];
    for (const sample of samples) {
      if (sample.time <= time) best = sample;
      else break;
    }
    return best;
  }

  function truncateAfter(time) {
    while (samples.length && samples[samples.length - 1].time > time + 1e-6) {
      samples.pop();
    }
  }

  return Object.freeze({
    capacitySeconds,
    clear() {
      samples.length = 0;
      sampleAccumulator = 0;
      cursorTime = null;
      active = false;
    },
    get active() {
      return active;
    },
    get atStart() {
      if (!samples.length) return true;
      if (cursorTime == null) return bufferedSeconds() <= 1e-3;
      return cursorTime <= (oldest()?.time ?? 0) + 1e-3;
    },
    get bufferedSeconds() {
      return bufferedSeconds();
    },
    get sampleCount() {
      return samples.length;
    },
    begin() {
      const tip = newest();
      if (!tip) {
        active = false;
        cursorTime = null;
        return false;
      }
      active = true;
      cursorTime = tip.time;
      return true;
    },
    end() {
      active = false;
      cursorTime = null;
    },
    /** Record at most sampleHz while driving forward. */
    maybeRecord(deltaSeconds, buildSample) {
      if (active) return null;
      sampleAccumulator += Math.max(0, deltaSeconds);
      const interval = 1 / sampleHz;
      if (sampleAccumulator < interval && samples.length > 0) return null;
      sampleAccumulator = 0;
      const sample = buildSample();
      if (!sample || !Number.isFinite(sample.time)) return null;
      samples.push(sample);
      trimToCapacity();
      return sample;
    },
    /**
     * Step cursor backward by deltaSeconds and return the sample to apply.
     * Truncates the future of the buffer past the applied sample.
     */
    stepBackward(deltaSeconds) {
      if (!active || !samples.length) {
        return { sample: null, atStart: true };
      }
      const start = oldest();
      cursorTime = Math.max(start.time, (cursorTime ?? newest().time) - Math.max(0, deltaSeconds));
      const sample = findSampleAtOrBefore(cursorTime);
      if (!sample) return { sample: null, atStart: true };
      truncateAfter(sample.time);
      const atStart = sample.time <= start.time + 1e-3;
      if (atStart) cursorTime = start.time;
      return { sample, atStart };
    },
    getState() {
      return Object.freeze({
        active,
        atStart: this.atStart,
        bufferSeconds: capacitySeconds,
        bufferedSeconds: Number(bufferedSeconds().toFixed(3)),
        sampleCount: samples.length,
        cursorTime: cursorTime == null ? null : Number(cursorTime.toFixed(3))
      });
    }
  });
}
