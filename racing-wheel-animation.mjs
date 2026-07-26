const INDIVIDUAL_WHEEL_PATTERN = /(?:^|[_\s:\-.])(tires?|tyres?|rims?|wheels?)(?:[_\s:\-.]|$)/i;
const WHEEL_ROLES = Object.freeze([
  Object.freeze({ id: "caliper", pattern: /(?:^|[_\s:\-.])calipers?(?:[_\s:\-.]|$)/i, roll: false, steer: true }),
  Object.freeze({ id: "rotor", pattern: /(?:^|[_\s:\-.])(?:brake[_\s:\-.]*)?(?:rotors?|discs?)(?:[_\s:\-.]|$)/i, roll: true, steer: true }),
  Object.freeze({ id: "tire", pattern: /(?:^|[_\s:\-.])(?:tires?|tyres?)(?:[_\s:\-.]|$)/i, roll: true, steer: true }),
  Object.freeze({ id: "rim", pattern: /(?:^|[_\s:\-.])rims?(?:[_\s:\-.]|$)/i, roll: true, steer: true }),
  Object.freeze({ id: "hub", pattern: /(?:^|[_\s:\-.])(?:hubs?|logos?)(?:[_\s:\-.]|$)/i, roll: true, steer: true }),
  Object.freeze({ id: "wheel", pattern: INDIVIDUAL_WHEEL_PATTERN, roll: true, steer: true })
]);

export function isWheelVisualLabel(label = "") {
  return Boolean(classifyWheelVisualRole(label));
}

export function classifyWheelVisualRole(label = "") {
  const normalized = String(label);
  if (/steering[_\s:-]*wheel/i.test(normalized)) return null;
  const role = WHEEL_ROLES.find(({ pattern }) => pattern.test(normalized));
  if (role?.id === "hub" && !INDIVIDUAL_WHEEL_PATTERN.test(normalized)) return null;
  return role
    ? Object.freeze({ id: role.id, roll: role.roll, steer: role.steer })
    : null;
}

export function resolveWheelAnimationAxes(longitudinalAxis = "z") {
  if (longitudinalAxis && typeof longitudinalAxis === "object") {
    return Object.freeze({
      roll: longitudinalAxis.transverseAxis ?? "x",
      steer: longitudinalAxis.verticalAxis ?? (
        longitudinalAxis.longitudinalAxis === "y" ? "z" : "y"
      )
    });
  }
  const normalizedLongitudinal = longitudinalAxis === "y" ? "y" : "z";
  return Object.freeze({
    roll: "x",
    steer: normalizedLongitudinal === "y" ? "z" : "y"
  });
}

export function findWheelGeometryLayout(positionArray, itemSize = 3) {
  if (!positionArray || itemSize < 3 || positionArray.length < itemSize * 4) {
    return null;
  }

  const bounds = createBounds();
  for (let offset = 0; offset + 2 < positionArray.length; offset += itemSize) {
    expandBounds(bounds, positionArray[offset], positionArray[offset + 1], positionArray[offset + 2]);
  }
  if (!isFiniteBounds(bounds)) return null;

  const axisEntries = [
    { axis: "x", size: Math.abs(bounds.maxX - bounds.minX) },
    { axis: "y", size: Math.abs(bounds.maxY - bounds.minY) },
    { axis: "z", size: Math.abs(bounds.maxZ - bounds.minZ) }
  ].sort((left, right) => right.size - left.size);
  const [longitudinalEntry, transverseEntry, verticalEntry] = axisEntries;
  const longitudinalAxis = longitudinalEntry.axis;
  const transverseAxis = transverseEntry.axis;
  const verticalAxis = verticalEntry.axis;
  const splitLongitudinal = axisMidpoint(bounds, longitudinalAxis);
  const splitTransverse = axisMidpoint(bounds, transverseAxis);
  const quadrants = Array.from({ length: 4 }, createAccumBounds);
  const sides = Array.from({ length: 2 }, createAccumBounds);
  for (let offset = 0; offset + 2 < positionArray.length; offset += itemSize) {
    const x = positionArray[offset];
    const y = positionArray[offset + 1];
    const z = positionArray[offset + 2];
    const point = { x, y, z };
    const longitudinal = point[longitudinalAxis];
    const transverse = point[transverseAxis];
    const index = (longitudinal < splitLongitudinal ? 2 : 0)
      + (transverse >= splitTransverse ? 1 : 0);
    accumulatePoint(quadrants[index], x, y, z);
    const axleAxis = axisEntries[0].axis;
    accumulatePoint(sides[point[axleAxis] >= axisMidpoint(bounds, axleAxis) ? 1 : 0], x, y, z);
  }

  const hasFourWheels = quadrants.every((quadrant) => quadrant.count >= 4)
    && longitudinalEntry.size > verticalEntry.size * 1.4
    && transverseEntry.size > verticalEntry.size * 1.4;
  const hasAxlePair = !hasFourWheels
    && sides.every((side) => side.count >= 4)
    && axisEntries[0].size > axisEntries[1].size * 1.4;
  const selectedBounds = hasFourWheels ? quadrants : hasAxlePair ? sides : [accumFromBounds(bounds)];
  const centers = selectedBounds.map((entry) => meanPoint(entry));
  // Radius limit keeps shader spin from orbiting stray/outlier verts (looks like
  // wheels flying off the car when a combined tire mesh has junk far from hubs).
  const radiusLimit = Math.max(
    0.55,
    ...selectedBounds.map((entry) => robustRadius(entry, meanPoint(entry)) * 1.35)
  );
  return Object.freeze({
    combined: hasFourWheels || hasAxlePair,
    type: hasFourWheels ? "four-wheel" : hasAxlePair ? "axle-pair" : "single",
    splitX: splitTransverse,
    splitTransverse,
    splitLongitudinal,
    longitudinalAxis,
    transverseAxis: hasAxlePair ? axisEntries[0].axis : transverseAxis,
    verticalAxis,
    radiusLimit,
    centers: Object.freeze(centers.map((entry) => Object.freeze(entry)))
  });
}

function axisMidpoint(bounds, axis) {
  const upper = axis.toUpperCase();
  return (bounds[`min${upper}`] + bounds[`max${upper}`]) * 0.5;
}

export function createWheelAnimationState({ spinAngle = 0, steeringAngle = 0 } = {}) {
  return Object.freeze({
    spinAngle: Number.isFinite(spinAngle) ? spinAngle : 0,
    steeringAngle: Number.isFinite(steeringAngle) ? steeringAngle : 0
  });
}

export function advanceWheelSpin({
  spinAngle = 0,
  signedSpeed = 0,
  deltaSeconds = 0,
  wheelRadius = 0.4,
  stopSpeed = 0.08
} = {}) {
  if (![spinAngle, signedSpeed, deltaSeconds, wheelRadius].every(Number.isFinite) || wheelRadius <= 0) {
    return Number.isFinite(spinAngle) ? spinAngle : 0;
  }
  if (Math.abs(signedSpeed) <= stopSpeed || deltaSeconds <= 0) return spinAngle;
  const nextAngle = spinAngle + (signedSpeed * deltaSeconds) / wheelRadius;
  return Math.atan2(Math.sin(nextAngle), Math.cos(nextAngle));
}

function createBounds() {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    count: 0
  };
}

function createAccumBounds() {
  return {
    ...createBounds(),
    sumX: 0,
    sumY: 0,
    sumZ: 0
  };
}

function expandBounds(bounds, x, y, z) {
  if (![x, y, z].every(Number.isFinite)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.maxZ = Math.max(bounds.maxZ, z);
  bounds.count += 1;
}

function accumulatePoint(bounds, x, y, z) {
  if (![x, y, z].every(Number.isFinite)) return;
  expandBounds(bounds, x, y, z);
  bounds.sumX += x;
  bounds.sumY += y;
  bounds.sumZ += z;
}

function meanPoint(bounds) {
  if (!bounds.count) {
    return {
      x: (bounds.minX + bounds.maxX) * 0.5,
      y: (bounds.minY + bounds.maxY) * 0.5,
      z: (bounds.minZ + bounds.maxZ) * 0.5
    };
  }
  return {
    x: bounds.sumX / bounds.count,
    y: bounds.sumY / bounds.count,
    z: bounds.sumZ / bounds.count
  };
}

function accumFromBounds(bounds) {
  const midX = (bounds.minX + bounds.maxX) * 0.5;
  const midY = (bounds.minY + bounds.maxY) * 0.5;
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
  return {
    ...bounds,
    sumX: midX * Math.max(1, bounds.count),
    sumY: midY * Math.max(1, bounds.count),
    sumZ: midZ * Math.max(1, bounds.count)
  };
}

/** Prefer dense-core radius over AABB diagonal so stray verts don't inflate the hub. */
function robustRadius(bounds, center) {
  if (!bounds.count) return 0.55;
  const extentRadius = 0.5 * Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ
  );
  // Cap by a generous tire radius relative to lateral/vertical AABB only.
  const tireLike = 0.55 * Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY
  );
  return Math.min(extentRadius, Math.max(0.45, tireLike));
}

function isFiniteBounds(bounds) {
  return bounds.count > 0 && [
    bounds.minX,
    bounds.minY,
    bounds.minZ,
    bounds.maxX,
    bounds.maxY,
    bounds.maxZ
  ].every(Number.isFinite);
}
