/**
 * Limited airborne yaw control (#5).
 * Authority is a fraction of a ground yaw-rate reference so A1 lands in [0.15, 0.30].
 * Does not touch land-feel / tire / grip parameters.
 */

export const AIR_YAW_AUTHORITY_MIN = 0.15;
export const AIR_YAW_AUTHORITY_MAX = 0.3;

/** Mid-band default: yawRate_air_max / yawRate_ground_ref ≈ 0.22 */
export const AIR_YAW_AUTHORITY = 0.22;

/**
 * Reference peak |Δheading|/Δt (rad/s) for full-steer on asphalt ~1–2 s cruise.
 * Used as the A1 denominator when a live ground sample is unavailable.
 */
export const GROUND_YAW_RATE_REFERENCE = 1.15;

/** A2: with |steering|≈0, extra heading drift over a typical jump must stay under this (rad). */
export const AIR_YAW_ZERO_INPUT_DRIFT_LIMIT = 0.05;

export function clampAirYawAuthority(value, fallback = AIR_YAW_AUTHORITY) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(AIR_YAW_AUTHORITY_MAX, Math.max(AIR_YAW_AUTHORITY_MIN, n));
}

export function resolveAirYawRateMax({
  authority = AIR_YAW_AUTHORITY,
  groundYawRateMax = GROUND_YAW_RATE_REFERENCE
} = {}) {
  const ratio = clampAirYawAuthority(authority);
  const ground = Number(groundYawRateMax);
  const groundMax = Number.isFinite(ground) && ground > 0 ? ground : GROUND_YAW_RATE_REFERENCE;
  return ratio * groundMax;
}

/**
 * Target body yaw rate (rad/s) while airborne. Zero when grounded or no steer.
 * Sign follows steering: positive steer → positive yaw rate (left in engine convention).
 */
export function resolveAirYawRate({
  airborne = false,
  steering = 0,
  authority = AIR_YAW_AUTHORITY,
  groundYawRateMax = GROUND_YAW_RATE_REFERENCE
} = {}) {
  if (!airborne) return 0;
  const steer = Number(steering);
  if (!Number.isFinite(steer) || Math.abs(steer) < 1e-4) return 0;
  const clampedSteer = Math.max(-1, Math.min(1, steer));
  return clampedSteer * resolveAirYawRateMax({ authority, groundYawRateMax });
}

export function integrateAirYawHeading(heading, yawRate, deltaSeconds) {
  const h = Number(heading);
  const rate = Number(yawRate);
  const dt = Number(deltaSeconds);
  if (![h, rate, dt].every(Number.isFinite) || dt <= 0) return Number.isFinite(h) ? h : 0;
  return h + rate * dt;
}

/** Rotate planar velocity with yaw delta so flight path follows nose slightly. */
export function rotatePlanarVelocity(velocityX, velocityZ, yawDelta) {
  const x = Number(velocityX);
  const z = Number(velocityZ);
  const d = Number(yawDelta);
  if (![x, z, d].every(Number.isFinite) || Math.abs(d) < 1e-8) {
    return { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
  }
  const cos = Math.cos(d);
  const sin = Math.sin(d);
  return {
    x: x * cos + z * sin,
    z: -x * sin + z * cos
  };
}

/**
 * One-step attitude assist update: weak yaw from steering, keep pitch/roll locked via yaw-only pose.
 */
export function stepAirAttitudeAssist({
  assistedHeading = 0,
  assistedVelocityX = 0,
  assistedVelocityZ = 0,
  steering = 0,
  deltaSeconds = 0,
  authority = AIR_YAW_AUTHORITY,
  groundYawRateMax = GROUND_YAW_RATE_REFERENCE
} = {}) {
  const yawRate = resolveAirYawRate({
    airborne: true,
    steering,
    authority,
    groundYawRateMax
  });
  const nextHeading = integrateAirYawHeading(assistedHeading, yawRate, deltaSeconds);
  const yawDelta = nextHeading - assistedHeading;
  const planar = rotatePlanarVelocity(assistedVelocityX, assistedVelocityZ, yawDelta);
  return {
    assistedHeading: nextHeading,
    assistedVelocityX: planar.x,
    assistedVelocityZ: planar.z,
    yawRate,
    yawDelta
  };
}
