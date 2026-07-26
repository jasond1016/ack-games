import assert from "node:assert/strict";
import test from "node:test";
import {
  findUnsafeSurfaceOverlaps,
  partitionSurfaceTrianglesBySlope,
  validateDrivableRibbon,
  validateDrivableSurfaceMesh,
  validateDrivableSurfaceSet,
  validateSurfaceCoverageProbes
} from "../racing-drivable-surface-validation.mjs";

const flatRoad = {
  id: "road:0",
  tag: "road",
  vertices: [
    -3, 0, 0, 3, 0, 0,
    -3, 0.2, 10, 3, 0.2, 10
  ],
  indices: [0, 1, 2, 1, 3, 2]
};

test("有效道路三角网格和连续道路带通过校验", () => {
  assert.equal(validateDrivableSurfaceMesh(flatRoad).valid, true);
  assert.equal(validateDrivableRibbon({ id: flatRoad.id, vertices: flatRoad.vertices }).valid, true);
  const report = validateDrivableSurfaceSet([flatRoad]);
  assert.equal(report.valid, true);
  assert.equal(report.triangleCount, 2);
});

test("陡峭堤坡三角形会与可驾驶部分拆分", () => {
  const vertices = [
    0, 0, 0, 4, 0, 0, 0, 0, 4,
    8, 0, 0, 8, 3, 0, 8, 0, 3
  ];
  const partition = partitionSurfaceTrianglesBySlope(vertices, [0, 2, 1, 3, 4, 5]);
  assert.deepEqual([...partition.drivableIndices], [0, 2, 1]);
  assert.deepEqual([...partition.barrierIndices], [3, 4, 5]);
});

test("退化三角形、越界索引和过陡碰撞面被硬拦截", () => {
  const degenerate = validateDrivableSurfaceMesh({
    id: "bad",
    tag: "road",
    vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0],
    indices: [0, 1, 2, 0, 1, 8]
  });
  assert.equal(degenerate.valid, false);
  assert.deepEqual(degenerate.errors.map(({ code }) => code), ["degenerate-triangle", "index-out-of-range"]);

  const wall = validateDrivableSurfaceMesh({
    id: "wall",
    tag: "road",
    vertices: [0, 0, 0, 0, 2, 0, 0, 0, 2],
    indices: [0, 1, 2]
  });
  assert.ok(wall.errors.some(({ code }) => code === "excessive-slope"));
});

test("道路宽度不足和高度突变被识别为危险接缝", () => {
  const result = validateDrivableRibbon({
    id: "broken-ribbon",
    vertices: [
      -1, 0, 0, 1, 0, 0,
      -1, 4, 1, 1, 4, 1
    ]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === "ribbon-too-narrow"));
  assert.ok(result.errors.some(({ code }) => code === "abrupt-seam"));
});

test("危险的近距离双碰撞面会被发现，合法路面过渡不误报", () => {
  const duplicate = { ...flatRoad, id: "unknown:1", tag: "unknown", vertices: flatRoad.vertices.map((value, index) => index % 3 === 1 ? value + 0.02 : value) };
  assert.ok(findUnsafeSurfaceOverlaps([flatRoad, duplicate]).length > 0);

  const rallyTransition = { ...duplicate, id: "rally:1", tag: "rally-dirt" };
  assert.equal(findUnsafeSurfaceOverlaps([flatRoad, rallyTransition]).length, 0);
});

test("关键路线探针会报告缺失碰撞面并允许显式跳跃缺口", () => {
  const probes = [
    { id: "route:0", x: 0, z: 0, allowedSurfaceIds: ["road"] },
    { id: "route:1", x: 10, z: 0, allowedSurfaceIds: ["road"] },
    { id: "jump-gap", x: 20, z: 0, allowedSurfaceIds: ["road"], exempt: true }
  ];
  const report = validateSurfaceCoverageProbes(probes, ({ x }) => x < 5 ? "road" : null);
  assert.equal(report.valid, false);
  assert.equal(report.probeCount, 2);
  assert.deepEqual(report.errors.map(({ surfaceId }) => surfaceId), ["route:1"]);
  assert.equal(report.errors[0].code, "missing-surface-coverage");
});
