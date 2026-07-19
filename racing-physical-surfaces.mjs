const drivableSurfaceIds = new Set([
  "road",
  "ground",
  "verge",
  "embankment",
  "stunt-ramp",
  "rally-dirt"
]);

export function isPhysicalVehicleSurface(surfaceId) {
  return drivableSurfaceIds.has(surfaceId);
}

export function physicalFallbackGroundHeight(isFreeDrive) {
  return isFreeDrive ? -4 : 0;
}

export function physicalRoadSupportHalfWidth({ halfWidth, centerX, isFreeDrive }) {
  if (!isFreeDrive) return halfWidth;
  return halfWidth + (centerX > 238 ? 4.2 : 1.78);
}

export function createRailColliderGeometry({ deltaX, deltaZ, halfHeight, halfDepth }) {
  const length = Math.hypot(deltaX, deltaZ);
  if (![length, halfHeight, halfDepth].every(Number.isFinite) || length <= 0.01) return null;

  return Object.freeze({
    yaw: Math.atan2(deltaX, deltaZ),
    halfExtents: Object.freeze({ x: halfDepth, y: halfHeight, z: length * 0.5 })
  });
}
