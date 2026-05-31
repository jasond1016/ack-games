import { createRacingGame } from "./racing-game.js";
import { createVacuumGame } from "./vacuum-game.js";

const homeView = document.getElementById("homeView");
const vacuumView = document.getElementById("vacuumView");
const racingView = document.getElementById("racingView");
const vacuumGameCard = document.getElementById("vacuumGameCard");
const racingGameCard = document.getElementById("racingGameCard");
const vacuumHomeButton = document.getElementById("vacuumHomeButton");
const racingHomeButton = document.getElementById("racingHomeButton");

const games = {
  vacuum: {
    title: "吸尘器接管道 - ACK Games",
    view: vacuumView,
    instance: createVacuumGame()
  },
  racing: {
    title: "3D 赛车 - ACK Games",
    view: racingView,
    instance: createRacingGame()
  }
};

let activeGameId = null;

function showHome(updateHistory = true) {
  stopActiveGame();
  homeView.hidden = false;
  vacuumView.hidden = true;
  racingView.hidden = true;
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
  game.instance.start();

  if (updateHistory) {
    history.pushState({ view: gameId }, "", `#${gameId}`);
  }
}

function stopActiveGame() {
  if (!activeGameId) return;

  games[activeGameId].instance.stop();
  activeGameId = null;
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
vacuumHomeButton.addEventListener("click", () => showHome());
racingHomeButton.addEventListener("click", () => showHome());

routeFromHash(false);
