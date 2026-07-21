/**
 * Coastal day/night cycle (no weather). Pure sampling — no physics coupling.
 */

export const COASTAL_DAY_CYCLE_SECONDS = 240;

export const DAY_CYCLE_PHASES = Object.freeze(["day", "dusk", "night", "dawn"]);

const PHASE_BANDS = Object.freeze([
  Object.freeze({ id: "day", start: 0, end: 0.28 }),
  Object.freeze({ id: "dusk", start: 0.28, end: 0.42 }),
  Object.freeze({ id: "night", start: 0.42, end: 0.72 }),
  Object.freeze({ id: "dawn", start: 0.72, end: 1 })
]);

const FREEZE_PHASE_PROGRESS = Object.freeze({
  day: 0.12,
  dusk: 0.34,
  night: 0.55,
  dawn: 0.86
});

/** Key lighting looks sampled along the cycle (0 = noon-ish day, 1 = wrap). */
const LIGHTING_KEYS = Object.freeze([
  Object.freeze({
    progress: 0,
    phaseHint: "day",
    exposureScale: 1,
    environmentIntensity: 0.92,
    backgroundIntensity: 1,
    sunIntensity: 2.7,
    sunColor: 0xfff4dc,
    hemisphereIntensity: 1.25,
    hemisphereSky: 0xdceeff,
    hemisphereGround: 0x6f795c,
    fillIntensity: 0.42,
    fillColor: 0xa9d5ff,
    sunElevation: 0.72,
    sunAzimuth: -0.85,
    headlightBoost: 0
  }),
  Object.freeze({
    progress: 0.34,
    phaseHint: "dusk",
    exposureScale: 0.88,
    environmentIntensity: 0.72,
    backgroundIntensity: 0.78,
    sunIntensity: 1.85,
    sunColor: 0xff9a4a,
    hemisphereIntensity: 0.95,
    hemisphereSky: 0xffc8a0,
    hemisphereGround: 0x4a3a2e,
    fillIntensity: 0.55,
    fillColor: 0xff7a3a,
    sunElevation: 0.18,
    sunAzimuth: -1.05,
    headlightBoost: 0.15
  }),
  Object.freeze({
    progress: 0.55,
    phaseHint: "night",
    exposureScale: 0.58,
    environmentIntensity: 0.28,
    backgroundIntensity: 0.22,
    sunIntensity: 0.22,
    sunColor: 0xb8c8ff,
    hemisphereIntensity: 0.55,
    hemisphereSky: 0x1a2740,
    hemisphereGround: 0x0c1014,
    fillIntensity: 0.38,
    fillColor: 0x4a6a9a,
    sunElevation: -0.12,
    sunAzimuth: 0.9,
    headlightBoost: 1
  }),
  Object.freeze({
    progress: 0.86,
    phaseHint: "dawn",
    exposureScale: 0.82,
    environmentIntensity: 0.62,
    backgroundIntensity: 0.7,
    sunIntensity: 1.55,
    sunColor: 0xffd0b0,
    hemisphereIntensity: 0.9,
    hemisphereSky: 0xffb8c8,
    hemisphereGround: 0x3a4038,
    fillIntensity: 0.48,
    fillColor: 0xffa070,
    sunElevation: 0.22,
    sunAzimuth: 0.55,
    headlightBoost: 0.25
  }),
  Object.freeze({
    progress: 1,
    phaseHint: "day",
    exposureScale: 1,
    environmentIntensity: 0.92,
    backgroundIntensity: 1,
    sunIntensity: 2.7,
    sunColor: 0xfff4dc,
    hemisphereIntensity: 1.25,
    hemisphereSky: 0xdceeff,
    hemisphereGround: 0x6f795c,
    fillIntensity: 0.42,
    fillColor: 0xa9d5ff,
    sunElevation: 0.72,
    sunAzimuth: -0.85,
    headlightBoost: 0
  })
]);

export function normalizeDayCyclePhaseId(value) {
  if (value == null || value === "auto" || value === false) return null;
  const id = String(value).trim().toLowerCase();
  return DAY_CYCLE_PHASES.includes(id) ? id : null;
}

export function wrapDayCycleProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

export function resolveDayCycleProgress({
  elapsedSeconds = 0,
  cycleSeconds = COASTAL_DAY_CYCLE_SECONDS,
  frozenPhase = null
} = {}) {
  const frozen = normalizeDayCyclePhaseId(frozenPhase);
  if (frozen) return FREEZE_PHASE_PROGRESS[frozen];
  const period = Math.max(1, Number(cycleSeconds) || COASTAL_DAY_CYCLE_SECONDS);
  return wrapDayCycleProgress((Number(elapsedSeconds) || 0) / period);
}

export function resolveDayCyclePhaseId(progress) {
  const p = wrapDayCycleProgress(progress);
  for (const band of PHASE_BANDS) {
    if (p >= band.start && p < band.end) return band.id;
  }
  return "day";
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColorHex(a, b, t) {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

export function sampleDayCycleLighting(progress) {
  const p = wrapDayCycleProgress(progress);
  let left = LIGHTING_KEYS[0];
  let right = LIGHTING_KEYS[1];
  for (let index = 0; index < LIGHTING_KEYS.length - 1; index += 1) {
    if (p >= LIGHTING_KEYS[index].progress && p <= LIGHTING_KEYS[index + 1].progress) {
      left = LIGHTING_KEYS[index];
      right = LIGHTING_KEYS[index + 1];
      break;
    }
  }
  const span = Math.max(1e-6, right.progress - left.progress);
  const t = (p - left.progress) / span;
  return Object.freeze({
    progress: p,
    phase: resolveDayCyclePhaseId(p),
    exposureScale: lerp(left.exposureScale, right.exposureScale, t),
    environmentIntensity: lerp(left.environmentIntensity, right.environmentIntensity, t),
    backgroundIntensity: lerp(left.backgroundIntensity, right.backgroundIntensity, t),
    sunIntensity: lerp(left.sunIntensity, right.sunIntensity, t),
    sunColor: lerpColorHex(left.sunColor, right.sunColor, t),
    hemisphereIntensity: lerp(left.hemisphereIntensity, right.hemisphereIntensity, t),
    hemisphereSky: lerpColorHex(left.hemisphereSky, right.hemisphereSky, t),
    hemisphereGround: lerpColorHex(left.hemisphereGround, right.hemisphereGround, t),
    fillIntensity: lerp(left.fillIntensity, right.fillIntensity, t),
    fillColor: lerpColorHex(left.fillColor, right.fillColor, t),
    sunElevation: lerp(left.sunElevation, right.sunElevation, t),
    sunAzimuth: lerp(left.sunAzimuth, right.sunAzimuth, t),
    headlightBoost: lerp(left.headlightBoost, right.headlightBoost, t)
  });
}

export function resolveDayCycleState({
  elapsedSeconds = 0,
  cycleSeconds = COASTAL_DAY_CYCLE_SECONDS,
  frozenPhase = null,
  enabled = true
} = {}) {
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      cycleSeconds: COASTAL_DAY_CYCLE_SECONDS,
      progress: 0,
      phase: "day",
      frozenPhase: null,
      lighting: sampleDayCycleLighting(0)
    });
  }
  const frozen = normalizeDayCyclePhaseId(frozenPhase);
  const progress = resolveDayCycleProgress({ elapsedSeconds, cycleSeconds, frozenPhase: frozen });
  const lighting = sampleDayCycleLighting(progress);
  return Object.freeze({
    enabled: true,
    cycleSeconds: Math.max(1, Number(cycleSeconds) || COASTAL_DAY_CYCLE_SECONDS),
    progress,
    phase: lighting.phase,
    frozenPhase: frozen,
    lighting
  });
}

export function createDayCycleController({
  cycleSeconds = COASTAL_DAY_CYCLE_SECONDS,
  enabled = true
} = {}) {
  let elapsedSeconds = 0;
  let frozenPhase = null;
  let active = Boolean(enabled);

  return {
    isEnabled: () => active,
    getElapsedSeconds: () => elapsedSeconds,
    getFrozenPhase: () => frozenPhase,
    reset() {
      elapsedSeconds = 0;
      frozenPhase = null;
    },
    setFrozenPhase(phaseId) {
      frozenPhase = normalizeDayCyclePhaseId(phaseId);
      return frozenPhase;
    },
    advance(deltaSeconds, { paused = false } = {}) {
      if (!active || paused || frozenPhase) return this.snapshot();
      elapsedSeconds += Math.max(0, Number(deltaSeconds) || 0);
      return this.snapshot();
    },
    snapshot() {
      return resolveDayCycleState({
        elapsedSeconds,
        cycleSeconds,
        frozenPhase,
        enabled: active
      });
    }
  };
}
