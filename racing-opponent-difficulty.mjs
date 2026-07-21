/**
 * Opponent difficulty packs for Coastal Island Tour (#9).
 * Scales rival cruise / section pace / nitro only — never player physics.
 */

export const RACING_DIFFICULTY_IDS = Object.freeze(["easy", "standard", "hard"]);
export const DEFAULT_RACING_DIFFICULTY = "standard";

const PROFILES = Object.freeze({
  easy: Object.freeze({
    id: "easy",
    cruiseScale: 0.88,
    roadSectionScale: 0.78,
    rallySectionScale: 0.58,
    boostCharges: 2,
    boostActivationTimesSeconds: Object.freeze([6, 16]),
    playerLeadSpeedCapMeters: 12
  }),
  standard: Object.freeze({
    id: "standard",
    cruiseScale: 1.15,
    roadSectionScale: 0.94,
    rallySectionScale: 0.74,
    boostCharges: 3,
    boostActivationTimesSeconds: Object.freeze([2, 9, 16]),
    playerLeadSpeedCapMeters: 0
  }),
  hard: Object.freeze({
    id: "hard",
    cruiseScale: 1.32,
    roadSectionScale: 1.02,
    rallySectionScale: 0.84,
    boostCharges: 4,
    boostActivationTimesSeconds: Object.freeze([1, 6, 11, 17]),
    playerLeadSpeedCapMeters: 0
  })
});

export function normalizeRacingDifficulty(difficulty) {
  return RACING_DIFFICULTY_IDS.includes(difficulty) ? difficulty : DEFAULT_RACING_DIFFICULTY;
}

export function resolveOpponentDifficultyProfile(difficulty = DEFAULT_RACING_DIFFICULTY) {
  return PROFILES[normalizeRacingDifficulty(difficulty)];
}

export function listRacingDifficulties() {
  return RACING_DIFFICULTY_IDS.map((id) => ({
    id,
    label: id === "easy" ? "EASY" : id === "hard" ? "HARD" : "STANDARD"
  }));
}

/** Spread index ∈ [0,1] → base cruise fraction before difficulty cruiseScale. */
export function resolveTrafficCruiseSpeed({
  maxForwardSpeed,
  index = 0,
  trafficCount = 1,
  difficulty = DEFAULT_RACING_DIFFICULTY
}) {
  const baseFraction = trafficCount > 1
    ? 0.55 + (index / (trafficCount - 1)) * 0.45
    : 1;
  const profile = resolveOpponentDifficultyProfile(difficulty);
  return maxForwardSpeed * baseFraction * profile.cruiseScale;
}

export function resolveShowcaseSectionPaceScale(section, difficulty = DEFAULT_RACING_DIFFICULTY) {
  const profile = resolveOpponentDifficultyProfile(difficulty);
  return section === "rally" ? profile.rallySectionScale : profile.roadSectionScale;
}
