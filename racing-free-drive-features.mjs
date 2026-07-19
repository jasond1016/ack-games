export const FREE_DRIVE_TUNNEL = Object.freeze({
  startProgress: 0.765,
  endProgress: 0.825,
  segmentCount: 18,
  wallHeight: 6.4,
  wallThickness: 1.15,
  shoulderClearance: 1.3,
  roofThickness: 1.05
});

export const FREE_DRIVE_RALLY = Object.freeze({
  startProgress: 0.895,
  endProgress: 0.975,
  sampleCount: 72,
  halfWidth: 4.6,
  surfaceOffset: 0.09,
  maximumGrade: 0.42,
  surfaceId: "rally-dirt",
  waypoints: Object.freeze([
    Object.freeze({ x: -91, z: 48 }),
    Object.freeze({ x: -70, z: 38 }),
    Object.freeze({ x: -61, z: 21 }),
    Object.freeze({ x: -75, z: 7 }),
    Object.freeze({ x: -63, z: -11 }),
    Object.freeze({ x: -76, z: -30 })
  ])
});

export const FREE_DRIVE_SHOWCASE = Object.freeze({
  trackProgresses: Object.freeze([0.03, 0.24, 0.48, 0.68, 0.795, 0.895]),
  rallyProgresses: Object.freeze([0.5, 1]),
  gateRadius: 10
});

export function createFreeDriveShowcaseRoute({
  sampleTrack,
  elevationAt,
  rallyRoute,
  config = FREE_DRIVE_SHOWCASE
} = {}) {
  if (typeof sampleTrack !== "function" || typeof elevationAt !== "function" || !rallyRoute?.length) return [];
  const trackCheckpoints = config.trackProgresses.map((progress, index) => {
    const sample = sampleTrack(progress);
    return showcaseCheckpoint({
      x: sample.center.x,
      y: elevationAt(progress),
      z: sample.center.y,
      heading: sample.heading,
      normalX: sample.normal.x,
      normalZ: sample.normal.y,
      section: index === 0
        ? "start"
        : progress >= FREE_DRIVE_RALLY.startProgress
          ? "rally"
          : progress >= FREE_DRIVE_TUNNEL.startProgress && progress <= FREE_DRIVE_TUNNEL.endProgress
            ? "tunnel"
            : "road"
    });
  });
  const rallyCheckpoints = config.rallyProgresses.map((progress) => {
    const sample = rallyRoute[Math.round((rallyRoute.length - 1) * progress)];
    return showcaseCheckpoint({ ...sample, heading: Math.atan2(sample.tangentX, sample.tangentZ), section: "rally" });
  });
  return Object.freeze([
    ...trackCheckpoints,
    ...rallyCheckpoints,
    Object.freeze({ ...trackCheckpoints[0], section: "finish" })
  ]);
}

export function createFreeDriveShowcaseDrivingLine({
  sampleTrack,
  elevationAt,
  rallyRoute,
  trackSampleCount = 520
} = {}) {
  if (typeof sampleTrack !== "function" || typeof elevationAt !== "function" || rallyRoute?.length < 2) return [];
  const points = [];
  const append = (sample, section) => {
    const previous = points.at(-1);
    if (previous && Math.hypot(sample.x - previous.x, sample.z - previous.z) < 0.001) return;
    const distance = (previous?.distance ?? 0) + (previous
      ? Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z)
      : 0);
    points.push({ ...sample, section, distance });
  };
  const appendTrackRange = (start, end) => {
    const span = end - start;
    const count = Math.max(2, Math.ceil(trackSampleCount * span));
    for (let index = 0; index <= count; index += 1) {
      const progress = start + span * index / count;
      const wrapped = progress >= 1 ? progress - 1 : progress;
      const sample = sampleTrack(wrapped);
      append({
        x: sample.center.x,
        y: elevationAt(wrapped),
        z: sample.center.y,
        heading: sample.heading,
        tangentX: Math.sin(sample.heading),
        tangentZ: Math.cos(sample.heading),
        normalX: sample.normal.x,
        normalZ: sample.normal.y,
        trackProgress: wrapped
      }, wrapped >= FREE_DRIVE_TUNNEL.startProgress && wrapped <= FREE_DRIVE_TUNNEL.endProgress ? "tunnel" : "road");
    }
  };
  appendTrackRange(0.03, FREE_DRIVE_RALLY.startProgress);
  for (const sample of rallyRoute) append({
    ...sample,
    heading: Math.atan2(sample.tangentX, sample.tangentZ),
    normalX: -sample.tangentZ,
    normalZ: sample.tangentX
  }, "rally");
  appendTrackRange(FREE_DRIVE_RALLY.endProgress, 1.03);
  if (points.length) points[0].section = "start";
  if (points.length > 1) points.at(-1).section = "finish";
  return Object.freeze(points.map((point) => Object.freeze(point)));
}

export function sampleFreeDriveShowcaseDrivingLine(route, requestedDistance) {
  if (!Array.isArray(route) || route.length < 2) return null;
  const total = route.at(-1).distance;
  let distance = Number.isFinite(requestedDistance) ? requestedDistance : 0;
  if (distance < 0) distance = Math.max(0, total + distance);
  distance = Math.min(total, distance);
  let low = 0;
  let high = route.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (route[middle].distance <= distance) low = middle;
    else high = middle;
  }
  const start = route[low];
  const end = route[high];
  const span = Math.max(0.0001, end.distance - start.distance);
  const t = (distance - start.distance) / span;
  const headingDelta = Math.atan2(Math.sin(end.heading - start.heading), Math.cos(end.heading - start.heading));
  const normalX = start.normalX + (end.normalX - start.normalX) * t;
  const normalZ = start.normalZ + (end.normalZ - start.normalZ) * t;
  const normalLength = Math.max(0.0001, Math.hypot(normalX, normalZ));
  return Object.freeze({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z + (end.z - start.z) * t,
    heading: start.heading + headingDelta * t,
    normalX: normalX / normalLength,
    normalZ: normalZ / normalLength,
    section: t < 0.5 ? start.section : end.section,
    distance
  });
}

function showcaseCheckpoint(checkpoint) {
  return Object.freeze({
    x: checkpoint.x,
    y: checkpoint.y,
    z: checkpoint.z,
    heading: checkpoint.heading,
    normalX: checkpoint.normalX,
    normalZ: checkpoint.normalZ,
    section: checkpoint.section
  });
}

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

export function createFreeDriveRallyRoute({
  sampleTrack,
  elevationAt,
  config = FREE_DRIVE_RALLY
}) {
  if (typeof sampleTrack !== "function" || typeof elevationAt !== "function") return [];
  const start = sampleTrack(config.startProgress)?.center;
  const end = sampleTrack(config.endProgress)?.center;
  if (!start || !end) return [];
  const anchors = [
    { x: start.x, z: start.y },
    ...config.waypoints,
    { x: end.x, z: end.y }
  ];
  const route = [];
  let distance = 0;
  for (let index = 0; index <= config.sampleCount; index += 1) {
    const globalT = index / config.sampleCount;
    const scaled = globalT * (anchors.length - 1);
    const segmentIndex = Math.min(anchors.length - 2, Math.floor(scaled));
    const t = Math.min(1, scaled - segmentIndex);
    const point = catmullRomPoint(
      anchors[Math.max(0, segmentIndex - 1)],
      anchors[segmentIndex],
      anchors[segmentIndex + 1],
      anchors[Math.min(anchors.length - 1, segmentIndex + 2)],
      t
    );
    const previous = route.at(-1);
    if (previous) distance += Math.hypot(point.x - previous.x, point.z - previous.z);
    route.push({
      x: point.x,
      y: elevationAt(point.x, point.z) + config.surfaceOffset,
      z: point.z,
      distance
    });
  }

  constrainRouteGrade(route, config.maximumGrade);

  for (let index = 0; index < route.length; index += 1) {
    const previous = route[Math.max(0, index - 1)];
    const next = route[Math.min(route.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.max(Math.hypot(dx, dz), 0.0001);
    route[index].tangentX = dx / length;
    route[index].tangentZ = dz / length;
    route[index].normalX = dz / length;
    route[index].normalZ = -dx / length;
  }
  return Object.freeze(route.map((sample) => Object.freeze(sample)));
}

function constrainRouteGrade(route, maximumGrade) {
  if (route.length < 3 || !Number.isFinite(maximumGrade) || maximumGrade <= 0) return;
  const startHeight = route[0].y;
  const endHeight = route.at(-1).y;
  for (let pass = 0; pass < 3; pass += 1) {
    route[0].y = startHeight;
    for (let index = 1; index < route.length; index += 1) {
      const previous = route[index - 1];
      const sample = route[index];
      const planarDistance = Math.hypot(sample.x - previous.x, sample.z - previous.z);
      const maximumDelta = planarDistance * maximumGrade;
      sample.y = Math.max(previous.y - maximumDelta, Math.min(previous.y + maximumDelta, sample.y));
    }
    route.at(-1).y = endHeight;
    for (let index = route.length - 2; index > 0; index -= 1) {
      const next = route[index + 1];
      const sample = route[index];
      const planarDistance = Math.hypot(next.x - sample.x, next.z - sample.z);
      const maximumDelta = planarDistance * maximumGrade;
      sample.y = Math.max(next.y - maximumDelta, Math.min(next.y + maximumDelta, sample.y));
    }
  }
}

export function createFreeDriveRallyRibbon(route, {
  halfWidth = FREE_DRIVE_RALLY.halfWidth,
  centerOffset = 0,
  heightOffset = 0
} = {}) {
  if (!Array.isArray(route) || route.length < 2 || halfWidth <= 0) return null;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const sample of route) {
    const centerX = sample.x + sample.normalX * centerOffset;
    const centerZ = sample.z + sample.normalZ * centerOffset;
    positions.push(
      centerX + sample.normalX * halfWidth, sample.y + heightOffset, centerZ + sample.normalZ * halfWidth,
      centerX - sample.normalX * halfWidth, sample.y + heightOffset, centerZ - sample.normalZ * halfWidth
    );
    uvs.push(0, sample.distance / 5, 1, sample.distance / 5);
  }
  for (let index = 0; index < route.length - 1; index += 1) {
    const left = index * 2;
    const right = left + 1;
    const nextLeft = left + 2;
    const nextRight = right + 2;
    indices.push(left, nextLeft, right, right, nextLeft, nextRight);
  }
  return Object.freeze({
    positions: Object.freeze(positions),
    uvs: Object.freeze(uvs),
    indices: Object.freeze(indices)
  });
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t
      + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2
      + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}
