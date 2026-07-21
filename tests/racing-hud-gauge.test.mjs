import assert from "node:assert/strict";
import test from "node:test";
import { getPhysicalVehicleSpec } from "../racing-physical-vehicle.mjs";
import {
  formatGearLabel,
  resolveHudGaugeParams,
  resolveHudGaugeReading,
  resolveHudGaugeRpmFillRatio
} from "../racing-hud-gauge.mjs";

test("formatGearLabel maps reverse / neutral / drive", () => {
  assert.equal(formatGearLabel(-1), "R");
  assert.equal(formatGearLabel(0), "N");
  assert.equal(formatGearLabel(3), "3");
  assert.equal(formatGearLabel(null), "N");
});

test("resolveHudGaugeParams exposes per-car redline and gear ratios", () => {
  const urus = resolveHudGaugeParams(getPhysicalVehicleSpec("urus-se"));
  const bolide = resolveHudGaugeParams(getPhysicalVehicleSpec("bolide"));

  assert.equal(urus.redlineRpm, 6800);
  assert.equal(urus.upshiftRpm, 6250);
  assert.equal(urus.gearCount, 8);
  assert.equal(urus.topSpeedKmh, 312);
  assert.deepEqual([...urus.gearRatios], [5, 3.2, 2.14, 1.72, 1.31, 1, 0.82, 0.64]);

  assert.equal(bolide.redlineRpm, 8600);
  assert.equal(bolide.upshiftRpm, 8150);
  assert.equal(bolide.gearCount, 7);
  assert.notEqual(bolide.redlineRpm, urus.redlineRpm);
  assert.notEqual(bolide.gearCount, urus.gearCount);
});

test("resolveHudGaugeReading binds real drivetrain and freezes previous values", () => {
  const vehicleSpec = getPhysicalVehicleSpec("miura-p400");
  const live = resolveHudGaugeReading({
    speedKmh: 96.4,
    drivetrain: { gear: 2, engineRpm: 5432.6 },
    vehicleSpec
  });
  assert.equal(live.speedKmh, 96);
  assert.equal(live.engineRpm, 5433);
  assert.equal(live.gear, 2);
  assert.equal(live.gearLabel, "2");
  assert.equal(live.params.redlineRpm, 7700);

  const frozen = resolveHudGaugeReading({
    speedKmh: 200,
    drivetrain: { gear: 5, engineRpm: 7000 },
    vehicleSpec,
    frozen: true,
    previous: live
  });
  assert.equal(frozen.speedKmh, 96);
  assert.equal(frozen.engineRpm, 5433);
  assert.equal(frozen.gearLabel, "2");
});

test("rpm fill ratio stays within idle–redline", () => {
  const params = resolveHudGaugeParams(getPhysicalVehicleSpec("aventador"));
  assert.equal(resolveHudGaugeRpmFillRatio(params.idleRpm, params), 0);
  assert.equal(resolveHudGaugeRpmFillRatio(params.redlineRpm, params), 1);
  assert.ok(resolveHudGaugeRpmFillRatio(params.upshiftRpm, params) > 0.5);
});
