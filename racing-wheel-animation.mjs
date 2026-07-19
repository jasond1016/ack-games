const INDIVIDUAL_WHEEL_PATTERN = /(?:^|[_\s:\-.])(tires?|tyres?|rims?|wheels?)(?:[_\s:\-.]|$)/i;

export function isWheelVisualLabel(label = "") {
  const normalized = String(label);
  return !/steering[_\s:-]*wheel/i.test(normalized) && INDIVIDUAL_WHEEL_PATTERN.test(normalized);
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

  const splitX = (bounds.minX + bounds.maxX) * 0.5;
  const sizeX = Math.abs(bounds.maxX - bounds.minX);
  const sizeY = Math.abs(bounds.maxY - bounds.minY);
  const sizeZ = Math.abs(bounds.maxZ - bounds.minZ);
  const longitudinalAxis = sizeY > sizeZ ? "y" : "z";
  const splitLongitudinal = longitudinalAxis === "y"
    ? (bounds.minY + bounds.maxY) * 0.5
    : (bounds.minZ + bounds.maxZ) * 0.5;
  const quadrants = Array.from({ length: 4 }, createBounds);
  const sides = Array.from({ length: 2 }, createBounds);
  for (let offset = 0; offset + 2 < positionArray.length; offset += itemSize) {
    const x = positionArray[offset];
    const y = positionArray[offset + 1];
    const z = positionArray[offset + 2];
    const longitudinal = longitudinalAxis === "y" ? y : z;
    const index = (longitudinal < splitLongitudinal ? 2 : 0) + (x >= splitX ? 1 : 0);
    expandBounds(quadrants[index], x, y, z);
    expandBounds(sides[x >= splitX ? 1 : 0], x, y, z);
  }

  const longitudinalSize = Math.max(sizeY, sizeZ);
  const transverseSize = Math.min(sizeY, sizeZ);
  const hasFourWheels = quadrants.every((quadrant) => quadrant.count >= 4)
    && sizeX > transverseSize * 1.4
    && longitudinalSize > transverseSize * 1.4;
  const hasAxlePair = !hasFourWheels
    && sides.every((side) => side.count >= 4)
    && sizeX > Math.max(sizeY, sizeZ) * 1.4;
  const selectedBounds = hasFourWheels ? quadrants : hasAxlePair ? sides : [bounds];
  return Object.freeze({
    combined: hasFourWheels || hasAxlePair,
    type: hasFourWheels ? "four-wheel" : hasAxlePair ? "axle-pair" : "single",
    splitX,
    splitLongitudinal,
    longitudinalAxis,
    centers: Object.freeze(selectedBounds.map((entry) => Object.freeze({
      x: (entry.minX + entry.maxX) * 0.5,
      y: (entry.minY + entry.maxY) * 0.5,
      z: (entry.minZ + entry.maxZ) * 0.5
    })))
  });
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
