// Keep a square source pixel square on screen under the campus camera.
// The back wall's painted floor line meets the two actual corridor doors.
export const campusElevation = Math.asin(13.4 / 18.25);
export const gymScaleX = 38.55 / 1774;
export const gymScaleZ = gymScaleX / Math.sin(campusElevation);
export const gymBounds = {
  x0: 0.85,
  x1: 39.4,
  z0: 6.45 - 150 * gymScaleZ,
  z1: 6.45 + (887 - 150) * gymScaleZ,
};

export function gymFloorPoint(u, v) {
  return [gymBounds.x0 + u * gymScaleX, gymBounds.z0 + v * gymScaleZ];
}
