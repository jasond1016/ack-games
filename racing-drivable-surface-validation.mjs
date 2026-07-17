export const DRIVABLE_SURFACE_LIMITS = Object.freeze({
  maximumSlopeDegrees: 58,
  maximumRibbonGrade: 0.72,
  minimumTriangleArea: 0.0001,
  minimumRibbonWidth: 2.8,
  overlapHorizontalTolerance: 0.12,
  overlapVerticalTolerance: 0.045
});

const allowedSurfaceTransitions = new Set([
  "embankment|ground",
  "embankment|road",
  "ground|rally-dirt",
  "rally-dirt|road",
  "road|verge"
]);

export function validateDrivableSurfaceMesh({
  id = "surface",
  tag = "surface",
  vertices,
  indices,
  limits = DRIVABLE_SURFACE_LIMITS
} = {}) {
  const errors = [];
  const warnings = [];
  const vertexCount = Math.floor((vertices?.length ?? 0) / 3);
  const triangleCount = Math.floor((indices?.length ?? 0) / 3);
  if (!vertices || vertices.length < 9 || vertices.length % 3 !== 0) {
    errors.push(issue("invalid-vertices", id, "顶点数组必须至少包含三个三维顶点。"));
  }
  if (!indices || indices.length < 3 || indices.length % 3 !== 0) {
    errors.push(issue("invalid-indices", id, "索引数组必须由完整三角形组成。"));
  }
  if (errors.length) return report(id, tag, vertexCount, triangleCount, errors, warnings);

  for (let index = 0; index < vertices.length; index += 1) {
    if (!Number.isFinite(vertices[index])) {
      errors.push(issue("non-finite-vertex", id, `顶点分量 ${index} 不是有限数值。`));
      break;
    }
  }

  const minimumUpNormal = Math.cos(limits.maximumSlopeDegrees * Math.PI / 180);
  let downwardTriangleCount = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangleIndex = offset / 3;
    const aIndex = indices[offset];
    const bIndex = indices[offset + 1];
    const cIndex = indices[offset + 2];
    if (![aIndex, bIndex, cIndex].every((value) => Number.isInteger(value) && value >= 0 && value < vertexCount)) {
      errors.push(issue("index-out-of-range", id, `三角形 ${triangleIndex} 引用了不存在的顶点。`));
      continue;
    }
    const a = vertexAt(vertices, aIndex);
    const b = vertexAt(vertices, bIndex);
    const c = vertexAt(vertices, cIndex);
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const normal = cross(ab, ac);
    const doubleArea = Math.hypot(normal.x, normal.y, normal.z);
    if (doubleArea * 0.5 < limits.minimumTriangleArea) {
      errors.push(issue("degenerate-triangle", id, `三角形 ${triangleIndex} 面积过小。`));
      continue;
    }
    const upRatio = Math.abs(normal.y) / doubleArea;
    if (upRatio < minimumUpNormal) {
      const slopeDegrees = Math.acos(Math.min(1, upRatio)) * 180 / Math.PI;
      const centerX = (a.x + b.x + c.x) / 3;
      const centerZ = (a.z + b.z + c.z) / 3;
      errors.push(issue(
        "excessive-slope",
        id,
        `三角形 ${triangleIndex} 坡度 ${slopeDegrees.toFixed(1)}°，超过 ${limits.maximumSlopeDegrees}°（${centerX.toFixed(1)}, ${centerZ.toFixed(1)}）。`
      ));
    }
    if (normal.y < 0) downwardTriangleCount += 1;
  }
  if (downwardTriangleCount > 0) {
    warnings.push(issue(
      "downward-winding",
      id,
      `${downwardTriangleCount} 个三角形朝下，请确认碰撞网格使用双面接触。`
    ));
  }
  return report(id, tag, vertexCount, triangleCount, errors, warnings);
}

export function validateDrivableRibbon({
  id = "ribbon",
  vertices,
  closed = false,
  limits = DRIVABLE_SURFACE_LIMITS
} = {}) {
  const errors = [];
  if (!vertices || vertices.length < 12 || vertices.length % 6 !== 0) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([issue("invalid-ribbon", id, "道路带必须由左右成对顶点构成。")])
    });
  }
  const pairCount = vertices.length / 6;
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const left = vertexAt(vertices, pairIndex * 2);
    const right = vertexAt(vertices, pairIndex * 2 + 1);
    const width = Math.hypot(right.x - left.x, right.z - left.z);
    if (width < limits.minimumRibbonWidth) {
      errors.push(issue("ribbon-too-narrow", id, `道路截面 ${pairIndex} 宽度仅 ${width.toFixed(2)} 米。`));
    }
    if (pairIndex === pairCount - 1 && !closed) continue;
    const nextPair = (pairIndex + 1) % pairCount;
    const nextLeft = vertexAt(vertices, nextPair * 2);
    const nextRight = vertexAt(vertices, nextPair * 2 + 1);
    const center = midpoint(left, right);
    const nextCenter = midpoint(nextLeft, nextRight);
    const planarDistance = Math.hypot(nextCenter.x - center.x, nextCenter.z - center.z);
    const heightDelta = Math.abs(nextCenter.y - center.y);
    if (planarDistance < 0.02) {
      errors.push(issue("collapsed-seam", id, `道路接缝 ${pairIndex} 的平面长度过小。`));
    } else if (heightDelta / planarDistance > limits.maximumRibbonGrade) {
      errors.push(issue(
        "abrupt-seam",
        id,
        `道路接缝 ${pairIndex} 高度变化过快（坡度 ${(heightDelta / planarDistance).toFixed(2)}）。`
      ));
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function findUnsafeSurfaceOverlaps(surfaces, limits = DRIVABLE_SURFACE_LIMITS) {
  if (!Array.isArray(surfaces) || surfaces.length < 2) return Object.freeze([]);
  const issues = [];
  const tolerance = limits.overlapHorizontalTolerance;
  const cellSize = Math.max(tolerance * 2, 0.01);
  const cells = new Map();
  for (const surface of surfaces) {
    for (let offset = 0; offset + 2 < surface.vertices.length; offset += 3) {
      const point = {
        x: surface.vertices[offset],
        y: surface.vertices[offset + 1],
        z: surface.vertices[offset + 2],
        id: surface.id,
        tag: surface.tag
      };
      const cellX = Math.floor(point.x / cellSize);
      const cellZ = Math.floor(point.z / cellSize);
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
          for (const other of cells.get(`${x}:${z}`) ?? []) {
            if (other.id === point.id || other.tag === point.tag || isAllowedTransition(other.tag, point.tag)) continue;
            const horizontal = Math.hypot(other.x - point.x, other.z - point.z);
            const vertical = Math.abs(other.y - point.y);
            if (horizontal <= tolerance && vertical <= limits.overlapVerticalTolerance) {
              issues.push(issue(
                "near-overlap",
                `${other.id}|${point.id}`,
                `${other.tag} 与 ${point.tag} 的碰撞面间距仅 ${vertical.toFixed(3)} 米。`
              ));
              if (issues.length >= 24) return Object.freeze(issues);
            }
          }
        }
      }
      const key = `${cellX}:${cellZ}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(point);
    }
  }
  return Object.freeze(issues);
}

export function validateDrivableSurfaceSet(surfaces) {
  const surfaceReports = surfaces.map(validateDrivableSurfaceMesh);
  const overlaps = findUnsafeSurfaceOverlaps(surfaces);
  const errors = surfaceReports.flatMap((surface) => surface.errors).concat(overlaps);
  const warnings = surfaceReports.flatMap((surface) => surface.warnings);
  return Object.freeze({
    valid: errors.length === 0,
    surfaceCount: surfaces.length,
    triangleCount: surfaceReports.reduce((sum, surface) => sum + surface.triangleCount, 0),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    surfaces: Object.freeze(surfaceReports)
  });
}

export function partitionSurfaceTrianglesBySlope(
  vertices,
  indices,
  maximumSlopeDegrees = DRIVABLE_SURFACE_LIMITS.maximumSlopeDegrees
) {
  const drivableIndices = [];
  const barrierIndices = [];
  const minimumUpNormal = Math.cos(maximumSlopeDegrees * Math.PI / 180);
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const [a, b, c] = triangle.map((index) => vertexAt(vertices, index));
    const normal = cross(subtract(b, a), subtract(c, a));
    const length = Math.hypot(normal.x, normal.y, normal.z);
    const target = length > 0 && Math.abs(normal.y) / length >= minimumUpNormal
      ? drivableIndices
      : barrierIndices;
    target.push(...triangle);
  }
  return Object.freeze({
    drivableIndices: Uint32Array.from(drivableIndices),
    barrierIndices: Uint32Array.from(barrierIndices)
  });
}

function isAllowedTransition(left, right) {
  return allowedSurfaceTransitions.has([left, right].sort().join("|"));
}

function vertexAt(vertices, index) {
  const offset = index * 3;
  return { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
}

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  };
}

function midpoint(left, right) {
  return { x: (left.x + right.x) * 0.5, y: (left.y + right.y) * 0.5, z: (left.z + right.z) * 0.5 };
}

function issue(code, surfaceId, message) {
  return Object.freeze({ code, surfaceId, message });
}

function report(id, tag, vertexCount, triangleCount, errors, warnings) {
  return Object.freeze({
    id,
    tag,
    valid: errors.length === 0,
    vertexCount,
    triangleCount,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings)
  });
}
