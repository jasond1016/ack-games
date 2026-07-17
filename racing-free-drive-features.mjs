export const FREE_DRIVE_TUNNEL = Object.freeze({
  startProgress: 0.765,
  endProgress: 0.825,
  segmentCount: 18,
  wallHeight: 6.4,
  wallThickness: 1.15,
  shoulderClearance: 1.3,
  roofThickness: 1.05
});

export function createFreeDriveTunnelSegments({
  sampleTrack,
  elevationAt,
  config = FREE_DRIVE_TUNNEL
}) {
  if (typeof sampleTrack !== "function" || typeof elevationAt !== "function") return [];
  const segments = [];
  for (let index = 0; index < config.segmentCount; index += 1) {
    const progressStart = config.startProgress
      + (config.endProgress - config.startProgress) * (index / config.segmentCount);
    const progressEnd = config.startProgress
      + (config.endProgress - config.startProgress) * ((index + 1) / config.segmentCount);
    const start = sampleTrack(progressStart);
    const end = sampleTrack(progressEnd);
    const dx = end.center.x - start.center.x;
    const dz = end.center.y - start.center.y;
    const length = Math.hypot(dx, dz);
    if (length <= 0.01) continue;
    const x = (start.center.x + end.center.x) * 0.5;
    const z = (start.center.y + end.center.y) * 0.5;
    const yaw = Math.atan2(dx, dz);
    const normalX = Math.cos(yaw);
    const normalZ = -Math.sin(yaw);
    const roadHeight = 0.06 + (elevationAt(progressStart) + elevationAt(progressEnd)) * 0.5;
    const innerHalfWidth = Math.max(start.halfWidth, end.halfWidth) + config.shoulderClearance;
    const wallOffset = innerHalfWidth + config.wallThickness * 0.5;
    segments.push(Object.freeze({
      index,
      progressStart,
      progressEnd,
      x,
      z,
      yaw,
      length: length + 0.35,
      roadHeight,
      innerHalfWidth,
      wallHeight: config.wallHeight,
      wallThickness: config.wallThickness,
      roofThickness: config.roofThickness,
      roofWidth: wallOffset * 2 + config.wallThickness,
      walls: Object.freeze([-1, 1].map((side) => Object.freeze({
        x: x + normalX * wallOffset * side,
        y: roadHeight + config.wallHeight * 0.5,
        z: z + normalZ * wallOffset * side,
        width: config.wallThickness,
        height: config.wallHeight,
        depth: length + 0.35,
        yaw,
        tag: "tunnel-wall"
      }))),
      roof: Object.freeze({
        x,
        y: roadHeight + config.wallHeight + config.roofThickness * 0.5,
        z,
        width: wallOffset * 2 + config.wallThickness,
        height: config.roofThickness,
        depth: length + 0.35,
        yaw,
        tag: "tunnel-roof"
      })
    }));
  }
  return Object.freeze(segments);
}
