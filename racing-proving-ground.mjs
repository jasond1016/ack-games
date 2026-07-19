const TARGET_SPEED_KMH = 100;
const STOP_SPEED_KMH = 1;
const SKIDPAD_DURATION_SECONDS = 12;
const SKIDPAD_SAMPLE_DELAY_SECONDS = 4;
const FIXED_STEER_ENTRY_SPEED_KMH = 50;
const FIXED_STEER_DURATION_SECONDS = 8;
const DRIVETRAIN_TRACE_INTERVAL_SECONDS = 0.1;
const SKIDPAD_CENTER = Object.freeze({ x: 0, z: 40 });
const SKIDPAD_RADIUS_METERS = 30;

export const PROVING_GROUND_TESTS = Object.freeze([
  Object.freeze({ id: "zero-to-100", label: "0-100 km/h", setup: Object.freeze({ x: -150, z: -60, heading: Math.PI * 0.5 }) }),
  Object.freeze({ id: "100-to-zero", label: "100-0 km/h", setup: Object.freeze({ x: -150, z: -60, heading: Math.PI * 0.5 }) }),
  Object.freeze({
    id: "skidpad",
    label: "60 m skidpad",
    center: SKIDPAD_CENTER,
    targetRadiusMeters: SKIDPAD_RADIUS_METERS,
    setup: Object.freeze({ x: 30, z: 40, heading: 0 })
  }),
  Object.freeze({ id: "fixed-steer", label: "Fixed-steer step", setup: Object.freeze({ x: -100, z: 20, heading: Math.PI * 0.5 }) })
]);

export function createProvingGroundTestRunner() {
  let run = null;
  let lastResult = null;

  function start(testId, observation = {}) {
    if (!PROVING_GROUND_TESTS.some(({ id }) => id === testId)) return false;
    const origin = positionOf(observation);
    run = {
      testId,
      phase: testId === "100-to-zero" || testId === "fixed-steer" ? "accelerating" : "running",
      elapsedSeconds: 0,
      origin,
      previousHeading: finiteOr(observation.heading, 0),
      maximumSpeedKmh: Math.max(0, finiteOr(observation.speedKmh, 0)),
      brakingStartSpeedKmh: null,
      maximumLateralAcceleration: 0,
      maximumTireSlip: Math.max(0, finiteOr(observation.maximumTireSlip, 0)),
      absActiveSeconds: 0,
      tractionControlActiveSeconds: 0,
      roadContactSeconds: 0,
      sampledSeconds: 0,
      initialShiftCount: Math.max(0, finiteOr(observation.shiftCount, 0)),
      latestShiftCount: Math.max(0, finiteOr(observation.shiftCount, 0)),
      traceElapsedSeconds: 0,
      drivetrainTrace: [],
      skidpadSteering: -0.4,
      radiusSamples: [],
      fixedSteerEntrySpeedKmh: null,
      fixedSteerEarlyGains: [],
      fixedSteerSteadyGains: [],
      fixedSteerSteadyRadii: [],
      fixedSteerSpeedSamples: []
    };
    lastResult = null;
    return true;
  }

  function controls() {
    if (!run) return Object.freeze({ throttle: 0, brake: 0, steering: 0 });
    if (run.testId === "100-to-zero" && run.phase === "braking") {
      return Object.freeze({ throttle: 0, brake: 1, steering: 0 });
    }
    if (run.testId === "skidpad") {
      return Object.freeze({ throttle: 0.2, brake: 0, steering: run.skidpadSteering });
    }
    if (run.testId === "fixed-steer" && run.phase === "steering") {
      return Object.freeze({ throttle: 0.28, brake: 0, steering: -0.35 });
    }
    return Object.freeze({ throttle: 1, brake: 0, steering: 0 });
  }

  function update(observation = {}, deltaSeconds = 0) {
    if (!run) return snapshot();
    const delta = Math.max(0, finiteOr(deltaSeconds, 0));
    const speedKmh = Math.max(0, finiteOr(observation.speedKmh, 0));
    const position = positionOf(observation);
    run.elapsedSeconds += delta;
    run.maximumSpeedKmh = Math.max(run.maximumSpeedKmh, speedKmh);
    run.maximumTireSlip = Math.max(run.maximumTireSlip, Math.max(0, finiteOr(observation.maximumTireSlip, 0)));
    run.absActiveSeconds += observation.absActive ? delta : 0;
    run.tractionControlActiveSeconds += observation.tractionControlActive ? delta : 0;
    run.roadContactSeconds += observation.surfaceId === "road" ? delta : 0;
    run.sampledSeconds += delta;
    run.latestShiftCount = Math.max(run.latestShiftCount, finiteOr(observation.shiftCount, run.latestShiftCount));
    if (run.testId === "zero-to-100") recordDrivetrainTrace(observation, delta, speedKmh);

    if (run.testId === "zero-to-100" && speedKmh >= TARGET_SPEED_KMH) {
      finish({
        zeroTo100Seconds: run.elapsedSeconds,
        distanceMeters: distance(run.origin, position)
      });
    } else if (run.testId === "100-to-zero") {
      if (run.phase === "accelerating" && speedKmh >= TARGET_SPEED_KMH) {
        run.phase = "braking";
        run.elapsedSeconds = 0;
        run.origin = position;
        run.brakingStartSpeedKmh = speedKmh;
        run.maximumTireSlip = 0;
        run.absActiveSeconds = 0;
        run.tractionControlActiveSeconds = 0;
        run.roadContactSeconds = 0;
        run.sampledSeconds = 0;
        run.initialShiftCount = run.latestShiftCount;
      } else if (run.phase === "braking" && run.elapsedSeconds >= 0.2 && speedKmh <= STOP_SPEED_KMH) {
        finish({
          brakingSeconds: run.elapsedSeconds,
          brakingDistanceMeters: distance(run.origin, position),
          startSpeedKmh: run.brakingStartSpeedKmh
        });
      }
    } else if (run.testId === "fixed-steer") {
      const heading = finiteOr(observation.heading, run.previousHeading);
      if (run.phase === "accelerating" && speedKmh >= FIXED_STEER_ENTRY_SPEED_KMH) {
        run.phase = "steering";
        run.elapsedSeconds = 0;
        run.previousHeading = heading;
        run.fixedSteerEntrySpeedKmh = speedKmh;
        run.maximumLateralAcceleration = 0;
      } else if (run.phase === "steering") {
        const speedMps = speedKmh / 3.6;
        const yawRate = delta > 0 ? Math.abs(angleDelta(run.previousHeading, heading) / delta) : 0;
        const steeringAngle = Math.abs(finiteOr(observation.steeringAngle, 0));
        const lateralAcceleration = speedMps * yawRate;
        run.maximumLateralAcceleration = Math.max(run.maximumLateralAcceleration, lateralAcceleration);
        run.fixedSteerSpeedSamples.push(speedKmh);
        if (speedMps > 2 && steeringAngle > 0.01 && yawRate > 0.005) {
          const curvatureGain = yawRate / speedMps / steeringAngle;
          if (run.elapsedSeconds >= 0.5 && run.elapsedSeconds <= 2.5) {
            run.fixedSteerEarlyGains.push(curvatureGain);
          }
          if (run.elapsedSeconds >= FIXED_STEER_DURATION_SECONDS - 2) {
            run.fixedSteerSteadyGains.push(curvatureGain);
            run.fixedSteerSteadyRadii.push(speedMps / yawRate);
          }
        }
        run.previousHeading = heading;
        if (run.elapsedSeconds >= FIXED_STEER_DURATION_SECONDS) {
          const earlyGain = average(run.fixedSteerEarlyGains);
          const steadyGain = average(run.fixedSteerSteadyGains);
          finish({
            entrySpeedKmh: run.fixedSteerEntrySpeedKmh,
            averageSpeedKmh: average(run.fixedSteerSpeedSamples),
            maximumLateralAcceleration: run.maximumLateralAcceleration,
            earlyCurvatureGain: earlyGain,
            steadyCurvatureGain: steadyGain,
            curvatureGainRetention: earlyGain > 0 ? steadyGain / earlyGain : 0,
            steadyRadiusMeters: average(run.fixedSteerSteadyRadii)
          });
        }
      }
    } else if (run.testId === "skidpad") {
      const heading = finiteOr(observation.heading, run.previousHeading);
      const yawRate = delta > 0 ? angleDelta(run.previousHeading, heading) / delta : 0;
      const speedMps = speedKmh / 3.6;
      const lateralAcceleration = Math.abs(speedMps * yawRate);
      const radialX = position.x - SKIDPAD_CENTER.x;
      const radialZ = position.z - SKIDPAD_CENTER.z;
      const geometricRadius = Math.hypot(radialX, radialZ);
      const radiusError = geometricRadius - SKIDPAD_RADIUS_METERS;
      run.skidpadSteering = clamp(-0.4 - radiusError * 0.025, -0.9, -0.05);
      run.maximumLateralAcceleration = Math.max(run.maximumLateralAcceleration, lateralAcceleration);
      if (run.elapsedSeconds >= SKIDPAD_SAMPLE_DELAY_SECONDS && speedMps > 2) {
        run.radiusSamples.push(geometricRadius);
      }
      run.previousHeading = heading;
      if (run.elapsedSeconds >= SKIDPAD_DURATION_SECONDS) {
        finish({
          durationSeconds: run.elapsedSeconds,
          maximumSpeedKmh: run.maximumSpeedKmh,
          maximumLateralAcceleration: run.maximumLateralAcceleration,
          averageRadiusMeters: average(run.radiusSamples)
        });
      }
    }
    return snapshot();
  }

  function finish(metrics) {
    const commonMetrics = {
      maximumTireSlip: run.maximumTireSlip,
      absActiveSeconds: run.absActiveSeconds,
      tractionControlActiveSeconds: run.tractionControlActiveSeconds,
      gearShiftCount: Math.max(0, run.latestShiftCount - run.initialShiftCount),
      roadContactRatio: run.sampledSeconds > 0 ? run.roadContactSeconds / run.sampledSeconds : 0
    };
    lastResult = Object.freeze({
      testId: run.testId,
      status: "completed",
      ...Object.fromEntries(Object.entries({ ...metrics, ...commonMetrics }).map(([key, value]) => [key, round(value, 3)])),
      ...(run.drivetrainTrace.length ? { drivetrainTrace: Object.freeze(run.drivetrainTrace) } : {})
    });
    run = null;
  }

  function cancel() {
    run = null;
    return snapshot();
  }

  function recordDrivetrainTrace(observation, deltaSeconds, speedKmh) {
    run.traceElapsedSeconds += deltaSeconds;
    if (run.traceElapsedSeconds < DRIVETRAIN_TRACE_INTERVAL_SECONDS && speedKmh < TARGET_SPEED_KMH) return;
    run.traceElapsedSeconds %= DRIVETRAIN_TRACE_INTERVAL_SECONDS;
    run.drivetrainTrace.push(Object.freeze({
      elapsedSeconds: round(run.elapsedSeconds, 3),
      speedKmh: round(speedKmh, 2),
      gear: Math.trunc(finiteOr(observation.gear, 0)),
      engineRpm: round(observation.engineRpm, 0),
      torqueRatio: round(observation.torqueRatio, 3),
      drivetrainScale: round(observation.drivetrainScale, 3),
      tcsEngineScale: round(observation.tcsEngineScale, 3),
      maximumTireSlip: round(observation.maximumTireSlip, 3),
      engineForcePerWheel: round(observation.engineForcePerWheel, 1)
    }));
  }

  function reset() {
    run = null;
    lastResult = null;
    return snapshot();
  }

  function snapshot() {
    if (!run) return lastResult ?? Object.freeze({ status: "idle" });
    return Object.freeze({
      testId: run.testId,
      status: "running",
      phase: run.phase,
      elapsedSeconds: round(run.elapsedSeconds, 3),
      maximumSpeedKmh: round(run.maximumSpeedKmh, 1),
      maximumLateralAcceleration: round(run.maximumLateralAcceleration, 3)
    });
  }

  return Object.freeze({ start, controls, update, cancel, reset, snapshot });
}

function positionOf(observation) {
  return Object.freeze({ x: finiteOr(observation.x, 0), z: finiteOr(observation.z, 0) });
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.z - left.z);
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits) {
  return Number(finiteOr(value, 0).toFixed(digits));
}
