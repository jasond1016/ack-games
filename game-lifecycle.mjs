export function createGameLifecycle({ registry, view, history, diagnostics = console, loadTimeoutMs = 20_000 }) {
  let requestId = 0;
  let active = null;
  let lastTarget = null;
  let destroyPromise = Promise.resolve();

  async function open(gameId, { payload = null, historyMode = "push" } = {}) {
    const descriptor = registry[gameId];
    if (!descriptor) return home({ historyMode: historyMode === "none" ? "replace" : historyMode });

    const ownRequestId = ++requestId;
    lastTarget = { gameId, payload };
    updateHistory(gameId, historyMode);
    view.showLoading({ gameId, title: descriptor.title });
    await destroyActive();
    if (ownRequestId !== requestId) return;

    try {
      const gameModule = await withTimeout(descriptor.load(), loadTimeoutMs, `${gameId} module load timed out.`);
      if (ownRequestId !== requestId) return;
      if (typeof gameModule.createGame !== "function") {
        throw new Error(`${gameId} module must export createGame(context).`);
      }

      const context = Object.freeze({
        payload,
        root: view.getGameRoot(gameId),
        home: () => home(),
        open: (nextGameId, nextPayload = null) => open(nextGameId, { payload: nextPayload }),
        replaceSelf: (nextPayload = payload) => open(gameId, { payload: nextPayload, historyMode: "none" })
      });
      const instance = gameModule.createGame(context);
      active = { gameId, instance };
      view.showGame({ gameId, title: descriptor.title });
      await instance.start();
      if (ownRequestId !== requestId) await destroyActive();
    } catch (error) {
      if (ownRequestId !== requestId) return;
      diagnostics?.error?.(`Failed to load ${gameId}.`, error);
      await destroyActive();
      if (ownRequestId !== requestId) return;
      view.showFailure({ gameId, title: descriptor.title, message: "游戏加载失败，请重试。" });
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

  return Object.freeze({ open, home, retry });
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
