const drivableSurfaceIds = new Set([
  "road",
  "gravel",
  "ground",
  "verge",
  "embankment",
  "stunt-ramp",
  "rally-dirt",
  "bridge"
]);

/** On-track contact surfaces for proving-ground roadContactRatio (G6). */
const provingTrackContactSurfaceIds = new Set([
  "road",
  "gravel",
  "bridge"
]);

/**
 * CONTEXT: off-road grass soft-caps top speed ~10% below road, with mild extra
 * rolling resistance — never a sudden hard stop.
 */
const surfaceTopSpeedScaleById = Object.freeze({
  road: 1,
  bridge: 1,
  gravel: 0.97,
  "rally-dirt": 0.94,
  verge: 0.93,
  embankment: 0.91,
  "stunt-ramp": 0.98,
  ground: 0.85
});

const surfaceRollingDragScaleById = Object.freeze({
  road: 1,
  bridge: 1,
  gravel: 1.08,
  "rally-dirt": 1.12,
  verge: 1.1,
  embankment: 1.14,
  "stunt-ramp": 1.02,
  ground: 1.08
});

export function isPhysicalVehicleSurface(surfaceId) {
  return drivableSurfaceIds.has(surfaceId);
}

export function isProvingTrackContactSurface(surfaceId) {
  return provingTrackContactSurfaceIds.has(surfaceId);
}

/**
 * Map collider/sample tags onto the driving surface the tires should feel.
 * Gravel track maps keep geometry tagged as road for support, but driving grip
 * must resolve to `gravel` (G4).
 */
export function resolveDrivingSurfaceId(surfaceId, trackSurface = "asphalt") {
  if (surfaceId === "road" && trackSurface === "gravel") return "gravel";
  return surfaceId ?? "road";
}

export function surfaceTopSpeedScale(surfaceId = "road") {
  return surfaceTopSpeedScaleById[surfaceId] ?? 1;
}

export function surfaceRollingDragScale(surfaceId = "road") {
  return surfaceRollingDragScaleById[surfaceId] ?? 1;
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
