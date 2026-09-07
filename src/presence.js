import { fromWorld } from "./geo.js";

// Camera pose remains the viewpoint used by older clients and the visitor list.
// Vehicle pose is independent of the driver's head turn and seat offset.
export function travelPresence(nav) {
  const mode = nav.mode === "vehicle" ? nav.vehicle.id : nav.mode;
  const body = nav.mode === "boat" ? nav.boat : nav.mode === "vehicle" ? nav.rider : null;
  if (!body) return { mode };
  const { lat, lon } = fromWorld(body.pos.x, body.pos.z);
  const degrees = 180 / Math.PI;
  return { mode, body: { lat, lon, y: body.pos.y, heading: body.yaw * degrees,
    pitch: (nav.mode === "boat" ? body.trim : body.pitch) * degrees,
    roll: (nav.mode === "boat" ? body.bank : body.roll) * degrees } };
}
