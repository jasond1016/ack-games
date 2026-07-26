/**
 * Lobby → Coastal free-cruise launch helpers (#22).
 */
import { racingMapLibrary } from "./racing-map.js";
import {
  RACING_COASTAL_PLAY_MODES,
  loadActiveRacingStartConfig,
  resolveEntryPlayerCarId,
  saveActiveRacingStartConfig
} from "./racing-start-config.js";
import { createRacingSnapshot } from "./racing-session.mjs";

export const COASTAL_FREE_CRUISE_MAP_ID = "preset-coastal-showcase";

export function createCoastalFreeCruiseLaunchSnapshot() {
  const library = racingMapLibrary.snapshot();
  const entry = library.presets.find((preset) => preset.mapId === COASTAL_FREE_CRUISE_MAP_ID)
    ?? library.selected;
  try {
    racingMapLibrary.select(COASTAL_FREE_CRUISE_MAP_ID);
  } catch {
    // Keep whatever is selected if the preset id is unavailable.
  }

  const previous = loadActiveRacingStartConfig();
  const startConfig = saveActiveRacingStartConfig({
    ...previous,
    playerCarId: resolveEntryPlayerCarId(previous.playerCarId),
    coastalPlayMode: RACING_COASTAL_PLAY_MODES.FREE_CRUISE
  });

  return createRacingSnapshot({
    map: entry.map,
    startConfig,
    environmentProfile: entry.environmentProfile ?? "coastal-showcase"
  });
}
