export const FREE_DRIVE_JUMP = Object.freeze({
  corridorMinY: 8,
  rampMinX: 154,
  gapMinX: 178,
  gapMaxX: 202,
  rampMaxX: 226,
  rampRise: 3.6,
  minLaunchSpeed: 25,
  gravity: 18
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smootherstep(value) {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function isFreeDriveJumpCorridor(position) {
  return position.y > FREE_DRIVE_JUMP.corridorMinY
    && position.x >= FREE_DRIVE_JUMP.rampMinX
    && position.x <= FREE_DRIVE_JUMP.rampMaxX;
}

export function isFreeDriveJumpGap(position) {
  return position.y > FREE_DRIVE_JUMP.corridorMinY
    && position.x > FREE_DRIVE_JUMP.gapMinX
    && position.x < FREE_DRIVE_JUMP.gapMaxX;
}

export function freeDriveJumpRampRise(position) {
  if (!isFreeDriveJumpCorridor(position)) return 0;
  if (position.x <= FREE_DRIVE_JUMP.gapMinX) {
    return FREE_DRIVE_JUMP.rampRise * smootherstep(
      (position.x - FREE_DRIVE_JUMP.rampMinX)
        / (FREE_DRIVE_JUMP.gapMinX - FREE_DRIVE_JUMP.rampMinX)
    );
  }
  if (position.x >= FREE_DRIVE_JUMP.gapMaxX) {
    return FREE_DRIVE_JUMP.rampRise * (1 - smootherstep(
      (position.x - FREE_DRIVE_JUMP.gapMaxX)
        / (FREE_DRIVE_JUMP.rampMaxX - FREE_DRIVE_JUMP.gapMaxX)
    ));
  }
  return FREE_DRIVE_JUMP.rampRise;
}

export function isFreeDriveJumpGapSegment(start, end) {
  return isFreeDriveJumpGap({
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5
  });
}

export function resolveFreeDriveJumpLaunch(position, velocity) {
  if (!isFreeDriveJumpCorridor(position)) return null;
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed < FREE_DRIVE_JUMP.minLaunchSpeed) return null;
  const movingTowardGapFromLeft = velocity.x > 0
    && position.x >= FREE_DRIVE_JUMP.gapMinX - 3
    && position.x <= FREE_DRIVE_JUMP.gapMinX + 1;
  const movingTowardGapFromRight = velocity.x < 0
    && position.x >= FREE_DRIVE_JUMP.gapMaxX - 1
    && position.x <= FREE_DRIVE_JUMP.gapMaxX + 3;
  if (!movingTowardGapFromLeft && !movingTowardGapFromRight) return null;

  const flightSeconds = (FREE_DRIVE_JUMP.gapMaxX - FREE_DRIVE_JUMP.gapMinX) / Math.abs(velocity.x);
  return {
    verticalSpeed: Math.max(4.4, Math.min(9.5, FREE_DRIVE_JUMP.gravity * flightSeconds * 0.5)),
    direction: movingTowardGapFromLeft ? 1 : -1
  };
}
