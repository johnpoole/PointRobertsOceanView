// Fixed constants for the Point Roberts West Bluff ocean view.
// The camera stands at ORIGIN, eye EYE_HEIGHT_M above sea level, looking due west.
// These are documented constants, not fetched. The client talks only to the local
// proxy (same origin), which owns the upstream data sources.

export const ORIGIN = { lat: 48.989009, lon: -123.085318 }; // 389 W Bluff Rd, Point Roberts, WA

export const VIEW_HEADING_DEG = 270; // due west, true

export const BBOX = {
  minLat: 48.8,
  minLon: -123.5,
  maxLat: 49.18,
  maxLon: -122.95,
};

// A track is stale when the proxy flags it, or its age exceeds these seconds.
export const STALE_SECONDS = {
  vessels: 300,
  aircraft: 120,
};

export const EYE_HEIGHT_M = 20; // camera eye above sea level

// The proxy serves this page and the feed from one origin, so derive the WS URL
// from the page location. Never hardcode a port that could drift from the server.
export const BACKEND_WS = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/live`;

// Baked terrain heightmaps, MLLW datum (same zero as the tide feed).
// near: fine shoreline around the bluff. far: the strait and Gulf Islands skyline.
export const TERRAIN = {
  near: { heightmap: "assets/terrain/heightmap.bin", meta: "assets/terrain/meta.json" },
  far: { heightmap: "assets/terrain/heightmap_far.bin", meta: "assets/terrain/meta_far.json" },
};
