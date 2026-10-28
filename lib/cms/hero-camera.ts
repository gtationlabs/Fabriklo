/**
 * Camera moves for the 3D store tour, derived from data the hero editor already
 * stores, so no schema change is needed.
 *
 * The direction the visitor "turns" between two scenes comes from the next
 * scene's focus point (object_position X): left of centre means the camera
 * turns left, right of centre turns right, and near the centre it walks
 * straight ahead.
 */
export type CameraTurn = -1 | 0 | 1;

/** Within this many percent of centre the camera walks straight ahead. */
const FORWARD_BAND = 3;

export function focusX(objectPosition: string): number {
  const x = Number.parseFloat(objectPosition.split(" ")[0] ?? "50");
  return Number.isFinite(x) ? x : 50;
}

export function cameraTurn(nextObjectPosition: string): CameraTurn {
  const dx = focusX(nextObjectPosition) - 50;
  if (Math.abs(dx) <= FORWARD_BAND) return 0;
  return dx < 0 ? -1 : 1;
}

/**
 * Start pose of the next scene and end pose of the current one for a turn.
 * Turning left, the room you leave slides right and swings away on its right
 * edge, while the room you face swings in from the left (and vice versa).
 * Walking forward you pass through the current view and the next one comes
 * up from further away.
 */
export function turnPoses(turn: CameraTurn, strength: number) {
  const k = Math.max(0, strength);
  if (turn === 0) {
    return {
      leave: { z: 520 * k, xPercent: 0, rotationY: 0 },
      enter: { z: -320 * k, xPercent: 0, rotationY: 0 },
    };
  }
  return {
    leave: { z: 160 * k, xPercent: -turn * 34 * k, rotationY: -turn * 32 * k },
    enter: { z: -140 * k, xPercent: turn * 34 * k, rotationY: turn * 32 * k },
  };
}
