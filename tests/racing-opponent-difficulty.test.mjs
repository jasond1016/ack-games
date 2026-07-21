import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RACING_DIFFICULTY,
  normalizeRacingDifficulty,
  resolveOpponentDifficultyProfile,
  resolveShowcaseSectionPaceScale,
  resolveTrafficCruiseSpeed
} from "../racing-opponent-difficulty.mjs";

test("难度 id 归一化，默认 standard", () => {
  assert.equal(normalizeRacingDifficulty("easy"), "easy");
  assert.equal(normalizeRacingDifficulty("hard"), "hard");
  assert.equal(normalizeRacingDifficulty("bogus"), DEFAULT_RACING_DIFFICULTY);
  assert.equal(normalizeRacingDifficulty(undefined), "standard");
});

test("三档对手巡航单调加压且 standard 高于现网基线包络", () => {
  const maxForwardSpeed = 50;
  const easy = resolveTrafficCruiseSpeed({ maxForwardSpeed, index: 2, trafficCount: 3, difficulty: "easy" });
  const standard = resolveTrafficCruiseSpeed({ maxForwardSpeed, index: 2, trafficCount: 3, difficulty: "standard" });
  const hard = resolveTrafficCruiseSpeed({ maxForwardSpeed, index: 2, trafficCount: 3, difficulty: "hard" });
  assert.ok(easy < standard && standard < hard);

  // Legacy Tour used max * (0.55..1) with no cruiseScale (=1). Standard must press harder.
  const legacyTop = maxForwardSpeed * 1;
  assert.ok(standard > legacyTop * 0.9);
  assert.ok(resolveOpponentDifficultyProfile("standard").cruiseScale > 1);
});

test("路段系数随难度上升，rally 始终低于同档 road", () => {
  for (const difficulty of ["easy", "standard", "hard"]) {
    const road = resolveShowcaseSectionPaceScale("road", difficulty);
    const rally = resolveShowcaseSectionPaceScale("rally", difficulty);
    assert.ok(rally < road);
  }
  assert.ok(
    resolveShowcaseSectionPaceScale("road", "easy")
      < resolveShowcaseSectionPaceScale("road", "standard")
  );
  assert.ok(
    resolveShowcaseSectionPaceScale("road", "standard")
      < resolveShowcaseSectionPaceScale("road", "hard")
  );
});

test("氮气次数与时刻按档区分", () => {
  const easy = resolveOpponentDifficultyProfile("easy");
  const standard = resolveOpponentDifficultyProfile("standard");
  const hard = resolveOpponentDifficultyProfile("hard");
  assert.equal(easy.boostCharges, 2);
  assert.equal(standard.boostCharges, 3);
  assert.equal(hard.boostCharges, 4);
  assert.ok(easy.boostActivationTimesSeconds[0] > standard.boostActivationTimesSeconds[0]);
  assert.ok(hard.boostActivationTimesSeconds.length > standard.boostActivationTimesSeconds.length);
});
