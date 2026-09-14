// Ships and aircraft where they were, for a clock that has been moved back.
//
// The server writes down every position it receives (server/tracks.py). This
// asks it for the half hour either side of the moment the scene stands at, and
// works out where each ship and aircraft was at that moment: on a straight line
// between the two written positions either side of it, or at the last one if it
// was lying still. A moment nothing was written for has nobody in it, rather
// than today's traffic standing in the wrong hour.
//
// What it hands back has the shape of the live feed, so the code that draws
// ships and aircraft draws these without knowing the difference.

const HALF_WINDOW_S = 30 * 60;
const REFETCH_EDGE_S = 5 * 60;      // fetch again this close to the edge of what is held
const RETRY_S = 20;
// How long after its last written position a track is still drawn there. A ship
// at anchor is written once a minute, so a few minutes covers the gaps; a plane
// that has not been written for half a minute has gone.
const HOLD_S = { vessels: 300, aircraft: 30 };

// The shorter way round from one bearing to another, k of the way.
function bearing(a, b, k) {
  if (a == null || b == null) return a ?? b;
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

function number(a, b, k) {
  if (a == null || b == null) return a ?? b;
  return a + (b - a) * k;
}

// Where one track was at t (epoch seconds), as the same fields the live feed
// carries, or null if the record does not say.
export function stateAt(track, kind, t, gapS) {
  const pts = track.points;
  if (!pts.length || t < pts[0][0]) return null;
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1][0] <= t) i++;
  const a = pts[i], b = pts[i + 1];
  let lat, lon, m;
  if (b && b[0] - a[0] <= gapS) {
    const k = (t - a[0]) / (b[0] - a[0]);
    lat = number(a[1], b[1], k);
    lon = number(a[2], b[2], k);
    m = kind === "vessels"
      ? [number(a[3], b[3], k), bearing(a[4], b[4], k), bearing(a[5], b[5], k)]
      : [number(a[3], b[3], k), number(a[4], b[4], k), bearing(a[5], b[5], k)];
  } else if (t - a[0] <= HOLD_S[kind]) {
    [, lat, lon, ...m] = a;
  } else {
    return null;
  }
  const info = track.info || {};
  if (kind === "vessels") {
    return { ...info, latitude: lat, longitude: lon, speed_over_ground_knots: m[0],
             course_over_ground_degrees: m[1], true_heading_degrees: m[2] };
  }
  return { ...info, latitude: lat, longitude: lon, altitude_m: m[0],
           ground_speed_kn: m[1], track_degrees: m[2] };
}

export class Replay {
  constructor(fetchJson = (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return r.json();
  })) {
    this.fetchJson = fetchJson;
    this.held = { vessels: null, aircraft: null };      // {start, end, gap, tracks}
    this.loading = { vessels: false, aircraft: false };
    this.failedAt = { vessels: 0, aircraft: 0 };
  }

  // Fetch the record round t if what is held does not reach far enough.
  ensure(when) {
    const t = when.getTime() / 1000;
    for (const kind of ["vessels", "aircraft"]) {
      const held = this.held[kind];
      const covered = held && t - REFETCH_EDGE_S >= held.start && t + REFETCH_EDGE_S <= held.end;
      if (covered || this.loading[kind]) continue;
      if (Date.now() / 1000 - this.failedAt[kind] < RETRY_S) continue;
      this.loading[kind] = true;
      const start = new Date((t - HALF_WINDOW_S) * 1000).toISOString();
      const end = new Date((t + HALF_WINDOW_S) * 1000).toISOString();
      this.fetchJson(`/api/tracks?kind=${kind}&start=${start}&end=${end}`)
        .then((got) => {
          this.held[kind] = { start: t - HALF_WINDOW_S, end: t + HALF_WINDOW_S,
                              gap: got.gap_s, tracks: got.tracks };
        })
        .catch((err) => {
          // Said, and tried again shortly. Until then there is nothing to draw,
          // which is what the scene shows.
          console.error(`The ${kind} record could not be read:`, err);
          this.failedAt[kind] = Date.now() / 1000;
        })
        .finally(() => { this.loading[kind] = false; });
    }
  }

  // The scene's ships and aircraft at a moment, in the live feed's shape.
  feedAt(when) {
    const t = when.getTime() / 1000;
    const out = { vessels: new Map(), aircraft: new Map(), isStale: () => false };
    for (const kind of ["vessels", "aircraft"]) {
      const held = this.held[kind];
      if (!held || t < held.start || t > held.end) continue;
      for (const [id, track] of Object.entries(held.tracks)) {
        const data = stateAt(track, kind, t, held.gap);
        if (data) out[kind].set(id, { data });
      }
    }
    return out;
  }
}
