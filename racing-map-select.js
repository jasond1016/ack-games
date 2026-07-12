import {
  getTrackSurfaceLabel,
  racingMapLibrary
} from "./racing-map.js";
import { getTrackShapeLabel } from "./racing-track.mjs";

export function createRacingMapSelect({ onHome = () => {}, onRace = () => {}, onEdit = () => {} } = {}) {
  const homeButton = document.getElementById("racingMapSelectHomeButton");
  const raceButton = document.getElementById("racingMapSelectRaceButton");
  const editButton = document.getElementById("racingMapSelectEditButton");
  const newButton = document.getElementById("racingMapSelectNewButton");
  const nameValue = document.getElementById("racingMapSelectName");
  const metaValue = document.getElementById("racingMapSelectMeta");
  const presetMaps = document.getElementById("racingPresetMaps");
  const userMaps = document.getElementById("racingUserMaps");
  const userMapsEmpty = document.getElementById("racingUserMapsEmpty");

  let active = false;
  let listening = false;

  function start() {
    active = true;
    render();
    addListeners();
  }

  function stop() {
    active = false;
    removeListeners();
  }

  function destroy() {
    stop();
  }

  function addListeners() {
    if (listening) {
      return;
    }

    homeButton.addEventListener("click", handleHomeClick);
    raceButton.addEventListener("click", handleRaceClick);
    editButton.addEventListener("click", handleEditClick);
    newButton.addEventListener("click", handleNewClick);
    listening = true;
  }

  function removeListeners() {
    if (!listening) {
      return;
    }

    homeButton.removeEventListener("click", handleHomeClick);
    raceButton.removeEventListener("click", handleRaceClick);
    editButton.removeEventListener("click", handleEditClick);
    newButton.removeEventListener("click", handleNewClick);
    listening = false;
  }

  function handleHomeClick() {
    onHome();
  }

  function handleRaceClick() {
    onRace();
  }

  function handleEditClick() {
    try {
      racingMapLibrary.beginEditingSelected();
      onEdit();
    } catch (error) { showLibraryError(error); }
  }

  function handleNewClick() {
    try {
      racingMapLibrary.createUserMap();
      onEdit();
    } catch (error) { showLibraryError(error); }
  }

  function render() {
    if (!active) {
      return;
    }

    const librarySnapshot = racingMapLibrary.snapshot();
    const selected = librarySnapshot.selected;
    const presetEntries = librarySnapshot.presets;
    const userEntries = librarySnapshot.userMaps;

    nameValue.textContent = selected.map.name;
    metaValue.textContent = formatMapMeta(selected);

    presetMaps.replaceChildren(...presetEntries.map((entry) => buildMapCard(entry, selected.mapId)));
    userMaps.replaceChildren(...userEntries.map((entry) => buildMapCard(entry, selected.mapId)));
    userMapsEmpty.hidden = userEntries.length > 0;
  }

  function buildMapCard(entry, selectedMapId) {
    const selected = entry.mapId === selectedMapId;
    const card = document.createElement("article");
    card.className = `map-select-card${selected ? " is-selected" : ""}`;
    card.dataset.mapId = entry.mapId;

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "map-select-card-button";
    selectButton.addEventListener("click", () => {
      try { racingMapLibrary.select(entry.mapId); render(); } catch (error) { showLibraryError(error); }
    });

    const header = document.createElement("div");
    header.className = "map-select-card-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "map-select-card-copy";

    const title = document.createElement("strong");
    title.className = "map-select-card-title";
    title.textContent = entry.map.name;

    const meta = document.createElement("span");
    meta.className = "map-select-card-meta";
    meta.textContent = formatMapMeta(entry);

    titleGroup.append(title, meta);
    header.append(titleGroup);

    if (entry.kind === "user") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "map-select-delete";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        try { racingMapLibrary.deleteUserMap(entry.mapId); render(); } catch (error) { showLibraryError(error); }
      });
      header.append(deleteButton);
    }

    selectButton.append(header);
    card.append(selectButton);
    return card;
  }

  function formatMapMeta(entry) {
    if (entry.map.activity === "free-drive") {
      return `自由驾驶 · ${getTrackSurfaceLabel(entry.map.track.surface)}`;
    }
    return `${getTrackShapeLabel(entry.map.track.shape)} · ${getTrackSurfaceLabel(entry.map.track.surface)}`;
  }

  function showLibraryError(error) {
    metaValue.textContent = error?.message ?? "地图库操作失败。";
    metaValue.classList.add("is-error");
  }

  return { start, stop, destroy };
}

export function createGame(context) {
  return createRacingMapSelect({
    onHome: context.home,
    onRace: () => context.open("racing"),
    onEdit: () => context.open("racing-editor")
  });
}
