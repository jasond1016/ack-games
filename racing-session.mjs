export const RACING_SESSION_PHASES = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  RUNNING: "running",
  PAUSED: "paused",
  FINISHING: "finishing",
  CINEMATIC: "cinematic",
  RESULT: "result",
  FAILED: "failed",
  DESTROYING: "destroying",
  DESTROYED: "destroyed"
});

const ACTIVE_PHASES = new Set([
  RACING_SESSION_PHASES.LOADING,
  RACING_SESSION_PHASES.RUNNING,
  RACING_SESSION_PHASES.PAUSED,
  RACING_SESSION_PHASES.FINISHING,
  RACING_SESSION_PHASES.CINEMATIC,
  RACING_SESSION_PHASES.RESULT,
  RACING_SESSION_PHASES.FAILED
]);

export function createRacingSnapshot({ map, startConfig, randomSeed = createRandomSeed() }) {
  if (!map || !startConfig) {
    throw new Error("比赛快照需要当前选中地图和开赛配置。");
  }

  return deepFreeze({
    map: structuredCloneValue(map),
    startConfig: structuredCloneValue(startConfig),
    randomSeed: normalizeRandomSeed(randomSeed)
  });
}

export function createSeededRandom(seed) {
  let state = normalizeRandomSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRacingResult({ snapshot, winner, playerPlace, elapsedSeconds, details = {} }) {
  if (!snapshot || !winner || !Number.isInteger(playerPlace)) {
    throw new Error("比赛结果需要比赛快照、胜者和玩家名次。");
  }
  return deepFreeze({
    snapshot,
    winner,
    playerPlace,
    elapsedSeconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
    details: structuredCloneValue(details)
  });
}

export function createRacingSession({ snapshot, implementation, view, onIntent = () => {}, diagnostics = console }) {
  if (!snapshot || !implementation?.start || !implementation?.destroy) {
    throw new Error("比赛会话需要比赛快照以及可启动、可销毁的 implementation。");
  }

  let phase = RACING_SESSION_PHASES.IDLE;
  let started = false;
  let destroyPromise = null;
  let intentReported = false;
  const abortController = new AbortController();

  const publish = (model = {}) => {
    if (phase !== RACING_SESSION_PHASES.DESTROYED) {
      view?.render?.(deepFreeze({ phase, ...structuredCloneValue(model) }));
    }
  };

  const transition = (nextPhase, model = {}) => {
    if (!ACTIVE_PHASES.has(nextPhase) || phase === RACING_SESSION_PHASES.DESTROYING || phase === RACING_SESSION_PHASES.DESTROYED) {
      return false;
    }
    phase = nextPhase;
    publish(model);
    return true;
  };

  const requestIntent = async (intent) => {
    if (intentReported) return;
    intentReported = true;
    await destroy();
    onIntent(deepFreeze(structuredCloneValue(intent)));
  };

  async function start() {
    if (started) {
      throw new Error("比赛会话只能启动一次。");
    }
    started = true;
    transition(RACING_SESSION_PHASES.LOADING);
    try {
      await implementation.start({ snapshot, signal: abortController.signal, transition, requestIntent });
      if (phase === RACING_SESSION_PHASES.LOADING) {
        transition(RACING_SESSION_PHASES.RUNNING);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        diagnostics?.error?.("Failed to start racing session.", error);
        transition(RACING_SESSION_PHASES.FAILED, { message: "比赛启动失败，请返回地图选择画面后重试。" });
      }
    }
  }

  function destroy() {
    if (destroyPromise) return destroyPromise;
    phase = RACING_SESSION_PHASES.DESTROYING;
    abortController.abort();
    destroyPromise = Promise.resolve()
      .then(() => implementation.destroy())
      .catch((error) => diagnostics?.error?.("Failed to destroy racing session cleanly.", error))
      .then(() => {
        phase = RACING_SESSION_PHASES.DESTROYED;
      });
    return destroyPromise;
  }

  return Object.freeze({ start, destroy });
}

function createRandomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

function normalizeRandomSeed(seed) {
  const numericSeed = Number(seed);
  return Number.isFinite(numericSeed) ? numericSeed >>> 0 : 0;
}

function structuredCloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
