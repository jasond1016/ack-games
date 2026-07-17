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
