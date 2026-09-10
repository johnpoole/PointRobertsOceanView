// The old Breakers parking lot as it stands: its corners, where the hedge
// actually is, and the parking aisles still on the ground.
//
// Kept apart from brademy.js because none of it needs three, which lets it be
// checked without one. What the courts would be is next door in brademy.js;
// this file is only what is there now.

// The old Breakers parking lot, clockwise from the northeast. Supplied, not
// surveyed.
export const LOT = [
  [48.9841635665451, -123.08228060944315],   // NE
  [48.98333968343413, -123.08216612219306],  // SE
  [48.98334018863542, -123.08313207910217],  // SW
  [48.98418392813251, -123.08315269838253],  // NW
];

// The hedge is not round the lot. On the county 2022 aerial the east side along
// the road is a thick unbroken line of it, the south side is hedged the whole
// way, the north side carries scrub over its eastern half only, and the west
// side has none at all — the lot runs straight out onto the paved yard next
// door. Measured off that image rather than assumed: a band a metre either side
// of each boundary, tested for dark green, came back 43% on the east, 33% on the
// south, 33% at the east end of the north, and 3% on the west, which is nothing.
//
// Each run is a side of the lot and the stretch of it that is hedged, as a
// fraction from the first corner of that side to the second.
export const HEDGE_RUNS = [
  { side: 0, from: 0.00, to: 1.00 },   // east, NE to SE, the road frontage
  { side: 1, from: 0.00, to: 1.00 },   // south, SE to SW
  { side: 3, from: 0.50, to: 1.00 },   // north, the eastern half of NW to NE
];

// What is actually on the lot: six old parking aisles running north and south,
// cracked asphalt with grass between them. Pulled off the county 2022 aerial by
// taking every column of the lot that reads grey rather than green, so these are
// measured off the image and not drawn by eye. Each is the northwest corner and
// the southeast corner of one strip.
export const AISLES = [
  [[48.9840118, -123.0831141], [48.9833539, -123.0830348]],
  [[48.9841160, -123.0829172], [48.9833432, -123.0828422]],
  [[48.9841218, -123.0827981], [48.9833432, -123.0827422]],
  [[48.9841208, -123.0826496], [48.9833432, -123.0825967]],
  [[48.9841671, -123.0825732], [48.9833432, -123.0825012]],
  [[48.9841594, -123.0823836], [48.9833432, -123.0823101]],
];
