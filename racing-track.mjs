class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  clone() { return new Vector2(this.x, this.y); }
  add(value) { this.x += value.x; this.y += value.y; return this; }
  sub(value) { this.x -= value.x; this.y -= value.y; return this; }
  multiplyScalar(value) { this.x *= value; this.y *= value; return this; }
  lerp(value, mix) { this.x += (value.x - this.x) * mix; this.y += (value.y - this.y) * mix; return this; }
  dot(value) { return this.x * value.x + this.y * value.y; }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const length = this.length() || 1; return this.multiplyScalar(1 / length); }
  distanceTo(value) { return Math.sqrt(this.distanceToSquared(value)); }
  distanceToSquared(value) { const x = this.x - value.x; const y = this.y - value.y; return x * x + y * y; }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub(value) { this.x -= value.x; this.y -= value.y; this.z -= value.z; return this; }
  multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const length = this.length() || 1; return this.multiplyScalar(1 / length); }
  distanceTo(value) { return Math.hypot(this.x - value.x, this.y - value.y, this.z - value.z); }
}

class CatmullRomCurve3 {
  constructor(points, closed = false) { this.points = points; this.closed = closed; this.arcLengths = null; }
  getPoint(t) {
    const points = this.points;
    const count = points.length;
    const scaled = (count - (this.closed ? 0 : 1)) * clamp(t, 0, 1);
    let index = Math.floor(scaled);
    let weight = scaled - index;
    if (!this.closed && weight === 0 && index === count - 1) { index = count - 2; weight = 1; }
    const point = (offset) => {
      const target = index + offset;
      if (this.closed) return points[wrapIndex(target, count)];
      if (target < 0) return extrapolate(points[0], points[1]);
      if (target >= count) return extrapolate(points[count - 1], points[count - 2]);
      return points[target];
    };
    return centripetalPoint(point(-1), point(0), point(1), point(2), weight);
  }
  getPointAt(progress) { return this.getPoint(this.getUtoTmapping(clamp(progress, 0, 1))); }
  getTangentAt(progress) {
    const delta = 0.0001;
    const before = this.getPointAt(Math.max(0, progress - delta));
    const after = this.getPointAt(Math.min(1, progress + delta));
    return after.sub(before).normalize();
  }
  getUtoTmapping(progress) {
    const lengths = this.getLengths();
    const target = progress * lengths[lengths.length - 1];
    let low = 0;
    let high = lengths.length - 1;
    while (low <= high) {
      const middle = Math.floor(low + (high - low) / 2);
      if (lengths[middle] < target) low = middle + 1;
      else if (lengths[middle] > target) high = middle - 1;
      else return middle / (lengths.length - 1);
    }
    const index = Math.max(0, high);
    const before = lengths[index];
    const after = lengths[index + 1] ?? before;
    const mix = after === before ? 0 : (target - before) / (after - before);
    return (index + mix) / (lengths.length - 1);
  }
  getLengths(divisions = 200) {
    if (this.arcLengths) return this.arcLengths;
    const lengths = [0];
    let sum = 0;
    let previous = this.getPoint(0);
    for (let index = 1; index <= divisions; index += 1) {
      const current = this.getPoint(index / divisions);
      sum += current.distanceTo(previous);
      lengths.push(sum);
      previous = current;
    }
    this.arcLengths = lengths;
    return lengths;
  }
}

function extrapolate(edge, neighbor) {
  return new Vector3(2 * edge.x - neighbor.x, 2 * edge.y - neighbor.y, 2 * edge.z - neighbor.z);
}

function centripetalPoint(p0, p1, p2, p3, weight) {
  const distance = (a, b) => Math.max(Math.pow(a.distanceTo(b), 0.5), 1e-4);
  const t0 = 0;
  const t1 = t0 + distance(p0, p1);
  const t2 = t1 + distance(p1, p2);
  const t3 = t2 + distance(p2, p3);
  const t = t1 + (t2 - t1) * weight;
  const interpolate = (a, b, ta, tb) => new Vector3(
    ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
    ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
    ((tb - t) * a.z + (t - ta) * b.z) / (tb - ta)
  );
  const a1 = interpolate(p0, p1, t0, t1);
  const a2 = interpolate(p1, p2, t1, t2);
  const a3 = interpolate(p2, p3, t2, t3);
  const b1 = interpolate(a1, a2, t0, t2);
  const b2 = interpolate(a2, a3, t1, t3);
  return interpolate(b1, b2, t1, t2);
}

export const TRACK_SHAPES = Object.freeze({
  LOOP: "loop",
  OPEN: "open"
});

const TRACK_MODE_LABELS = Object.freeze({
  [TRACK_SHAPES.LOOP]: "闭环赛",
  [TRACK_SHAPES.OPEN]: "点到点冲刺赛"
});

const TRACK_SHAPE_LABELS = Object.freeze({
  [TRACK_SHAPES.LOOP]: "闭环赛道",
  [TRACK_SHAPES.OPEN]: "开放赛道"
});

const TRACK_MIN_CONTROL_POINTS = Object.freeze({
  [TRACK_SHAPES.LOOP]: 4,
  [TRACK_SHAPES.OPEN]: 2
});

const TRACK_MIN_POINT_SPACING = 6;
export const TRACK_MIN_WIDTH = 10;
export const TRACK_MAX_WIDTH = 28;

const OPEN_TRACK_FINISH_BUFFER = 12;

const racingTrackShapeConfig = {
  minHalfWidthScale: 0.4,
  curvatureRadiusFactor: 4,
  widthSmoothingPasses: 8
};

const tempPoint = new Vector2();

export function normalizeTrackShape(shape) {
  return shape === TRACK_SHAPES.OPEN || shape === TRACK_SHAPES.LOOP ? shape : null;
}

export function isLoopTrackShape(shape) {
  return shape === TRACK_SHAPES.LOOP;
}

export function getTrackModeForShape(shape) {
  return isLoopTrackShape(shape) ? "lap" : "sprint";
}

export function getTrackShapeLabel(shape) {
  return TRACK_SHAPE_LABELS[shape] ?? TRACK_SHAPE_LABELS[TRACK_SHAPES.LOOP];
}

export function getTrackModeLabel(shape) {
  return TRACK_MODE_LABELS[shape] ?? TRACK_MODE_LABELS[TRACK_SHAPES.LOOP];
}

export function getTrackMinControlPoints(shape) {
  return TRACK_MIN_CONTROL_POINTS[shape] ?? TRACK_MIN_CONTROL_POINTS[TRACK_SHAPES.LOOP];
}

export function normalizeControlPoint(point) {
  if (!Array.isArray(point) || point.length < 2) {
    return null;
  }

  const x = Number(point[0]);
  const z = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  return [roundCoordinate(x), roundCoordinate(z)];
}

export function normalizeLoopStartProgress(value, fallback = 0) {
  return clampNumber(value, 0, 0.999, fallback);
}

function buildTrackModel(track) {
  const shape = normalizeTrackShape(track?.shape) ?? TRACK_SHAPES.LOOP;
  const closed = isLoopTrackShape(shape);
  const sampleCount = Math.max(16, Math.round(Number(track?.samples) || 0));
  const controlPoints = (track?.controlPoints ?? []).map(([x, z]) => new Vector3(x, 0, z));
  const curve = new CatmullRomCurve3(controlPoints, closed, "centripetal", 0.45);
  const sampleProgresses = buildSampleProgresses(sampleCount, closed);
  const baseSamples = sampleProgresses.map((progress) => sampleCurve(curve, progress, closed));
  const baseHalfWidth = Number(track?.width) / 2;
  const minHalfWidth = baseHalfWidth * racingTrackShapeConfig.minHalfWidthScale;
  const lastIndex = baseSamples.length - 1;
  let halfWidths = baseSamples.map((_, index) => {
    const previous = baseSamples[getNeighborIndex(index - 1, lastIndex, closed)];
    const current = baseSamples[index];
    const next = baseSamples[getNeighborIndex(index + 1, lastIndex, closed)];
    const dot = clamp(previous.tangent.dot(next.tangent), -1, 1);
    const turnAngle = Math.acos(dot);
    const span = previous.center.distanceTo(next.center);
    const radiusEstimate = turnAngle < 0.0001 ? Number.POSITIVE_INFINITY : span / turnAngle;
    const widthScale = clamp(
      radiusEstimate / (baseHalfWidth * racingTrackShapeConfig.curvatureRadiusFactor),
      racingTrackShapeConfig.minHalfWidthScale,
      1
    );
    return clamp(baseHalfWidth * widthScale, minHalfWidth, baseHalfWidth);
  });

  for (let pass = 0; pass < racingTrackShapeConfig.widthSmoothingPasses; pass += 1) {
    halfWidths = halfWidths.map((width, index) => {
      const previous = halfWidths[getNeighborIndex(index - 1, lastIndex, closed)];
      const next = halfWidths[getNeighborIndex(index + 1, lastIndex, closed)];
      return clamp(previous * 0.25 + width * 0.5 + next * 0.25, minHalfWidth, baseHalfWidth);
    });
  }

  let totalLength = 0;
  const samples = baseSamples.map((sample, index) => {
    if (index > 0) {
      totalLength += sample.center.distanceTo(baseSamples[index - 1].center);
    }

    return {
      ...sample,
      index,
      progress: sampleProgresses[index],
      distance: totalLength,
      halfWidth: halfWidths[index],
      railOffset: halfWidths[index] + 1.08,
      roadLimit: Math.max(halfWidths[index] - 0.3, 2.8),
      railLimit: halfWidths[index] + 1
    };
  });

  if (closed && samples.length > 1) {
    totalLength += samples[samples.length - 1].center.distanceTo(samples[0].center);
  }

  return {
    shape,
    closed,
    curve,
    controlPoints,
    samples,
    sampleCount,
    segmentCount: closed ? samples.length : Math.max(0, samples.length - 1),
    totalLength
  };
}

function sampleTrackModel(model, progress) {
  const normalizedProgress = model.closed ? wrapProgress(progress) : clamp(progress, 0, 1);
  const domainLength = model.closed ? model.samples.length : Math.max(model.samples.length - 1, 1);
  const rawIndex = model.closed
    ? normalizedProgress * model.samples.length
    : normalizedProgress * domainLength;
  const lowerIndex = Math.min(model.samples.length - 1, Math.floor(rawIndex));
  const upperIndex = model.closed
    ? wrapIndex(lowerIndex + 1, model.samples.length)
    : Math.min(model.samples.length - 1, lowerIndex + 1);
  const mix = clamp(rawIndex - lowerIndex, 0, 1);
  const start = model.samples[lowerIndex];
  const end = model.samples[upperIndex];
  const center = start.center.clone().lerp(end.center, mix);
  const tangent = start.tangent.clone().lerp(end.tangent, mix).normalize();
  const normal = new Vector2(-tangent.y, tangent.x);
  const distanceDelta = model.closed && upperIndex === 0
    ? model.totalLength - start.distance
    : end.distance - start.distance;
  const distance = start.distance + Math.max(distanceDelta, 0) * mix;

  return {
    center,
    tangent,
    normal,
    heading: Math.atan2(tangent.x, tangent.y),
    progress: normalizedProgress,
    distance,
    halfWidth: lerp(start.halfWidth, end.halfWidth, mix),
    railOffset: lerp(start.railOffset, end.railOffset, mix),
    roadLimit: lerp(start.roadLimit, end.roadLimit, mix),
    railLimit: lerp(start.railLimit, end.railLimit, mix)
  };
}

function projectPointOntoTrack(model, point, preferredSegmentIndex = null) {
  const pointVector = toVector2(point);
  const allSegments = enumerateSegmentIndices(model);
  const candidateSegments = preferredSegmentIndex == null
    ? allSegments
    : buildSegmentWindow(model, preferredSegmentIndex, 30);
  let projection = findBestProjection(model, candidateSegments, pointVector);

  if (preferredSegmentIndex != null && projection.distance > 30) {
    projection = findBestProjection(model, allSegments, pointVector);
  }

  return projection;
}

function findTrackInsertionTarget(model, point) {
  const pointVector = toVector2(point);
  let best = null;

  for (const segmentIndex of enumerateSegmentIndices(model)) {
    const start = model.samples[segmentIndex];
    const end = getSegmentEnd(model, segmentIndex);
    const segment = end.center.clone().sub(start.center);
    const lengthSq = Math.max(segment.lengthSq(), 0.0001);
    const rawT = pointVector.clone().sub(start.center).dot(segment) / lengthSq;
    const clampedT = clamp(rawT, 0, 1);
    const projected = start.center.clone().add(segment.multiplyScalar(clampedT));
    const distanceSq = projected.distanceToSquared(pointVector);

    if (!best || distanceSq < best.distanceSq) {
      best = {
        segmentIndex,
        rawT,
        clampedT,
        distanceSq
      };
    }
  }

  if (!best) {
    return {
      index: model.controlPoints.length,
      action: "append"
    };
  }

  if (!model.closed) {
    if (best.segmentIndex === 0 && best.rawT < 0) {
      return { index: 0, action: "prepend" };
    }

    if (best.segmentIndex === model.segmentCount - 1 && best.rawT > 1) {
      return { index: model.controlPoints.length, action: "append" };
    }
  }

  return {
    index: best.segmentIndex + 1,
    action: "insert"
  };
}

function progressToDistance(model, progress) {
  const normalizedProgress = model.closed ? wrapProgress(progress) : clamp(progress, 0, 1);
  return normalizedProgress * model.totalLength;
}

function distanceToProgress(model, distance) {
  if (model.totalLength <= 0) {
    return 0;
  }

  if (model.closed) {
    return wrapProgress(distance / model.totalLength);
  }

  return clamp(distance / model.totalLength, 0, 1);
}

function getOpenFinishProgress(model) {
  if (model.closed) {
    return 0;
  }

  const bufferDistance = Math.min(
    OPEN_TRACK_FINISH_BUFFER,
    Math.max(model.totalLength * 0.18, 4)
  );
  return distanceToProgress(model, Math.max(0, model.totalLength - bufferDistance));
}

function validateRacingMap(map) {
  const errors = [];
  const track = map?.track;
  const shape = normalizeTrackShape(track?.shape);

  if (!shape) {
    errors.push("赛道形态必须是 open 或 loop。");
    return {
      valid: false,
      errors
    };
  }

  if (!Array.isArray(track?.controlPoints)) {
    errors.push("赛道必须提供控制点数组。");
    return {
      valid: false,
      errors
    };
  }

  const minimumPoints = getTrackMinControlPoints(shape);
  if (track.controlPoints.length < minimumPoints) {
    errors.push(`${getTrackShapeLabel(shape)}至少需要 ${minimumPoints} 个控制点。`);
  }

  const points = track.controlPoints.map(normalizeControlPoint);
  if (points.some((point) => point == null)) {
    errors.push("控制点必须是有限数值坐标。");
  }

  const normalizedPoints = points.filter(Boolean);
  if (normalizedPoints.length === track.controlPoints.length) {
    const pointSpacingError = validatePointSpacing(normalizedPoints, shape);
    if (pointSpacingError) {
      errors.push(pointSpacingError);
    }

    if (track.controlPoints.length >= minimumPoints) {
      const trackModel = buildTrackModel({
        shape,
        width: clampNumber(track?.width, TRACK_MIN_WIDTH, TRACK_MAX_WIDTH, 14),
        samples: clampInt(track?.samples, 240, 720, 520),
        controlPoints: normalizedPoints
      });
      if (trackHasSelfIntersection(trackModel)) {
        errors.push("赛道中心线不能自交。");
      }
    }
  }

  if (shape === TRACK_SHAPES.LOOP) {
    const startProgress = track?.startPosition?.progress;
    if (!Number.isFinite(Number(startProgress))) {
      errors.push("闭环赛道必须提供起跑位置。");
    }
  } else if (track?.startPosition != null) {
    errors.push("开放赛道不能包含闭环起跑位置配置。");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function trackHasSelfIntersection(model) {
  const segments = buildPolylineSegments(model);

  for (let index = 0; index < segments.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < segments.length; compareIndex += 1) {
      if (segmentsAreAdjacent(index, compareIndex, segments.length, model.closed)) {
        continue;
      }

      if (lineSegmentsIntersect(segments[index].start, segments[index].end, segments[compareIndex].start, segments[compareIndex].end)) {
        return true;
      }
    }
  }

  return false;
}

export function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(numeric, min, max);
}

export function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function validatePointSpacing(points, shape) {
  const distances = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    distances.push(distanceBetween(points[index], points[index + 1]));
  }

  if (shape === TRACK_SHAPES.LOOP && points.length > 1) {
    distances.push(distanceBetween(points[points.length - 1], points[0]));
  }

  const tooClose = distances.some((distance) => distance < TRACK_MIN_POINT_SPACING);
  return tooClose ? `相邻控制点之间至少保留 ${TRACK_MIN_POINT_SPACING} 米。` : "";
}

function trackPointDistance(point) {
  return new Vector2(point[0], point[1]);
}

function distanceBetween(a, b) {
  return trackPointDistance(a).distanceTo(trackPointDistance(b));
}

function buildSampleProgresses(sampleCount, closed) {
  if (closed) {
    return Array.from({ length: sampleCount }, (_, index) => index / sampleCount);
  }

  if (sampleCount <= 1) {
    return [0];
  }

  return Array.from({ length: sampleCount }, (_, index) => index / (sampleCount - 1));
}

function sampleCurve(curve, progress, closed) {
  const adjustedProgress = closed ? wrapProgress(progress) : clamp(progress, 0, 1);
  const point = curve.getPointAt(adjustedProgress);
  const tangent3 = curve.getTangentAt(adjustedProgress);
  const tangent = new Vector2(tangent3.x, tangent3.z).normalize();
  const center = new Vector2(point.x, point.z);

  return {
    center,
    tangent,
    normal: new Vector2(-tangent.y, tangent.x),
    heading: Math.atan2(tangent.x, tangent.y)
  };
}

function getNeighborIndex(index, lastIndex, closed) {
  if (closed) {
    return wrapIndex(index, lastIndex + 1);
  }

  return clamp(index, 0, lastIndex);
}

function enumerateSegmentIndices(model) {
  return Array.from({ length: model.segmentCount }, (_, index) => index);
}

function buildSegmentWindow(model, preferredSegmentIndex, windowRadius) {
  const segments = [];

  for (let offset = -windowRadius; offset <= windowRadius; offset += 1) {
    if (model.closed) {
      segments.push(wrapIndex(preferredSegmentIndex + offset, model.segmentCount));
      continue;
    }

    const segmentIndex = preferredSegmentIndex + offset;
    if (segmentIndex >= 0 && segmentIndex < model.segmentCount) {
      segments.push(segmentIndex);
    }
  }

  return [...new Set(segments)];
}

function findBestProjection(model, segmentIndices, point) {
  let best = null;

  for (const segmentIndex of segmentIndices) {
    const start = model.samples[segmentIndex];
    const end = getSegmentEnd(model, segmentIndex);
    const segment = end.center.clone().sub(start.center);
    const segmentLengthSq = Math.max(segment.lengthSq(), 0.0001);
    const rawT = point.clone().sub(start.center).dot(segment) / segmentLengthSq;
    const clampedT = clamp(rawT, 0, 1);
    const projected = start.center.clone().add(segment.multiplyScalar(clampedT));
    const tangent = end.center.clone().sub(start.center).normalize();
    const normal = new Vector2(-tangent.y, tangent.x);
    const delta = point.clone().sub(projected);
    const distance = delta.length();
    const startDistance = start.distance;
    const segmentLength = start.center.distanceTo(end.center);
    const distanceAlongTrack = model.closed && segmentIndex === model.segmentCount - 1
      ? (startDistance + segmentLength * clampedT) % model.totalLength
      : startDistance + segmentLength * clampedT;
    const progress = model.totalLength <= 0
      ? 0
      : model.closed
        ? wrapProgress(distanceAlongTrack / model.totalLength)
        : clamp(distanceAlongTrack / model.totalLength, 0, 1);
    const mix = segmentLength <= 0.0001 ? 0 : clampedT;

    if (!best || distance < best.distance) {
      best = {
        segmentIndex,
        progress,
        distanceAlongTrack,
        distanceToEnd: Math.max(0, model.totalLength - distanceAlongTrack),
        distance,
        signedDistance: delta.dot(normal),
        center: projected,
        tangent,
        normal,
        heading: Math.atan2(tangent.x, tangent.y),
        halfWidth: lerp(start.halfWidth, end.halfWidth, mix),
        railOffset: lerp(start.railOffset, end.railOffset, mix),
        roadLimit: lerp(start.roadLimit, end.roadLimit, mix),
        railLimit: lerp(start.railLimit, end.railLimit, mix),
        rawT,
        clampedT
      };
    }
  }

  return best;
}

function getSegmentEnd(model, segmentIndex) {
  if (model.closed) {
    return model.samples[wrapIndex(segmentIndex + 1, model.samples.length)];
  }

  return model.samples[Math.min(model.samples.length - 1, segmentIndex + 1)];
}

function buildPolylineSegments(model) {
  return enumerateSegmentIndices(model).map((segmentIndex) => ({
    start: model.samples[segmentIndex].center,
    end: getSegmentEnd(model, segmentIndex).center
  }));
}

function segmentsAreAdjacent(a, b, segmentCount, closed) {
  if (a === b) {
    return true;
  }

  if (Math.abs(a - b) === 1) {
    return true;
  }

  if (closed && ((a === 0 && b === segmentCount - 1) || (b === 0 && a === segmentCount - 1))) {
    return true;
  }

  return false;
}

function lineSegmentsIntersect(a, b, c, d) {
  const epsilon = 1e-5;
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  const ad = d.clone().sub(a);
  const cd = d.clone().sub(c);
  const ca = a.clone().sub(c);
  const cb = b.clone().sub(c);
  const o1 = cross2(ab, ac);
  const o2 = cross2(ab, ad);
  const o3 = cross2(cd, ca);
  const o4 = cross2(cd, cb);

  if (
    Math.abs(o1) < epsilon && pointOnSegment(c, a, b) ||
    Math.abs(o2) < epsilon && pointOnSegment(d, a, b) ||
    Math.abs(o3) < epsilon && pointOnSegment(a, c, d) ||
    Math.abs(o4) < epsilon && pointOnSegment(b, c, d)
  ) {
    return true;
  }

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function pointOnSegment(point, start, end) {
  return point.x <= Math.max(start.x, end.x) + 1e-5 &&
    point.x + 1e-5 >= Math.min(start.x, end.x) &&
    point.y <= Math.max(start.y, end.y) + 1e-5 &&
    point.y + 1e-5 >= Math.min(start.y, end.y);
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function lerp(start, end, mix) {
  return start + (end - start) * mix;
}

function toVector2(point) {
  if (point instanceof Vector2) {
    return point;
  }

  tempPoint.set(point.x, point.z ?? point.y);
  return tempPoint.clone();
}

export function inspectRacingTrack(trackData) {
  const input = clonePlain(trackData ?? {});
  const validation = validateRacingMap({ track: input });
  let model = null;
  let geometryError = null;
  try {
    const points = input.controlPoints ?? [];
    if (points.length < 2 || points.some((point) => normalizeControlPoint(point) == null)) {
      throw new Error("赛道没有足够的有效控制点来建立中心线。");
    }
    model = buildTrackModel(input);
  } catch (error) {
    geometryError = error;
  }

  const requireModel = () => {
    if (!model) throw new Error(geometryError?.message ?? "赛道几何不可用。");
    return model;
  };
  const summary = model ? buildSemanticSummary(model, input) : null;
  return Object.freeze({
    validation: freezePlain(validation),
    geometryAvailable: Boolean(model),
    summary,
    sample(progress) { return freezePlain(sampleToPlain(sampleTrackModel(requireModel(), progress))); },
    project(point, hint = null) { return freezePlain(sampleToPlain(projectPointOntoTrack(requireModel(), point, hint))); },
    findInsertion(point) { return freezePlain(sampleToPlain(findTrackInsertionTarget(requireModel(), point))); },
    observeMovement(movement) { return freezePlain(observeTrackMovement(requireModel(), summary, movement)); }
  });
}

export function createRacingTrackRuntimeAdapter(trackData) {
  const model = buildTrackModel(trackData);
  return Object.freeze({
    model,
    sample: (progress) => sampleTrackModel(model, progress),
    project: (point, hint = null) => projectPointOntoTrack(model, point, hint)
  });
}

function buildSemanticSummary(model, trackData) {
  const startProgress = model.closed ? normalizeLoopStartProgress(trackData.startPosition?.progress, 0) : 0;
  const finishProgress = model.closed ? startProgress : getOpenFinishProgress(model);
  return freezePlain({
    shape: model.shape,
    shapeLabel: getTrackShapeLabel(model.shape),
    raceMode: getTrackModeForShape(model.shape),
    raceModeLabel: getTrackModeLabel(model.shape),
    closed: model.closed,
    totalLength: model.totalLength,
    startProgress,
    finishProgress,
    startLine: passingLine(model, startProgress),
    finishLine: passingLine(model, finishProgress),
    samples: model.samples.map(sampleToPlain)
  });
}

function passingLine(model, progress) {
  const sample = sampleTrackModel(model, progress);
  return {
    progress,
    center: vectorToPlain(sample.center),
    direction: vectorToPlain(sample.tangent),
    from: vectorToPlain(sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth))),
    to: vectorToPlain(sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth)))
  };
}

function observeTrackMovement(model, summary, movement) {
  const previous = projectPointOntoTrack(model, movement.previousPosition, movement.preferredSegmentIndex ?? null);
  const current = projectPointOntoTrack(model, movement.currentPosition, previous.segmentIndex);
  const distanceDelta = directedDistanceDelta(model, previous.distanceAlongTrack, current.distanceAlongTrack);
  const forward = distanceDelta > 0;
  const onRoad = movement.onRoad !== false && current.distance <= current.roadLimit;
  const crossedStart = onRoad && forward && crossedProgress(model, previous.progress, current.progress, summary.startProgress);
  const crossedFinish = onRoad && forward && crossedProgress(model, previous.progress, current.progress, summary.finishProgress);
  return {
    candidateProgress: current.progress,
    centerlineDistance: current.distanceAlongTrack,
    distanceFromCenterline: current.distance,
    segmentIndex: current.segmentIndex,
    forward,
    onRoad,
    crossedStart,
    crossedFinish
  };
}

function directedDistanceDelta(model, previous, current) {
  let delta = current - previous;
  if (model.closed && delta < -model.totalLength / 2) delta += model.totalLength;
  if (model.closed && delta > model.totalLength / 2) delta -= model.totalLength;
  return delta;
}

function crossedProgress(model, previous, current, target) {
  if (!model.closed) return previous < target && current >= target;
  const relativePrevious = wrapProgress(previous - target);
  const relativeCurrent = wrapProgress(current - target);
  return relativePrevious > 0.5 && relativeCurrent <= 0.5;
}

function sampleToPlain(value) {
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = child instanceof Vector2 || child instanceof Vector3
      ? vectorToPlain(child)
      : Array.isArray(child)
        ? child.map(sampleToPlain)
        : child && typeof child === "object"
          ? sampleToPlain(child)
          : child;
  }
  return result;
}

function vectorToPlain(value) { return { x: value.x, y: value.z ?? value.y }; }
function clonePlain(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function freezePlain(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freezePlain(child); return value; }
