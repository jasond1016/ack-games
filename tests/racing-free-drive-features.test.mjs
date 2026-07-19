import assert from "node:assert/strict";
import test from "node:test";

import {
  COASTAL_SHOWCASE_RALLY,
  COASTAL_SHOWCASE_TUNNEL,
  FREE_DRIVE_RALLY,
  FREE_DRIVE_TUNNEL,
  createFreeDriveShowcaseDrivingLine,
  createFreeDriveShowcaseRoute,
  createFreeDriveRallyRibbon,
  createFreeDriveRallyRoute,
  createFreeDriveTunnelSegments,
  sampleFreeDriveShowcaseDrivingLine,
  showcaseRouteLookAheadDistance
} from "../racing-free-drive-features.mjs";
import { racingMapLibrary } from "../racing-map.js";
import { inspectRacingTrack } from "../racing-track.mjs";

function straightTrack(progress) {
  return { center: { x: progress * 100, y: 20 }, halfWidth: 9 };
}

test("自由地图隧道连续覆盖指定赛道区间", () => {
  const segments = createFreeDriveTunnelSegments({ sampleTrack: straightTrack, elevationAt: () => 2 });
  assert.equal(segments.length, FREE_DRIVE_TUNNEL.segmentCount);
  assert.equal(segments[0].progressStart, FREE_DRIVE_TUNNEL.startProgress);
  assert.equal(segments.at(-1).progressEnd, FREE_DRIVE_TUNNEL.endProgress);
  for (let index = 1; index < segments.length; index += 1) {
    assert.equal(segments[index - 1].progressEnd, segments[index].progressStart);
  }
});

test("泥土拉力支线从主路驶入并重新接回主路", () => {
  const route = createFreeDriveRallyRoute({ sampleTrack: straightTrack, elevationAt: () => 1.5 });
  assert.equal(route.length, FREE_DRIVE_RALLY.sampleCount + 1);
  assert.equal(route[0].x, straightTrack(FREE_DRIVE_RALLY.startProgress).center.x);
  assert.equal(route.at(-1).x, straightTrack(FREE_DRIVE_RALLY.endProgress).center.x);
  assert.ok(route.every((sample) => Math.abs(Math.hypot(sample.tangentX, sample.tangentZ) - 1) < 0.0001));
  assert.ok(route.every((sample) => sample.y === 1.5 + FREE_DRIVE_RALLY.surfaceOffset));
});

test("拉力支线路面高度变化不超过安全坡度", () => {
  const route = createFreeDriveRallyRoute({
    sampleTrack: straightTrack,
    elevationAt: (x) => x > 94 ? 8 : 0
  });
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const sample = route[index];
    const planarDistance = Math.hypot(sample.x - previous.x, sample.z - previous.z);
    assert.ok(Math.abs(sample.y - previous.y) <= planarDistance * FREE_DRIVE_RALLY.maximumGrade + 0.0001);
  }
});

test("拉力道路生成连续的可碰撞三角带", () => {
  const route = createFreeDriveRallyRoute({ sampleTrack: straightTrack, elevationAt: () => 0 });
  const ribbon = createFreeDriveRallyRibbon(route);
  assert.equal(ribbon.positions.length, route.length * 2 * 3);
  assert.equal(ribbon.uvs.length, route.length * 2 * 2);
  assert.equal(ribbon.indices.length, (route.length - 1) * 6);
  assert.ok(FREE_DRIVE_RALLY.halfWidth >= 4);
  assert.equal(FREE_DRIVE_RALLY.surfaceId, "rally-dirt");
});

test("隧道净空覆盖道路且墙体和顶板都有物理规格", () => {
  const [segment] = createFreeDriveTunnelSegments({ sampleTrack: straightTrack, elevationAt: () => 2 });
  assert.ok(segment.innerHalfWidth > 9);
  assert.equal(segment.walls.length, 2);
  const wallDistance = (wall) => Math.hypot(wall.x - segment.x, wall.z - segment.z);
  assert.ok(wallDistance(segment.walls[0]) > segment.innerHalfWidth);
  assert.equal(wallDistance(segment.walls[0]), wallDistance(segment.walls[1]));
  assert.equal(segment.walls[0].tag, "tunnel-wall");
  assert.equal(segment.roof.tag, "tunnel-roof");
  assert.ok(segment.roof.y - segment.roadHeight > 6);
});

test("showcase route crosses road, tunnel, rally, and returns to its start", () => {
  const sampleTrack = (progress) => ({
    center: { x: progress * 100, y: progress * 20 },
    normal: { x: 0, y: 1 },
    heading: 0.25
  });
  const rallyRoute = Array.from({ length: 5 }, (_, index) => ({
    x: 90 + index,
    y: 1,
    z: 18 + index,
    tangentX: 1,
    tangentZ: 0,
    normalX: 0,
    normalZ: -1
  }));
  const route = createFreeDriveShowcaseRoute({ sampleTrack, elevationAt: () => 1, rallyRoute });

  assert.ok(route.length >= 8);
  assert.equal(route[0].section, "start");
  assert.ok(route.some(({ section }) => section === "tunnel"));
  assert.ok(route.some(({ section }) => section === "rally"));
  assert.equal(route.at(-1).section, "finish");
  assert.deepEqual(
    { x: route.at(-1).x, z: route.at(-1).z },
    { x: route[0].x, z: route[0].z }
  );
  assert.equal(route[4].section, "tunnel");
  assert.equal(route[5].section, "rally");
});

test("dense showcase driving line continuously follows every mixed-route section", () => {
  const sampleTrack = (progress) => ({
    center: { x: Math.sin(progress * Math.PI * 2) * 100, y: Math.cos(progress * Math.PI * 2) * 100 },
    normal: { x: Math.sin(progress * Math.PI * 2), y: Math.cos(progress * Math.PI * 2) },
    heading: progress * Math.PI * 2 + Math.PI / 2
  });
  const rallyRoute = Array.from({ length: 30 }, (_, index) => {
    const t = index / 29;
    const progress = FREE_DRIVE_RALLY.startProgress + (FREE_DRIVE_RALLY.endProgress - FREE_DRIVE_RALLY.startProgress) * t;
    const center = sampleTrack(progress).center;
    return { x: center.x, y: 1, z: center.y, tangentX: Math.cos(progress * Math.PI * 2), tangentZ: -Math.sin(progress * Math.PI * 2), normalX: 0, normalZ: 1 };
  });
  const line = createFreeDriveShowcaseDrivingLine({ sampleTrack, elevationAt: () => 1, rallyRoute });
  assert.ok(line.length > 400);
  assert.deepEqual(new Set(line.map(({ section }) => section)), new Set(["start", "road", "tunnel", "rally", "finish"]));
  for (let index = 1; index < line.length; index += 1) {
    assert.ok(line[index].distance > line[index - 1].distance);
    assert.ok(Math.hypot(line[index].x - line[index - 1].x, line[index].z - line[index - 1].z) < 5);
  }
  assert.ok(Math.hypot(line[0].x - line.at(-1).x, line[0].z - line.at(-1).z) < 0.1);
  const grid = sampleFreeDriveShowcaseDrivingLine(line, -8);
  assert.ok(grid.distance > line.at(-1).distance - 9);
  assert.ok(Math.hypot(grid.x - line[0].x, grid.z - line[0].z) < 9);
  for (let distance = 0; distance <= line.at(-1).distance; distance += 3) {
    const sample = sampleFreeDriveShowcaseDrivingLine(line, distance);
    assert.ok(Math.abs(Math.hypot(sample.normalX, sample.normalZ) - 1) < 1e-9);
  }
});

test("Coastal Festival 灰盒路线达到三至五分钟的距离预算", () => {
  const coastal = racingMapLibrary.snapshot().presets
    .find(({ mapId }) => mapId === "preset-coastal-showcase").map;
  const track = inspectRacingTrack(coastal.track);
  const sampleTrack = (progress) => track.sample(progress);
  const rallyRoute = createFreeDriveRallyRoute({
    sampleTrack,
    elevationAt: () => 0,
    config: COASTAL_SHOWCASE_RALLY
  });
  const line = createFreeDriveShowcaseDrivingLine({
    sampleTrack,
    elevationAt: () => 0,
    rallyRoute,
    tunnelConfig: COASTAL_SHOWCASE_TUNNEL,
    rallyConfig: COASTAL_SHOWCASE_RALLY
  });
  const sectionLengths = line.slice(1).reduce((lengths, sample, index) => {
    const section = line[index].section === "start" ? "road" : line[index].section;
    lengths[section] = (lengths[section] ?? 0) + sample.distance - line[index].distance;
    return lengths;
  }, {});

  assert.ok(line.at(-1).distance >= 5600 && line.at(-1).distance <= 6400);
  assert.ok(sectionLengths.tunnel >= 700 && sectionLengths.tunnel <= 1000);
  assert.ok(sectionLengths.rally >= 1200 && sectionLengths.rally <= 1500);
  assert.ok(COASTAL_SHOWCASE_RALLY.halfWidth >= 5.5);
  for (let index = 1; index < line.length; index += 1) {
    assert.ok(Math.hypot(line[index].x - line[index - 1].x, line[index].z - line[index - 1].z) < 15);
  }
});

test("Festival 导航前瞻距离随速度增加但保持可读范围", () => {
  assert.equal(showcaseRouteLookAheadDistance(0), 35);
  assert.ok(showcaseRouteLookAheadDistance(25) > showcaseRouteLookAheadDistance(10));
  assert.equal(showcaseRouteLookAheadDistance(1000), 130);
});
