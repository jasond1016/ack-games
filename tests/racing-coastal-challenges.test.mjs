import assert from "node:assert/strict";
import test from "node:test";

import {
  COASTAL_CHALLENGE_POINTS,
  COASTAL_CHALLENGE_PRESET_MAPS,
  COASTAL_CHALLENGE_REWARD_CAR_IDS,
  COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS,
  COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY,
  createEmptyChallengeUnlockState,
  findActiveChallengePoint,
  isChallengeCarUnlocked,
  isCoastalChallengeRewardCar,
  loadChallengeUnlockState,
  resolveChallengePointPose,
  saveChallengeUnlockState,
  unlockChallengeCar
} from "../racing-coastal-challenges.mjs";

test("四个挑战点与奖励车一一对应且触发半径冻结", () => {
  assert.equal(COASTAL_CHALLENGE_POINTS.length, 4);
  assert.deepEqual(
    COASTAL_CHALLENGE_POINTS.map((point) => point.rewardCarId),
    [...COASTAL_CHALLENGE_REWARD_CAR_IDS]
  );
  assert.equal(COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS, 16);
  assert.equal(COASTAL_CHALLENGE_PRESET_MAPS.length, 4);
  for (const point of COASTAL_CHALLENGE_POINTS) {
    assert.ok(COASTAL_CHALLENGE_PRESET_MAPS.some((entry) => entry.mapId === point.mapId));
  }
});

test("奖励车默认锁定，解锁后持久化", () => {
  const storage = createMemoryStorage();
  assert.equal(isCoastalChallengeRewardCar("bolide"), true);
  assert.equal(isCoastalChallengeRewardCar("aventador"), false);
  assert.equal(isChallengeCarUnlocked("bolide", loadChallengeUnlockState(storage)), false);
  assert.equal(isChallengeCarUnlocked("aventador", loadChallengeUnlockState(storage)), true);

  const unlocked = unlockChallengeCar("bolide", storage);
  assert.deepEqual(unlocked.unlockedCarIds, ["bolide"]);
  assert.equal(storage.getItem(COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY) != null, true);
  assert.equal(isChallengeCarUnlocked("bolide", loadChallengeUnlockState(storage)), true);

  const again = unlockChallengeCar("bolide", storage);
  assert.deepEqual(again.unlockedCarIds, ["bolide"]);
});

test("损坏的解锁存储回退为空集合", () => {
  const storage = createMemoryStorage();
  storage.setItem(COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY, "{not-json");
  assert.deepEqual(loadChallengeUnlockState(storage), createEmptyChallengeUnlockState());
  saveChallengeUnlockState({ unlockedCarIds: ["veneno", "not-a-car"] }, storage);
  assert.deepEqual(loadChallengeUnlockState(storage).unlockedCarIds, ["veneno"]);
});

test("触发区选择最近的挑战点", () => {
  const points = [
    { id: "a", x: 0, z: 0, triggerRadius: 16 },
    { id: "b", x: 10, z: 0, triggerRadius: 16 }
  ];
  assert.equal(findActiveChallengePoint(points, 1, 0).id, "a");
  assert.equal(findActiveChallengePoint(points, 9, 0).id, "b");
  assert.equal(findActiveChallengePoint(points, 40, 0), null);
});

test("挑战点姿态从赛道路线采样", () => {
  const pose = resolveChallengePointPose(
    { trackProgress: 0.5, lateralOffset: 10, headingOffset: 0 },
    () => ({
      center: { x: 100, y: 200 },
      normal: { x: 0, y: 1 },
      heading: 1.2
    })
  );
  assert.deepEqual(pose, { x: 100, z: 210, heading: 1.2, trackProgress: 0.5 });
});

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    }
  };
}
