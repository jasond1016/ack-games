export function createGameLifecycle({
  registry,
  view,
  history,
  diagnostics = console,
  loadTimeoutMs = 20_000,
  startTimeoutMs = 35_000,
  now = () => performance.now()
}) {
  let requestId = 0;
  let active = null;
  let lastTarget = null;
  let lastLoadReport = null;
  let destroyPromise = Promise.resolve();

  async function open(gameId, { payload = null, historyMode = "push" } = {}) {
    const descriptor = registry[gameId];
    if (!descriptor) return home({ historyMode: historyMode === "none" ? "replace" : historyMode });

    const ownRequestId = ++requestId;
    const startedAt = now();
    const timeline = [];
    const recordStage = (stage, message = null) => {
      const event = Object.freeze({ stage, message, elapsedMs: Math.round(now() - startedAt) });
      timeline.push(event);
      view.updateLoading?.({ gameId, title: descriptor.title, stage, message });
      return event;
    };
    lastTarget = { gameId, payload };
    updateHistory(gameId, historyMode);
    view.showLoading({ gameId, title: descriptor.title, stage: "module" });
    recordStage("loading-first-frame", "正在唤醒赛道…");
    await destroyActive();
    if (ownRequestId !== requestId) return;

    try {
      const gameModule = await withTimeout(descriptor.load(), loadTimeoutMs, `${gameId} module load timed out.`);
      recordStage("module-ready", "赛车运行时已载入，正在配置本次巡游…");
      if (ownRequestId !== requestId) return;
      if (typeof gameModule.createGame !== "function") {
        throw new Error(`${gameId} module must export createGame(context).`);
      }

      const context = Object.freeze({
        payload,
        root: view.getGameRoot(gameId),
        home: () => home(),
        open: (nextGameId, nextPayload = null) => open(nextGameId, { payload: nextPayload }),
        replaceSelf: (nextPayload = payload) => open(gameId, { payload: nextPayload, historyMode: "none" }),
        reportLoading: recordStage
      });
      const instance = gameModule.createGame(context);
      const target = {
        gameId,
        instance,
        descriptor,
        ownRequestId,
        startedAt,
        timeline,
        awaitingConfirmation: Boolean(instance.requiresPlayerConfirmation),
        confirming: false
      };
      active = target;
      // The canvas must be measurable while the game builds, but the loading
      // layer remains above it until the game reports its real ready boundary.
      view.prepareGame?.({ gameId, title: descriptor.title });
      await withTimeout(Promise.resolve(instance.start()), startTimeoutMs, `${gameId} start timed out.`);
      if (ownRequestId !== requestId) {
        await destroyActive();
        return;
      }
      if (target.awaitingConfirmation) {
        recordStage("ready-to-enter", "准备就绪，等待玩家确认。");
        lastLoadReport = createLoadReport(target, { awaitingConfirmation: true });
        view.showReady?.({ gameId, title: descriptor.title, message: "准备就绪，按 A / Enter 开始" });
        return;
      }
      completeActive(target);
    } catch (error) {
      if (ownRequestId !== requestId) return;
      const failureMessage = error?.message?.includes("timed out")
        ? "准备时间过长，请重试。"
        : "游戏加载失败，请重试。";
      lastLoadReport = Object.freeze({
        gameId,
        failed: true,
        totalMs: Math.round(now() - startedAt),
        timeline: Object.freeze([...timeline, Object.freeze({ stage: "failed", message: failureMessage, elapsedMs: Math.round(now() - startedAt) })])
      });
      diagnostics?.error?.(`Failed to load ${gameId}.`, error);
      await destroyActive();
      if (ownRequestId !== requestId) return;
      view.showFailure({ gameId, title: descriptor.title, message: failureMessage });
    }
  }

  async function confirm() {
    const target = active;
    if (!target?.awaitingConfirmation || target.confirming || target.ownRequestId !== requestId) return false;
    target.confirming = true;
    target.confirmedAt = now();
    view.showConfirming?.({ gameId: target.gameId, title: target.descriptor.title, message: "正在进入赛道…" });
    try {
      await withTimeout(
        Promise.resolve(target.instance.confirmStart?.()),
        startTimeoutMs,
        `${target.gameId} confirmation start timed out.`
      );
      if (active !== target || target.ownRequestId !== requestId) return false;
      completeActive(target);
      return true;
    } catch (error) {
      if (active !== target || target.ownRequestId !== requestId) return false;
      await failActive(target, error);
      return false;
    } finally {
      if (active === target) target.confirming = false;
    }
  }

  async function home({ historyMode = "push" } = {}) {
    const ownRequestId = ++requestId;
    lastTarget = null;
    updateHistory(null, historyMode);
    await destroyActive();
    if (ownRequestId === requestId) view.showHome();
  }

  function retry() {
    if (!lastTarget) return Promise.resolve();
    history.reload();
    return Promise.resolve();
  }

  function completeActive(target) {
    if (active !== target || target.ownRequestId !== requestId) return;
    target.awaitingConfirmation = false;
    view.showGame({ gameId: target.gameId, title: target.descriptor.title });
    lastLoadReport = createLoadReport(target);
  }

  async function failActive(target, error) {
    const failureMessage = error?.message?.includes("timed out")
      ? "准备时间过长，请重试。"
      : "游戏加载失败，请重试。";
    lastLoadReport = Object.freeze({
      gameId: target.gameId,
      failed: true,
      totalMs: Math.round(now() - target.startedAt),
      timeline: Object.freeze([...target.timeline, Object.freeze({ stage: "failed", message: failureMessage, elapsedMs: Math.round(now() - target.startedAt) })])
    });
    diagnostics?.error?.(`Failed to load ${target.gameId}.`, error);
    await destroyActive();
    if (target.ownRequestId === requestId) {
      view.showFailure({ gameId: target.gameId, title: target.descriptor.title, message: failureMessage });
    }
  }

  function createLoadReport(target, { awaitingConfirmation = false } = {}) {
    const elapsedMs = Math.round(now() - target.startedAt);
    const readyElapsedMs = [...target.timeline].reverse().find(({ stage }) => stage === "ready-to-enter")?.elapsedMs ?? null;
    const firstDrivableElapsedMs = readyElapsedMs ?? elapsedMs;
    const timeline = awaitingConfirmation
      ? target.timeline
      : [...target.timeline, Object.freeze({ stage: "first-drivable-frame", message: null, elapsedMs: firstDrivableElapsedMs })];
    return Object.freeze({
      gameId: target.gameId,
      awaitingConfirmation,
      // Readiness performance ends at the actual prepared/drivable boundary;
      // human deliberation on the ready cover is reported separately.
      totalMs: firstDrivableElapsedMs,
      confirmationWaitMs: target.confirmedAt && readyElapsedMs !== null
        ? Math.round(target.confirmedAt - target.startedAt) - readyElapsedMs
        : null,
      timeline: Object.freeze(timeline)
    });
  }

  function destroyActive() {
    const target = active;
    active = null;
    if (!target) return destroyPromise;
    destroyPromise = destroyPromise.then(async () => {
      try {
        target.instance?.stop?.();
      } catch (error) {
        diagnostics?.error?.(`Failed to stop ${target.gameId}.`, error);
      }
      try {
        await target.instance?.destroy?.();
      } catch (error) {
        diagnostics?.error?.(`Failed to destroy ${target.gameId}.`, error);
      }
    });
    return destroyPromise;
  }

  function updateHistory(gameId, mode) {
    if (mode === "none") return;
    const url = gameId ? `#${gameId}` : history.pathname();
    history[mode === "replace" ? "replace" : "push"]({ view: gameId ?? "home" }, url);
  }

  return Object.freeze({ open, confirm, home, retry, getLastLoadReport: () => lastLoadReport });
}

function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeoutId));
}
