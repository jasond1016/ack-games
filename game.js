import { createRacingGame } from "./racing-game.js";
import { createRacingEditor } from "./racing-editor.js";
import { createRacingMapSelect } from "./racing-map-select.js";
import { createTypingGarageGame } from "./typing-garage-game.js";
import { createVacuumGame } from "./vacuum-game.js";

const body = document.body;
const homeView = document.getElementById("homeView");
const typingGarageView = document.getElementById("typingGarageView");
const vacuumView = document.getElementById("vacuumView");
const racingMapSelectView = document.getElementById("racingMapSelectView");
const racingView = document.getElementById("racingView");
const racingEditorView = document.getElementById("racingEditorView");
const typingGarageCard = document.getElementById("typingGarageCard");
const vacuumGameCard = document.getElementById("vacuumGameCard");
const racingGameCard = document.getElementById("racingGameCard");
const racingEditorCard = document.getElementById("racingEditorCard");
const typingGarageHomeButton = document.getElementById("typingGarageHomeButton");
const vacuumHomeButton = document.getElementById("vacuumHomeButton");
const racingEditorHomeButton = document.getElementById("racingEditorHomeButton");

const games = {
  "typing-garage": {
    title: "超跑图鉴解锁 - ACK Games",
    view: typingGarageView,
    create: () => createTypingGarageGame(),
    instance: null
  },
  vacuum: {
    title: "吸尘器接管道 - ACK Games",
    view: vacuumView,
    create: () => createVacuumGame(),
    instance: null
  },
  "racing-select": {
    title: "赛车地图选择 - ACK Games",
    view: racingMapSelectView,
    create: () => createRacingMapSelect({
      onHome: () => showHome(),
      onRace: () => startGame("racing"),
      onEdit: () => startGame("racing-editor")
    }),
    instance: null
  },
  racing: {
    title: "3D 赛车 - ACK Games",
    view: racingView,
    create: () => createRacingGame({
      onHome: () => showHome(),
      onEditMap: () => startGame("racing-editor")
    }),
    instance: null
  },
  "racing-editor": {
    title: "地图编辑器 - ACK Games",
    view: racingEditorView,
    create: () => createRacingEditor({
      onPlay: () => {
        invalidateGame("racing");
        startGame("racing");
      },
      onMapChanged: () => invalidateGame("racing")
    }),
    instance: null
  }
};

let activeGameId = null;

function showHome(updateHistory = true) {
  stopActiveGame();
  homeView.hidden = false;
  for (const candidate of Object.values(games)) {
    candidate.view.hidden = true;
  }
  document.title = "ACK Games";
  body.dataset.activeView = "home";

  if (updateHistory) {
    history.pushState({ view: "home" }, "", location.pathname);
  }
}

function startGame(gameId, updateHistory = true) {
  const game = games[gameId];
  if (!game) {
    showHome(updateHistory);
    return;
  }

  stopActiveGame();
  if (gameId === "racing") {
    invalidateGame(gameId);
  }
  activeGameId = gameId;
  homeView.hidden = true;

  for (const candidate of Object.values(games)) {
    candidate.view.hidden = candidate !== game;
  }

  document.title = game.title;
  body.dataset.activeView = gameId;
  getGameInstance(gameId).start();

  if (updateHistory) {
    history.pushState({ view: gameId }, "", `#${gameId}`);
  }
}

function stopActiveGame() {
  if (!activeGameId) return;

  games[activeGameId].instance?.stop();
  activeGameId = null;
}

function getGameInstance(gameId) {
  const game = games[gameId];
  if (!game.instance) {
    game.instance = game.create();
  }

  return game.instance;
}

function invalidateGame(gameId) {
  const game = games[gameId];
  if (!game?.instance) {
    return;
  }

  if (activeGameId === gameId) {
    game.instance.stop();
    activeGameId = null;
  }

  if (typeof game.instance.destroy === "function") {
    game.instance.destroy();
  }

  game.instance = null;
}

function routeFromHash(updateHistory = false) {
  const gameId = location.hash.replace("#", "");
  if (games[gameId]) {
    startGame(gameId, updateHistory);
  } else {
    showHome(updateHistory);
  }
}

window.addEventListener("popstate", () => routeFromHash(false));
typingGarageCard.addEventListener("click", () => startGame("typing-garage"));
vacuumGameCard.addEventListener("click", () => startGame("vacuum"));
racingGameCard.addEventListener("click", () => startGame("racing-select"));
racingEditorCard.addEventListener("click", () => startGame("racing-select"));
typingGarageHomeButton.addEventListener("click", () => showHome());
vacuumHomeButton.addEventListener("click", () => showHome());
racingEditorHomeButton.addEventListener("click", () => startGame("racing-select"));

routeFromHash(false);
