import assert from "node:assert/strict";
import test from "node:test";
import {
  createDrivetrainState,
  sampleTorqueCurve,
  updateAutomaticDrivetrain
} from "../racing-drivetrain.mjs";
import { getPhysicalVehicleSpec } from "../racing-physical-vehicle.mjs";

test("发动机转速由轮速、挡位和终传比共同决定", () => {
  const config = getPhysicalVehicleSpec("aventador");
  const state = createDrivetrainState(config);
  updateAutomaticDrivetrain({ state, config, signedSpeed: 20, throttle: 0.5, deltaSeconds: 0.016 });
  assert.ok(state.engineRpm > config.idleRpm);
  assert.ok(state.engineRpm <= config.redlineRpm);
  assert.ok(state.driveScale > 0);
});

test("自动变速箱升挡时短暂切断驱动力", () => {
  const config = getPhysicalVehicleSpec("aventador");
  const state = createDrivetrainState(config);
  updateAutomaticDrivetrain({ state, config, signedSpeed: 36, throttle: 1, deltaSeconds: 0.016 });
  assert.equal(state.gear, 2);
  assert.ok(state.shiftSeconds > 0);
  assert.equal(state.driveScale, 0);
  assert.equal(state.shiftCount, 1);
});

test("低速倒车输入切换倒挡，扭矩曲线在中高转达到峰值", () => {
  const config = getPhysicalVehicleSpec("miura-p400");
  const state = createDrivetrainState(config);
  updateAutomaticDrivetrain({ state, config, signedSpeed: 0, reverseInput: 1, deltaSeconds: 0.016 });
  assert.equal(state.gear, -1);
  assert.ok(sampleTorqueCurve(0.62) > sampleTorqueCurve(0.05));
  assert.ok(sampleTorqueCurve(0.62) > sampleTorqueCurve(1));
});
