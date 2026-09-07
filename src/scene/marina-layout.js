// Shared mapped positions; kept small so the base scene does not import marina detail.
import { DOCK_PLAN } from "./marina-dock-plan.js";

export const MARINA = {
  flagpole: [48.97680028, -123.06330009],
  shelter: [48.97700763, -123.06348424],
  hut: [48.97681698, -123.06359653],
  pier: [48.97684450, -123.06362198],
  floatSouth: DOCK_PLAN.points.south,
  floatNorth: DOCK_PLAN.points.north,
  fuelHut: DOCK_PLAN.points.hut,
};
// This baked footprint is a solid block over open water in the 2022 aerial
// and both webcam views. Match only this exact trace, not nearby buildings.
export function obsoleteMarinaBlock(building) {
  const p=building.coords?.[0];
  return p && Math.abs(p[0]-48.9770208)<1e-8 && Math.abs(p[1]+123.0642513)<1e-8;
}

