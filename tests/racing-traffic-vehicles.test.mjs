import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAFFIC_CRUISE_SPEED_BAND_KMH,
  TRAFFIC_SPAWN_PROGRESS,
  TRAFFIC_VEHICLE_CATALOG,
  createTrafficCarSpec,
  listTrafficVehicleTypeIds,
  resolveTrafficCatalogCruiseSpeedMps
} from "../racing-traffic-vehicles.mjs";

test("traffic catalog has four distinct civilian types", () => {
  assert.equal(TRAFFIC_VEHICLE_CATALOG.length, 4);
  assert.deepEqual(listTrafficVehicleTypeIds(), ["sedan", "suv", "mini", "truck"]);
  assert.equal(new Set(TRAFFIC_VEHICLE_CATALOG.map(({ id }) => id)).size, 4);
  assert.equal(TRAFFIC_SPAWN_PROGRESS.length, 4);
});

test("traffic cruise speeds stay inside the locked band", () => {
  for (const entry of TRAFFIC_VEHICLE_CATALOG) {
    assert.ok(entry.cruiseSpeedKmh >= TRAFFIC_CRUISE_SPEED_BAND_KMH.min);
    assert.ok(entry.cruiseSpeedKmh <= TRAFFIC_CRUISE_SPEED_BAND_KMH.max);
    const mps = resolveTrafficCatalogCruiseSpeedMps(entry);
    assert.ok(mps > 10 && mps < 25);
  }
});

test("traffic car specs load local freedrive models and disable nitro outlets", () => {
  for (const entry of TRAFFIC_VEHICLE_CATALOG) {
    const spec = createTrafficCarSpec(entry);
    assert.match(spec.modelUrl, new RegExp(`${entry.modelFile}$`));
    assert.equal(spec.boostExhausts.length, 0);
    assert.ok(entry.sourceUrl.startsWith("https://poly.pizza/"));
    assert.equal(entry.license, "CC0");
  }
  const mini = TRAFFIC_VEHICLE_CATALOG.find(({ typeId }) => typeId === "mini");
  const truck = TRAFFIC_VEHICLE_CATALOG.find(({ typeId }) => typeId === "truck");
  assert.ok(mini.substituteNote);
  assert.ok(truck.substituteNote);
});
