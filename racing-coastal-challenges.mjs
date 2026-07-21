import { TRACK_SHAPES } from "./racing-track.mjs";

export const COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY = "ack-games:racing-challenge-unlocks:v1";
export const COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS = 16;

/** Reward cars locked until the matching Coastal challenge is won. */
export const COASTAL_CHALLENGE_REWARD_CAR_IDS = Object.freeze([
  "bolide",
  "veneno",
  "centodieci",
  "dbr9"
]);

const REWARD_CAR_ID_SET = new Set(COASTAL_CHALLENGE_REWARD_CAR_IDS);

/**
 * Four Coastal free-cruise challenge points.
 * Positions resolve from trackProgress + lateralOffset at runtime.
 */
export const COASTAL_CHALLENGE_POINTS = Object.freeze([
  Object.freeze({
    id: "challenge-bolide",
    rewardCarId: "bolide",
    mapId: "preset-challenge-bolide",
    label: "Bolide",
    trackProgress: 0.11,
    lateralOffset: -20,
    triggerRadius: COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS,
    headingOffset: Math.PI * 0.5
  }),
  Object.freeze({
    id: "challenge-veneno",
    rewardCarId: "veneno",
    mapId: "preset-challenge-veneno",
    label: "Veneno",
    trackProgress: 0.34,
    lateralOffset: 22,
    triggerRadius: COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS,
    headingOffset: 0
  }),
  Object.freeze({
    id: "challenge-centodieci",
    rewardCarId: "centodieci",
    mapId: "preset-challenge-centodieci",
    label: "Centodieci",
    trackProgress: 0.63,
    lateralOffset: -24,
    triggerRadius: COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS,
    headingOffset: Math.PI
  }),
  Object.freeze({
    id: "challenge-dbr9",
    rewardCarId: "dbr9",
    mapId: "preset-challenge-dbr9",
    label: "DBR9",
    trackProgress: 0.86,
    lateralOffset: 20,
    triggerRadius: COASTAL_CHALLENGE_TRIGGER_RADIUS_METERS,
    headingOffset: -Math.PI * 0.5
  })
]);

export function isCoastalChallengeRewardCar(carId) {
  return REWARD_CAR_ID_SET.has(carId);
}

export function getCoastalChallengePointById(pointId) {
  return COASTAL_CHALLENGE_POINTS.find((point) => point.id === pointId) ?? null;
}

export function getCoastalChallengePointByRewardCarId(carId) {
  return COASTAL_CHALLENGE_POINTS.find((point) => point.rewardCarId === carId) ?? null;
}

export function createEmptyChallengeUnlockState() {
  return Object.freeze({ unlockedCarIds: Object.freeze([]) });
}

export function normalizeChallengeUnlockState(raw) {
  if (!raw || typeof raw !== "object") return createEmptyChallengeUnlockState();
  const unlockedCarIds = Array.isArray(raw.unlockedCarIds)
    ? [...new Set(raw.unlockedCarIds.filter((id) => isCoastalChallengeRewardCar(id)))]
    : [];
  return Object.freeze({ unlockedCarIds: Object.freeze(unlockedCarIds) });
}

export function loadChallengeUnlockState(storage = globalThis.localStorage) {
  if (!storage?.getItem) return createEmptyChallengeUnlockState();
  try {
    const serialized = storage.getItem(COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY);
    if (!serialized) return createEmptyChallengeUnlockState();
    return normalizeChallengeUnlockState(JSON.parse(serialized));
  } catch {
    return createEmptyChallengeUnlockState();
  }
}

export function saveChallengeUnlockState(state, storage = globalThis.localStorage) {
  const normalized = normalizeChallengeUnlockState(state);
  if (storage?.setItem) {
    try {
      storage.setItem(COASTAL_CHALLENGE_UNLOCK_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // ignore quota / private mode
    }
  }
  return normalized;
}

export function isChallengeCarUnlocked(carId, state = loadChallengeUnlockState()) {
  if (!isCoastalChallengeRewardCar(carId)) return true;
  return state.unlockedCarIds.includes(carId);
}

export function unlockChallengeCar(carId, storage = globalThis.localStorage) {
  if (!isCoastalChallengeRewardCar(carId)) {
    return loadChallengeUnlockState(storage);
  }
  const current = loadChallengeUnlockState(storage);
  if (current.unlockedCarIds.includes(carId)) return current;
  return saveChallengeUnlockState({
    unlockedCarIds: [...current.unlockedCarIds, carId]
  }, storage);
}

export function resolveChallengePointPose(point, sampleTrack) {
  if (!point || typeof sampleTrack !== "function") return null;
  const sample = sampleTrack(point.trackProgress);
  if (!sample?.center || !sample?.normal) return null;
  const x = sample.center.x + sample.normal.x * point.lateralOffset;
  const z = sample.center.y + sample.normal.y * point.lateralOffset;
  const heading = sample.heading + (point.headingOffset ?? 0);
  return Object.freeze({ x, z, heading, trackProgress: point.trackProgress });
}

export function findActiveChallengePoint(points, playerX, playerZ) {
  if (!Array.isArray(points) || ![playerX, playerZ].every(Number.isFinite)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    if (![point?.x, point?.z, point?.triggerRadius].every(Number.isFinite)) continue;
    const distance = Math.hypot(playerX - point.x, playerZ - point.z);
    if (distance <= point.triggerRadius && distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function challengeMapTemplate({ name, controlPoints, shape = TRACK_SHAPES.OPEN, width = 14 }) {
  const track = {
    shape,
    surface: "asphalt",
    width,
    samples: 480,
    controlPoints: controlPoints.map((point) => Object.freeze([...point]))
  };
  if (shape === TRACK_SHAPES.LOOP) {
    track.startPosition = Object.freeze({ progress: 0.02 });
  }
  return Object.freeze({
    version: 3,
    name,
    activity: "race",
    track: Object.freeze(track)
  });
}

/** Pre-designed race maps for each Coastal challenge point. */
export const COASTAL_CHALLENGE_PRESET_MAPS = Object.freeze([
  Object.freeze({
    mapId: "preset-challenge-bolide",
    kind: "preset",
    map: challengeMapTemplate({
      name: "挑战·Bolide 海岬冲刺",
      controlPoints: [
        [-120, 0], [-60, -24], [20, -48], [100, -36], [180, 20],
        [240, 90], [250, 170], [200, 250], [100, 280], [0, 240],
        [-60, 160], [-100, 80]
      ]
    })
  }),
  Object.freeze({
    mapId: "preset-challenge-veneno",
    kind: "preset",
    map: challengeMapTemplate({
      name: "挑战·Veneno 港湾环",
      shape: TRACK_SHAPES.LOOP,
      width: 15,
      controlPoints: [
        [-140, -40], [-40, -100], [80, -90], [180, -20], [200, 80],
        [120, 160], [0, 180], [-100, 120], [-150, 40]
      ]
    })
  }),
  Object.freeze({
    mapId: "preset-challenge-centodieci",
    kind: "preset",
    map: challengeMapTemplate({
      name: "挑战·Centodieci 悬崖折返",
      controlPoints: [
        [0, -80], [90, -140], [200, -110], [300, -20], [340, 80],
        [300, 180], [180, 230], [60, 200], [0, 120], [-20, 20],
        [40, -40]
      ]
    })
  }),
  Object.freeze({
    mapId: "preset-challenge-dbr9",
    kind: "preset",
    map: challengeMapTemplate({
      name: "挑战·DBR9 林荫短圈",
      shape: TRACK_SHAPES.LOOP,
      width: 13,
      controlPoints: [
        [-120, 0], [-40, -90], [80, -110], [180, -50], [200, 50],
        [100, 130], [-20, 140], [-110, 70]
      ]
    })
  })
]);

export function createChallengeRaceSnapshotFields(point, {
  playerCarId,
  cameraMode,
  difficulty,
  coastalPlayMode,
  returnMap,
  returnEnvironmentProfile,
  returnStartConfig
}) {
  return Object.freeze({
    pointId: point.id,
    rewardCarId: point.rewardCarId,
    mapId: point.mapId,
    returnTo: Object.freeze({
      map: returnMap,
      environmentProfile: returnEnvironmentProfile,
      startConfig: Object.freeze({ ...returnStartConfig })
    }),
    launchStartConfig: Object.freeze({
      version: 4,
      playerCarId,
      cameraMode,
      coastalPlayMode,
      difficulty,
      forcedOpponentCarId: point.rewardCarId
    })
  });
}
