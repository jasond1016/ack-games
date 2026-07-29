import { createGameLifecycle } from "./game-lifecycle.mjs";

const registry = Object.freeze({
  "typing-garage": {
    title: "超跑图鉴解锁 - ACK Games",
    viewId: "typingGarageView",
    load: () => import("./typing-garage-game.js")
  },
  "bus-rush": {
    title: "末班车冲刺（原型） - ACK Games",
    viewId: "busRushView",
    load: () => import("./bus-rush-prototype.js")
  },
  vacuum: {
    title: "吸尘器接管道 - ACK Games",
    viewId: "vacuumView",
    load: () => import("./vacuum-game.js")
  },
  tennis: {
    title: "城市网球 - ACK Games",
    viewId: "tennisView",
    load: () => import("./tennis-game.js")
  },
  "racing-select": {
    title: "赛车地图选择 - ACK Games",
    viewId: "racingMapSelectView",
    load: () => import("./racing-map-select.js")
  },
  racing: {
    title: "3D 赛车 - ACK Games",
    viewId: "racingView",
    load: () => import("./racing-game.js")
  },
  "racing-editor": {
    title: "地图编辑器 - ACK Games",
    viewId: "racingEditorView",
    load: () => import("./racing-editor.js")
  }
});

const body = document.body;
const homeView = document.getElementById("homeView");
const lifecycleView = document.getElementById("gameLifecycleView");
const lifecycleTitle = document.getElementById("gameLifecycleTitle");
const lifecycleMessage = document.getElementById("gameLifecycleMessage");
const lifecycleEnterButton = document.getElementById("gameLifecycleEnterButton");
const lifecycleRetryButton = document.getElementById("gameLifecycleRetryButton");
const lifecycleHomeButton = document.getElementById("gameLifecycleHomeButton");
const lifecycleBackdrop = document.getElementById("gameLifecycleBackdrop");
const lifecycleBackdropAvif = document.getElementById("gameLifecycleBackdropAvif");
const lifecycleBackdropWebp = document.getElementById("gameLifecycleBackdropWebp");
const lifecycleBackdropImage = document.getElementById("gameLifecycleBackdropImage");
const lifecycleViewportSyncFixEnabled = new URLSearchParams(location.search).get("viewportSyncFix") !== "off";
const gameViews = Object.fromEntries(
  Object.entries(registry).map(([gameId, descriptor]) => [gameId, document.getElementById(descriptor.viewId)])
);

const lifecycle = createGameLifecycle({
  registry,
  history: {
    pathname: () => location.pathname,
    push: (state, url) => history.pushState(state, "", url),
    replace: (state, url) => history.replaceState(state, "", url),
    reload: () => location.reload()
  },
  view: {
    getGameRoot: (gameId) => gameViews[gameId],
    showLoading({ gameId, title }) {
      showOnlyLifecycle();
      lifecycleView.dataset.state = "loading";
      lifecycleView.dataset.racing = String(gameId === "racing");
      if (gameId === "racing") {
        // Request the static cover at the loading boundary. It renders over the
        // lightweight CSS placeholder as soon as it arrives, while the racing
        // module continues preparing behind the opaque lifecycle view.
        upgradeRacingBackdrop();
        scheduleRacingBackdrop();
      }
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = "正在唤醒赛道…";
      lifecycleEnterButton.hidden = true;
      lifecycleRetryButton.hidden = true;
      document.title = title;
      body.dataset.activeView = gameId;
    },
    updateLoading({ title, message }) {
      lifecycleView.dataset.state = "loading";
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = message || "正在准备赛道…";
    },
    showReady({ gameId, title, message }) {
      showOnlyLifecycle();
      lifecycleView.dataset.racing = String(gameId === "racing");
      lifecycleView.dataset.state = "ready";
      lifecycleTitle.textContent = "准备就绪";
      lifecycleMessage.textContent = message || "按 A / Enter 开始";
      lifecycleEnterButton.hidden = false;
      lifecycleEnterButton.disabled = false;
      lifecycleRetryButton.hidden = true;
      lifecycleEnterButton.focus({ preventScroll: true });
      document.title = title;
      body.dataset.activeView = gameId;
    },
    showConfirming({ gameId, title, message }) {
      // `showReady()` intentionally hides the game root while the player
      // reads the cover. Reveal the root to layout here, but keep the opaque
      // lifecycle cover above it until confirmStart() has measured the canvas
      // and the game is safe to unveil. Otherwise resizeRenderer sees 0×0 and
      // falls back to the canvas's 960×620 attribute ratio until a browser
      // resize happens to repair it.
      if (lifecycleViewportSyncFixEnabled) prepareLifecycleGameLayout(gameId);
      lifecycleView.dataset.state = "loading";
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = message || "正在进入赛道…";
      lifecycleEnterButton.disabled = true;
      lifecycleEnterButton.hidden = false;
    },
    prepareGame({ gameId, title }) {
      homeView.hidden = true;
      for (const [candidateId, candidateView] of Object.entries(gameViews)) {
        candidateView.hidden = candidateId !== gameId;
      }
      // Keep lifecycleView visible as an opaque cover until start() has
      // reached the first controllable frame.
      document.title = title;
      body.dataset.activeView = gameId;
    },
    showFailure({ gameId, title, message }) {
      showOnlyLifecycle();
      lifecycleView.dataset.state = "failed";
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = message;
      lifecycleEnterButton.hidden = true;
      lifecycleRetryButton.hidden = false;
      document.title = `加载失败 - ${title}`;
      body.dataset.activeView = gameId;
    },
    showGame({ gameId, title }) {
      homeView.hidden = true;
      lifecycleView.hidden = true;
      lifecycleView.dataset.racing = "false";
      for (const [candidateId, candidateView] of Object.entries(gameViews)) {
        candidateView.hidden = candidateId !== gameId;
      }
      document.title = title;
      body.dataset.activeView = gameId;
    },
    showHome() {
      lifecycleView.hidden = true;
      lifecycleView.dataset.racing = "false";
      homeView.hidden = false;
      for (const candidateView of Object.values(gameViews)) candidateView.hidden = true;
      document.title = "ACK Games";
      body.dataset.activeView = "home";
    }
  }
});

window.__ackGamesDebug = window.__ackGamesDebug || {};
window.__ackGamesDebug.lifecycle = Object.freeze({
  getLastLoadReport: () => lifecycle.getLastLoadReport(),
  confirm: () => lifecycle.confirm()
});

function showOnlyLifecycle() {
  homeView.hidden = true;
  lifecycleView.hidden = false;
  for (const candidateView of Object.values(gameViews)) candidateView.hidden = true;
}

function prepareLifecycleGameLayout(gameId) {
  homeView.hidden = true;
  lifecycleView.hidden = false;
  for (const [candidateId, candidateView] of Object.entries(gameViews)) {
    candidateView.hidden = candidateId !== gameId;
  }
}

function scheduleRacingBackdrop() {
  if (lifecycleBackdrop.dataset.loaded === "true") return;
  lifecycleBackdrop.dataset.loaded = "true";
  // The CSS gradient is the immediate, zero-request placeholder. Start the
  // responsive static cover alongside loading, then fade it in as soon as the
  // selected source has decoded; readiness must not gate visual presentation.
  lifecycleBackdropImage.fetchPriority = "low";
  lifecycleBackdropImage.addEventListener("load", () => {
    lifecycleView.dataset.racingBackdrop = "loaded";
  }, { once: true });
  lifecycleBackdropImage.src = "./assets/racing/ready/racing-ready-640.avif";
}

function upgradeRacingBackdrop() {
  if (lifecycleBackdrop.dataset.upgraded === "true") return;
  lifecycleBackdrop.dataset.upgraded = "true";
  const srcset = [
    "./assets/racing/ready/racing-ready-640.avif 640w",
    "./assets/racing/ready/racing-ready-960.avif 960w",
    "./assets/racing/ready/racing-ready-1440.avif 1440w"
  ].join(", ");
  lifecycleBackdropAvif.srcset = srcset;
  lifecycleBackdropAvif.sizes = "(max-width: 720px) 640px, (max-width: 1180px) 960px, 1440px";
  lifecycleBackdropWebp.srcset = srcset.replaceAll(".avif", ".webp");
  lifecycleBackdropWebp.sizes = lifecycleBackdropAvif.sizes;
}

async function confirmLifecycleEntry() {
  if (lifecycleView.dataset.state !== "ready") return false;
  lifecycleEnterButton.disabled = true;
  return lifecycle.confirm();
}

function routeFromLocation() {
  const gameId = location.hash.replace("#", "");
  if (registry[gameId]) {
    void lifecycle.open(gameId, { historyMode: "none" });
  } else {
    void lifecycle.home({ historyMode: gameId ? "replace" : "none" });
  }
}

window.addEventListener("popstate", routeFromLocation);
lifecycleRetryButton.addEventListener("click", () => void lifecycle.retry());
lifecycleHomeButton.addEventListener("click", () => void lifecycle.home());
lifecycleEnterButton.addEventListener("click", () => void confirmLifecycleEntry());
window.addEventListener("keydown", (event) => {
  if (lifecycleView.dataset.state !== "ready" || !["Enter", "NumpadEnter"].includes(event.code)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void confirmLifecycleEntry();
}, true);

let lifecycleGamepadPressed = false;
function pollLifecycleGamepad() {
  const pressed = lifecycleView.dataset.state === "ready" && [...(navigator.getGamepads?.() ?? [])]
    .some((gamepad) => gamepad?.buttons?.[0]?.pressed);
  if (pressed && !lifecycleGamepadPressed) void confirmLifecycleEntry();
  lifecycleGamepadPressed = pressed;
  requestAnimationFrame(pollLifecycleGamepad);
}
requestAnimationFrame(pollLifecycleGamepad);

document.getElementById("typingGarageCard").addEventListener("click", () => void lifecycle.open("typing-garage"));
document.getElementById("vacuumGameCard").addEventListener("click", () => void lifecycle.open("vacuum"));
document.getElementById("tennisGameCard").addEventListener("click", () => void lifecycle.open("tennis"));
document.getElementById("racingGameCard").addEventListener("click", () => {
  void (async () => {
    const { createCoastalFreeCruiseLaunchSnapshot } = await import("./racing-entry.mjs");
    await lifecycle.open("racing", { payload: createCoastalFreeCruiseLaunchSnapshot() });
  })();
});
document.getElementById("racingEditorCard").addEventListener("click", () => void lifecycle.open("racing-select"));
document.getElementById("busRushCard").addEventListener("click", () => void lifecycle.open("bus-rush"));
document.getElementById("typingGarageHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("vacuumHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("tennisHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("busRushHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("racingEditorHomeButton").addEventListener("click", () => void lifecycle.open("racing-select"));

routeFromLocation();
