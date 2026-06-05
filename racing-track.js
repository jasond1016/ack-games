import * as THREE from "three";

export const TRACK_SHAPES = Object.freeze({
  LOOP: "loop",
  OPEN: "open"
});

export const TRACK_MODE_LABELS = Object.freeze({
  [TRACK_SHAPES.LOOP]: "闭环赛",
  [TRACK_SHAPES.OPEN]: "点到点冲刺赛"
});

export const TRACK_SHAPE_LABELS = Object.freeze({
  [TRACK_SHAPES.LOOP]: "闭环赛道",
  [TRACK_SHAPES.OPEN]: "开放赛道"
});

export const TRACK_MIN_CONTROL_POINTS = Object.freeze({
  [TRACK_SHAPES.LOOP]: 4,
  [TRACK_SHAPES.OPEN]: 2
});

export const TRACK_MIN_POINT_SPACING = 6;
export const TRACK_MIN_WIDTH = 10;
export const TRACK_MAX_WIDTH = 28;

export const OPEN_TRACK_FINISH_BUFFER = 12;

export const racingTrackShapeConfig = {
  minHalfWidthScale: 0.4,
  curvatureRadiusFactor: 4,
  widthSmoothingPasses: 8
};

const tempPoint = new THREE.Vector2();

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

export function buildTrackModel(track) {
  const shape = normalizeTrackShape(track?.shape) ?? TRACK_SHAPES.LOOP;
  const closed = isLoopTrackShape(shape);
  const sampleCount = Math.max(16, Math.round(Number(track?.samples) || 0));
  const controlPoints = (track?.controlPoints ?? []).map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(controlPoints, closed, "centripetal", 0.45);
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

export function sampleTrackModel(model, progress) {
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
  const normal = new THREE.Vector2(-tangent.y, tangent.x);
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

export function projectPointOntoTrack(model, point, preferredSegmentIndex = null) {
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

export function findTrackInsertionTarget(model, point) {
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

export function progressToDistance(model, progress) {
  const normalizedProgress = model.closed ? wrapProgress(progress) : clamp(progress, 0, 1);
  return normalizedProgress * model.totalLength;
}

export function distanceToProgress(model, distance) {
  if (model.totalLength <= 0) {
    return 0;
  }

  if (model.closed) {
    return wrapProgress(distance / model.totalLength);
  }

  return clamp(distance / model.totalLength, 0, 1);
}

export function getOpenFinishProgress(model) {
  if (model.closed) {
    return 0;
  }

  const bufferDistance = Math.min(
    OPEN_TRACK_FINISH_BUFFER,
    Math.max(model.totalLength * 0.18, 4)
  );
  return distanceToProgress(model, Math.max(0, model.totalLength - bufferDistance));
}

export function validateRacingMap(map) {
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

export function trackHasSelfIntersection(model) {
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

export function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

export function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

export function clamp(value, min, max) {
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
  return new THREE.Vector2(point[0], point[1]);
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
  const tangent = new THREE.Vector2(tangent3.x, tangent3.z).normalize();
  const center = new THREE.Vector2(point.x, point.z);

  return {
    center,
    tangent,
    normal: new THREE.Vector2(-tangent.y, tangent.x),
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
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
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
  if (point instanceof THREE.Vector2) {
    return point;
  }

  tempPoint.set(point.x, point.z ?? point.y);
  return tempPoint.clone();
}
