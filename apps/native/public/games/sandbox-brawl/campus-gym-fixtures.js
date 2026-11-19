// The original 1586 × 992 painting had its lower partition at u=688.
// Register collision and occlusion together when the partition is centred.
const registerX = (u) => 793 + (u - 688) * (1586 - 793) / (1586 - 688);

const registerOutline = (outline) => outline.map(([u, v]) => [registerX(u), v]);

function fixture(kind, foot, outline, holes = []) {
  const [left, back, right, front] = foot;
  return {
    kind,
    foot: [registerX(left), back, registerX(right), front],
    silhouette: registerOutline(outline),
    holes: holes.map(registerOutline),
  };
}

// Gym mats have a bevelled edge. Only the strip under the painted top is on
// the floor; the front face projects about 21 px towards the back of the court.
function mat(left, top, right, front) {
  return fixture('pad', [left, top + 21, right, front], [
    [left, top + 5], [left + 2, top + 2], [left + 5, top], [right - 5, top],
    [right - 2, top + 1], [right, top + 5], [right, front - 3],
    [right - 2, front], [left + 2, front], [left, front - 2],
  ]);
}

export const gymFixtures = [
  // Western entry, the rest-area gate and the lower boundary.
  mat(725, 631, 878, 666), mat(853, 612, 878, 666), mat(725, 633, 748, 900),
  mat(725, 863, 770, 900), mat(839, 865, 900, 901),
  mat(875, 806, 901, 974), mat(794, 805, 899, 842),
  mat(793, 689, 817, 839), mat(794, 689, 830, 723),
  mat(906, 688, 943, 726), mat(920, 613, 943, 726),
  mat(877, 945, 1420, 979), mat(1395, 933, 1420, 977),
  // Eastern entry and the gap above the centre circle.
  mat(978, 631, 1003, 720), mat(979, 631, 1133, 665), mat(1111, 612, 1134, 665),
  mat(1176, 613, 1199, 722), mat(1054, 688, 1100, 723),
  mat(1155, 687, 1246, 724), mat(1054, 689, 1079, 781), mat(1222, 632, 1246, 722),
  // Right-hand hook and the wide gap facing the game objectives.
  mat(1222, 631, 1493, 665), mat(1470, 633, 1494, 839),
  mat(1299, 804, 1494, 839), mat(1299, 685, 1324, 839),
  mat(1298, 882, 1324, 931), mat(1299, 685, 1430, 717), mat(1406, 686, 1431, 772),
  // The two nested circuits surrounding the court circle.
  mat(849, 747, 962, 784), mat(940, 748, 966, 931), mat(942, 895, 1324, 932),
  mat(1007, 745, 1110, 781), mat(1172, 745, 1266, 780),
  mat(1006, 746, 1031, 871), mat(1241, 746, 1266, 871), mat(1008, 836, 1265, 873),

  fixture('ballRack', [1357, 610, 1427, 623], [
    [1355, 568], [1360, 569], [1363, 575], [1367, 571], [1415, 571],
    [1420, 575], [1420, 569], [1425, 570], [1427, 616], [1429, 619],
    [1427, 623], [1421, 623], [1419, 612], [1366, 612], [1363, 623], [1356, 622],
  ]),
  fixture('vault', [1451, 608, 1518, 623], [
    [1451, 613], [1456, 596], [1460, 580], [1464, 573], [1509, 573],
    [1513, 576], [1517, 598], [1521, 620], [1518, 623], [1450, 623],
  ]),
  // The suspended backboard faces into the room; only its wall bracket reaches
  // the boundary. The clear wood below the rim stays traversable.
  fixture('basket', [1574, 749, 1581, 770], [
    [1524, 665], [1528, 665], [1562, 704], [1570, 698], [1576, 695],
    [1580, 697], [1583, 769], [1574, 773], [1560, 751], [1561, 759],
    [1555, 755], [1535, 731], [1530, 748], [1524, 753], [1515, 744],
    [1511, 732], [1503, 727], [1502, 721], [1507, 718], [1522, 713],
  ], [
    [[1508, 721], [1512, 719], [1521, 718], [1528, 720], [1530, 722],
      [1527, 724], [1513, 725], [1508, 724]],
    [[1560, 711], [1570, 709], [1569, 727], [1560, 727]],
    [[1567, 737], [1571, 736], [1571, 743]],
  ]),
  fixture('bench', [707, 954, 817, 971], [
    [705, 956], [708, 949], [709, 934], [713, 931], [731, 931], [734, 934],
    [738, 931], [810, 931], [813, 934], [816, 952], [818, 956], [815, 960],
    [815, 971], [810, 971], [809, 960], [715, 960], [714, 971], [708, 971], [709, 960],
  ]),
  fixture('cooler', [820, 957, 844, 971], [
    [819, 946], [822, 938], [820, 932], [820, 915], [822, 911], [829, 908],
    [837, 909], [843, 912], [843, 932], [840, 937], [845, 944], [845, 966],
    [842, 971], [820, 970],
  ]),
  fixture('bin', [848, 960, 865, 971], [
    [846, 946], [850, 941], [860, 941], [865, 945], [865, 951],
    [863, 969], [860, 971], [849, 970], [847, 953],
  ]),
];
