// Local East-North-Up projection about ORIGIN, in metres.
// +X east, +Y up (sea level 0), +Z south. This maps ENU into three.js world
// space where the camera looks toward -X (west).

import { ORIGIN } from "./config.js";

const M_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;
const COS_LAT = Math.cos(ORIGIN.lat * DEG); // ~0.6565 at 48.989

// Metres east and north of ORIGIN for a lat/lon.
export function toENU(lat, lon) {
  const east = (lon - ORIGIN.lon) * M_PER_DEG_LAT * COS_LAT;
  const north = (lat - ORIGIN.lat) * M_PER_DEG_LAT;
  return { east, north };
}

// three.js world coords (Y up). y is supplied by the caller (sea level 0,
// or a vessel deck height, or terrain height). north maps to -Z so that west
// (-lon) lands on -X and the camera facing -X looks west.
export function toWorld(lat, lon, y = 0) {
  const { east, north } = toENU(lat, lon);
  return { x: east, y, z: -north };
}

// Inverse of toWorld's horizontal mapping: world (x, z) -> lat/lon.
export function fromWorld(x, z) {
  return {
    lat: ORIGIN.lat + -z / M_PER_DEG_LAT,
    lon: ORIGIN.lon + x / (M_PER_DEG_LAT * COS_LAT),
  };
}

// Convert a compass heading in degrees (0 = north, 90 = east, clockwise) into a
// three.js rotation about +Y so a mesh whose nose points -Z (north) turns to face
// the heading. north(-Z)->east(+X) is a clockwise turn seen from above, which in
// three.js right-handed Y-up is negative rotation about +Y.
export function headingToYaw(headingDeg) {
  return -headingDeg * DEG;
}
