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
const lifecycleRetryButton = document.getElementById("gameLifecycleRetryButton");
const lifecycleHomeButton = document.getElementById("gameLifecycleHomeButton");
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
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = "正在加载游戏…";
      lifecycleRetryButton.hidden = true;
      document.title = title;
      body.dataset.activeView = gameId;
    },
    showFailure({ gameId, title, message }) {
      showOnlyLifecycle();
      lifecycleView.dataset.state = "failed";
      lifecycleTitle.textContent = title.replace(" - ACK Games", "");
      lifecycleMessage.textContent = message;
      lifecycleRetryButton.hidden = false;
      document.title = `加载失败 - ${title}`;
      body.dataset.activeView = gameId;
    },
    showGame({ gameId, title }) {
      homeView.hidden = true;
      lifecycleView.hidden = true;
      for (const [candidateId, candidateView] of Object.entries(gameViews)) {
        candidateView.hidden = candidateId !== gameId;
      }
      document.title = title;
      body.dataset.activeView = gameId;
    },
    showHome() {
      lifecycleView.hidden = true;
      homeView.hidden = false;
      for (const candidateView of Object.values(gameViews)) candidateView.hidden = true;
      document.title = "ACK Games";
      body.dataset.activeView = "home";
    }
  }
});

function showOnlyLifecycle() {
  homeView.hidden = true;
  lifecycleView.hidden = false;
  for (const candidateView of Object.values(gameViews)) candidateView.hidden = true;
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

document.getElementById("typingGarageCard").addEventListener("click", () => void lifecycle.open("typing-garage"));
document.getElementById("vacuumGameCard").addEventListener("click", () => void lifecycle.open("vacuum"));
document.getElementById("racingGameCard").addEventListener("click", () => void lifecycle.open("racing-select"));
document.getElementById("racingEditorCard").addEventListener("click", () => void lifecycle.open("racing-select"));
document.getElementById("busRushCard").addEventListener("click", () => void lifecycle.open("bus-rush"));
document.getElementById("typingGarageHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("vacuumHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("busRushHomeButton").addEventListener("click", () => void lifecycle.home());
document.getElementById("racingEditorHomeButton").addEventListener("click", () => void lifecycle.open("racing-select"));

routeFromLocation();
