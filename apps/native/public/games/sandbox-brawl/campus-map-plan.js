// The map is one orthographic painting. A single projection registers every
// room, doorway, shadow, and collision shape to its original painted pixels.
export const plateWidth = 1586;
export const plateHeight = 992;
export const campusElevation = Math.asin(13.4 / 18.25);
export const pixelWidth = 80 / plateWidth;
export const pixelDepth = pixelWidth / Math.sin(campusElevation);
export const mapHalfDepth = (plateHeight * pixelDepth) / 2;

export function floorPoint(u, v) {
  return [(u - plateWidth / 2) * pixelWidth, (v - plateHeight / 2) * pixelDepth];
}

export const hallNorth = floorPoint(0, 460)[1];
export const hallSouth = floorPoint(0, 535)[1];

function partition(left, top, right, front, back = top) {
  return {
    kind: 'wall',
    foot: [left, back, right, front],
    silhouette: [
      [left, top],
      [right, top],
      [right, front],
      [left, front],
    ],
  };
}

const studioAndGymWallFront = 613;

export const architecture = [
  partition(0, 0, 1586, 124),
  partition(0, 0, 28, 992),
  partition(1556, 0, 1586, 992),
  partition(0, 978, 1586, 992),
  // Shared partition opens directly between the classroom and laboratory.
  partition(783, 0, 804, 256),
  partition(783, 325, 804, 458),
  partition(783, 533, 806, 985),
  // Front edges of the homeroom and science lab, with a gap at each sill.
  partition(24, 439, 371, 461),
  partition(455, 439, 1138, 461),
  partition(1222, 439, 1564, 461),
  // Two studio doors and the neighbouring gym wall share a floor line.
  partition(21, 534, 176, studioAndGymWallFront),
  partition(251, 534, 366, studioAndGymWallFront),
  partition(452, 534, 793, studioAndGymWallFront),
  partition(793, 534, 949, studioAndGymWallFront),
  partition(1003, 534, 1177, 620),
  partition(1234, 534, 1563, 620),
];

export const roomViews = {
  classroom: { center: [397, 228], feet: [411, 352], bounds: [0, 0, 793, 461] },
  lab: { center: [1190, 228], feet: [1180, 330], bounds: [793, 0, 1586, 461] },
  art: { center: [397, 762], feet: [426, 750], bounds: [0, 533, 793, 992] },
  gym: { center: [1190, 762], feet: [1208, 651], bounds: [793, 533, 1586, 992] },
};
