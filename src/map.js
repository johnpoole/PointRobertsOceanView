// An overview map, drawn flat rather than with a second camera looking down.
// From the ground you cannot tell one road from another, and a top-down render
// of the world has the same problem — it is the same dark terrain seen from
// further away. A line map does what a map is for.
//
// The peninsula never moves, so the roads and the shoreline are drawn once into
// an offscreen canvas and blitted each frame with only the marker on top. That
// keeps a 40 000-point drawing off the per-frame path.

import { toWorld } from "./geo.js";
import { BANDS, noiseField } from "./scene/campground-noise.js";

const BASE_PX = 1400;      // resolution the static map is drawn at
const MARGIN_M = 120;      // breathing room around the outermost feature

// Thin, and by class, so the hierarchy reads at a glance.
const STROKE = {
  secondary: [2.6, "#e8dfc8"], tertiary: [2.2, "#e8dfc8"],
  residential: [1.7, "#c9d3dc"], unclassified: [1.7, "#c9d3dc"],
  service: [1.0, "#8fa0ad"], track: [0.9, "#8fa0ad"],
  footway: [0.7, "#6f8391"], path: [0.7, "#6f8391"],
  cycleway: [0.8, "#6f8391"], bridleway: [0.7, "#6f8391"], steps: [0.7, "#6f8391"],
};
const STROKE_DEFAULT = [1.2, "#8fa0ad"];

export class OverviewMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.base = null;
    this.bounds = null;
    this.landmarks = [];
    this.noise = null;      // how far the campground carries. Built by setNoise.
    this.showNoise = false; // up with the campground, since it is the campground's
  }

  get visible() { return !this.canvas.classList.contains("hidden"); }

  toggle() { this.canvas.classList.toggle("hidden"); }

  // data is the baked OSM features. Everything is projected once here.
  build(data) {
    const lines = [];
    for (const r of data.roads) lines.push({ pts: r.coords, kind: r.kind });
    for (const c of data.coastline) lines.push({ pts: c.coords, kind: "coast" });

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const l of lines) {
      l.world = l.pts.map(([lat, lon]) => toWorld(lat, lon, 0));
      for (const w of l.world) {
        if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
        if (w.z < minZ) minZ = w.z; if (w.z > maxZ) maxZ = w.z;
      }
    }
    if (!isFinite(minX)) return;
    minX -= MARGIN_M; maxX += MARGIN_M; minZ -= MARGIN_M; maxZ += MARGIN_M;
    // Square it off so the map is not stretched in one direction.
    const span = Math.max(maxX - minX, maxZ - minZ);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this.bounds = { x0: cx - span / 2, z0: cz - span / 2, span };

    const base = document.createElement("canvas");
    base.width = base.height = BASE_PX;
    const g = base.getContext("2d");
    const px = (x) => ((x - this.bounds.x0) / span) * BASE_PX;
    const pz = (z) => ((z - this.bounds.z0) / span) * BASE_PX;

    g.lineCap = "round";
    g.lineJoin = "round";
    for (const l of lines) {
      const [w, colour] = l.kind === "coast" ? [1.6, "#cbb98f"] : (STROKE[l.kind] || STROKE_DEFAULT);
      g.lineWidth = w;
      g.strokeStyle = colour;
      g.beginPath();
      l.world.forEach((p, i) => (i ? g.lineTo(px(p.x), pz(p.z)) : g.moveTo(px(p.x), pz(p.z))));
      g.stroke();
    }

    this.landmarks = (data.landmarks || []).map((lm) => {
      const w = toWorld(lm.lat, lm.lon, 0);
      return { name: lm.name, x: w.x, z: w.z };
    });
    this.base = base;
  }

  // The sound layer, off the campground's own site positions. Drawn once into a
  // canvas of its own at the field's resolution and blitted under the road
  // drawing, so the map's line work stays on top of it and stays readable.
  //
  // Painted at full opacity on purpose. The bands were validated for contrast
  // against this panel's own background, and laying them on at half alpha would
  // fade the quietest one back into it and make that check a lie.
  setNoise(sites) {
    if (!this.bounds) {
      throw new Error(
        "OverviewMap.setNoise: called before build(), so there is no projection " +
        "to place the field in. Call build() with the OSM features first.");
    }
    const field = noiseField(sites);
    if (!field) return;
    const c = document.createElement("canvas");
    c.width = c.height = field.cells;
    const g = c.getContext("2d");
    const img = g.createImageData(field.cells, field.cells);
    const rgb = BANDS.map((b) => [
      parseInt(b.color.slice(1, 3), 16),
      parseInt(b.color.slice(3, 5), 16),
      parseInt(b.color.slice(5, 7), 16),
    ]);
    for (let k = 0; k < field.bands.length; k++) {
      const b = field.bands[k];
      if (b < 0) continue;
      img.data[k * 4] = rgb[b][0];
      img.data[k * 4 + 1] = rgb[b][1];
      img.data[k * 4 + 2] = rgb[b][2];
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.noise = { canvas: c, x0: field.x0, z0: field.z0, span: field.span };
  }

  // The key. Four swatches and the decibels they stand for, which is the whole
  // of what the shading means.
  drawNoiseKey(ctx) {
    const sw = 9, row = 12, pad = 6, inset = 6;
    const head = 12;
    const h = head + BANDS.length * row + inset;
    const w = 50;
    ctx.fillStyle = "rgba(8,16,24,0.82)";
    ctx.fillRect(pad, pad, w, h);
    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(232,223,200,0.65)";
    ctx.fillText("dB", pad + inset, pad + head / 2 + 1);
    BANDS.forEach((b, i) => {
      const y = pad + head + i * row;
      ctx.fillStyle = b.color;
      ctx.fillRect(pad + inset, y, sw, sw);
      ctx.fillStyle = "rgba(232,223,200,0.9)";
      ctx.fillText(b.label, pad + inset + sw + 5, y + sw / 2);
    });
    ctx.textBaseline = "alphabetic";
  }

  // Where you are, and which way you are pointing.
  update(x, z, yaw) {
    if (!this.base || !this.visible) return;
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (c.width !== size * dpr) { c.width = c.height = Math.round(size * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const { x0, z0, span } = this.bounds;
    const toPx = (wx, wz) => [((wx - x0) / span) * size, ((wz - z0) / span) * size];

    // Under the roads, and hard-edged: the bands are four colours and smoothing
    // the blit would invent every shade between them.
    if (this.noise && this.showNoise) {
      const n = this.noise;
      const [nx, nz] = toPx(n.x0, n.z0);
      const was = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(n.canvas, nx, nz, (n.span / span) * size, (n.span / span) * size);
      ctx.imageSmoothingEnabled = was;
    }

    ctx.drawImage(this.base, 0, 0, size, size);

    ctx.font = "9px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "rgba(255,206,84,0.95)";
    ctx.textAlign = "center";
    for (const lm of this.landmarks) {
      const [mx, my] = toPx(lm.x, lm.z);
      if (mx < 0 || mx > size || my < 0 || my > size) continue;
      ctx.beginPath();
      ctx.arc(mx, my, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(lm.name, mx, my - 5);
    }

    // The marker: a wedge pointing the way you face.
    const [mx, my] = toPx(x, z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-yaw);              // yaw grows counter-clockwise; canvas y is down
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fillStyle = "#ff7a6b";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(8,16,24,0.9)";
    ctx.stroke();
    ctx.restore();

    if (this.noise && this.showNoise) this.drawNoiseKey(ctx);
  }
}
