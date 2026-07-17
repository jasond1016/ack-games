import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_DRIVE_TUNNEL,
  createFreeDriveTunnelSegments
} from "../racing-free-drive-features.mjs";

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
