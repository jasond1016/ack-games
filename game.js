import { createRacingGame } from "./racing-game.js";
import { createRacingEditor } from "./racing-editor.js";
import { createVacuumGame } from "./vacuum-game.js";

const homeView = document.getElementById("homeView");
const vacuumView = document.getElementById("vacuumView");
const racingView = document.getElementById("racingView");
const racingEditorView = document.getElementById("racingEditorView");
const vacuumGameCard = document.getElementById("vacuumGameCard");
const racingGameCard = document.getElementById("racingGameCard");
const racingEditorCard = document.getElementById("racingEditorCard");
const vacuumHomeButton = document.getElementById("vacuumHomeButton");
const racingHomeButton = document.getElementById("racingHomeButton");
const racingEditorHomeButton = document.getElementById("racingEditorHomeButton");
const racingEditorButton = document.getElementById("racingEditorButton");

const games = {
  vacuum: {
    title: "吸尘器接管道 - ACK Games",
    view: vacuumView,
    create: () => createVacuumGame(),
    instance: null
  },
  racing: {
    title: "3D 赛车 - ACK Games",
    view: racingView,
    create: () => createRacingGame(),
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
  activeGameId = gameId;
  homeView.hidden = true;

  for (const candidate of Object.values(games)) {
    candidate.view.hidden = candidate !== game;
  }

  document.title = game.title;
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
vacuumGameCard.addEventListener("click", () => startGame("vacuum"));
racingGameCard.addEventListener("click", () => startGame("racing"));
racingEditorCard.addEventListener("click", () => startGame("racing-editor"));
vacuumHomeButton.addEventListener("click", () => showHome());
racingHomeButton.addEventListener("click", () => showHome());
racingEditorHomeButton.addEventListener("click", () => showHome());
racingEditorButton.addEventListener("click", () => startGame("racing-editor"));

routeFromHash(false);
