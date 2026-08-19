// The card for the ship or the aircraft you picked, and the list you can pick
// one from. The tooltip under the cursor is a handful of lines; the card is the
// whole record — every field the feed carries about that one track, plus where
// it is, how far off it is and which way it bears from where you are standing,
// and where the position came from.
//
// The card reads the feed by key every refresh rather than holding the object it
// was opened on, so the numbers are the ones arriving now. A track that drops
// out of the feed says so and stops showing figures, because the last ones are
// no longer true and there is nothing here worth guessing at.
//
// The list is there because a finger is not a cursor. Tapping the ship puts a
// hand over the ship and over whatever is drawn near it, so the list gives a way
// in that keeps the hand at the bottom of the glass and the reading at the top.

import { toWorld } from "./geo.js";
import { Vessels } from "./scene/vessels.js";
import { Aircraft } from "./scene/aircraft.js";

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                   "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const M_PER_NM = 1852;
// How often the list is rebuilt while it is open. Positions arrive slower than
// this and the ranges only creep.
const LIST_REFRESH_S = 1;
// Four times a second. The feed arrives slower than that and a range that
// re-reads on every frame is sixty DOM rewrites a second for nothing.
const REFRESH_S = 0.25;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function cardinal(deg) {
  return CARDINALS[Math.round(deg / 22.5) % 16];
}

export function latText(lat) {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}`;
}

export function lonText(lon) {
  return `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? "E" : "W"}`;
}

// True bearing from a world-space offset. North is -Z, east is +X, so due north
// comes out 0 and due east 90.
export function bearing(dx, dz) {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

// Straight-line metres from the eye to a track, through the air, so an aircraft
// three kilometres up is further off than its position on the water.
function rangeFrom(camera, state) {
  const w = toWorld(state.latitude, state.longitude,
                    state.altitude_m != null ? state.altitude_m : 0);
  const c = camera.position;
  const dx = w.x - c.x, dy = w.y - c.y, dz = w.z - c.z;
  return { dx, dy, dz, range: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

// What to call a track in one line: its name if it has one, and what it is known
// by if it has not.
function trackName(kind, state) {
  if (kind === "vessel") return (state.name && state.name.trim()) || String(state.mmsi);
  return state.callsign || state.registration || String(state.icao);
}

function clockText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

export class Selection {
  constructor(camera, feed) {
    this.camera = camera;
    this.feed = feed;
    this.pick = null;   // { kind: "vessel" | "aircraft", id }
    this.card = document.getElementById("track");
    this.titleEl = document.getElementById("track-title");
    this.rowsEl = document.getElementById("track-rows");
    document.getElementById("track-close").addEventListener("click", () => this.clear());
    this._due = 0;
  }

  // Drawn on the spot rather than on the next frame. A frame on a machine with
  // no GPU is seconds long and a card that turns up after the click has already
  // been forgotten is a card that did not work.
  select(kind, id) {
    if (id == null) return;
    this.pick = { kind, id };
    this._due = 0;
    this._refresh();
  }

  clear() {
    this.pick = null;
    this.card.classList.add("hidden");
  }

  update(t) {
    if (!this.pick) return;
    if (t < this._due) return;
    this._due = t + REFRESH_S;
    this._refresh();
  }

  _refresh() {
    const feed = this.feed;
    const vessel = this.pick.kind === "vessel";
    const entry = vessel ? feed.vessels.get(this.pick.id) : feed.aircraft.get(this.pick.id);
    if (!entry) {
      this._draw(String(this.pick.id), [["track", "gone from the feed"]], false);
      return;
    }
    const state = entry.data;
    const title = trackName(this.pick.kind, state);
    const rows = vessel ? Vessels.detail(state) : Aircraft.detail(state);
    rows.push(...this._where(state));
    rows.push(...this._provenance(entry));
    this._draw(title, rows, feed.isStale(entry, vessel ? "vessels" : "aircraft"));
  }

  // Where it is, and where it is from here.
  _where(state) {
    if (state.latitude == null || state.longitude == null) return [];
    const rows = [["latitude", latText(state.latitude)],
                  ["longitude", lonText(state.longitude)]];
    const { dx, dz, range } = rangeFrom(this.camera, state);
    rows.push(["range", `${(range / 1000).toFixed(2)} km · ${(range / M_PER_NM).toFixed(2)} nm`]);
    const brg = bearing(dx, dz);
    rows.push(["bearing", `${Math.round(brg)}° ${cardinal(brg)}`]);
    return rows;
  }

  // Who said so and when. A scraped position is labelled scraped here the same
  // as it is everywhere else.
  _provenance(entry) {
    const rows = [];
    if (entry.source) rows.push(["source", entry.source]);
    if (entry.source_time) rows.push(["fix", clockText(entry.source_time)]);
    const age = entry.quality ? entry.quality.age_seconds : null;
    if (age != null) rows.push(["age", `${Math.round(age)} s`]);
    for (const w of (entry.quality && entry.quality.warnings) || []) {
      rows.push(["warning", w]);
    }
    return rows;
  }

  _draw(title, rows, stale) {
    this.titleEl.textContent = title;
    this.rowsEl.innerHTML = rows
      .map(([k, v]) => `<div class="tip-row"><span class="tip-k">${esc(k)}</span><span class="tip-v">${esc(v)}</span></div>`)
      .join("") + (stale ? `<div class="tip-stale">stale</div>` : "");
    this.card.classList.remove("hidden");
  }
}

// Everything the feed is tracking, nearest first, to pick one from without
// putting a hand over the water. Names on the left and the range on the right,
// vessels then aircraft, and the one the card is showing is marked.
export class TrackList {
  constructor(camera, feed, selection) {
    this.camera = camera;
    this.feed = feed;
    this.selection = selection;
    this.panel = document.getElementById("tracks");
    this.rowsEl = document.getElementById("tracks-rows");
    this.button = document.getElementById("tracks-btn");
    this.visible = false;
    this._due = 0;

    // The rows are only ever replaced when the set of tracks changes, and never
    // while a hand is on them: a rebuild under a finger that is coming down
    // detaches the row it was aimed at, and the press lands on whatever the next
    // rebuild put there. That happened on the first try of this list.
    this._held = false;
    this._sig = null;

    document.getElementById("tracks-close").addEventListener("click", () => this.hide());
    this.panel.addEventListener("pointerdown", () => { this._held = true; });
    for (const ev of ["pointerup", "pointercancel"]) {
      window.addEventListener(ev, () => {
        if (!this._held) return;
        this._held = false;
        if (this.visible) this._draw();
      });
    }
    this.rowsEl.addEventListener("click", (e) => {
      const row = e.target.closest("button[data-id]");
      if (!row) return;
      this.selection.select(row.dataset.kind, row.dataset.id);
      this._mark();
    });
  }

  toggle() { if (this.visible) this.hide(); else this.show(); }

  show() {
    this.visible = true;
    this.panel.classList.remove("hidden");
    this.button.classList.add("on");
    this._due = 0;
    this._draw();
  }

  hide() {
    this.visible = false;
    this.panel.classList.add("hidden");
    this.button.classList.remove("on");
  }

  update(t) {
    if (!this.visible) return;
    if (t < this._due) return;
    this._due = t + LIST_REFRESH_S;
    this._draw();
  }

  _rows(kind, tracked) {
    const out = [];
    for (const [id, entry] of tracked) {
      const state = entry.data;
      if (state.latitude == null || state.longitude == null) continue;
      out.push({ kind, id, name: trackName(kind, state),
                 range: rangeFrom(this.camera, state).range });
    }
    out.sort((a, b) => a.range - b.range);
    return out;
  }

  _draw() {
    if (this._held) return;
    const items = [];
    for (const [kind, label, tracked] of
         [["vessel", "vessels", this.feed.vessels],
          ["aircraft", "aircraft", this.feed.aircraft]]) {
      const rows = this._rows(kind, tracked);
      items.push({ heading: `${label} · ${rows.length}` });
      for (const r of rows) items.push(r);
    }

    // Which tracks are listed and in what order. The names and the ranges are
    // not in it: those change every refresh and are written into the rows that
    // are already there.
    const sig = items.map((i) => i.heading || `${i.kind}:${i.id}`).join("|");
    if (sig !== this._sig) {
      this._sig = sig;
      const scroll = this.rowsEl.scrollTop;
      this.rowsEl.innerHTML = items.map((i) => i.heading
        ? `<div class="tracks-group"></div>`
        : `<button class="tracks-row" data-kind="${i.kind}" data-id="${esc(i.id)}">` +
          `<span class="tip-k"></span><span class="tip-v"></span></button>`).join("");
      this.rowsEl.scrollTop = scroll;
    }

    const nodes = this.rowsEl.children;
    for (let i = 0; i < items.length; i++) {
      const item = items[i], node = nodes[i];
      if (item.heading) { node.textContent = item.heading; continue; }
      node.firstElementChild.textContent = item.name;
      node.lastElementChild.textContent = `${(item.range / 1000).toFixed(1)} km`;
    }
    this._mark();
  }

  // Which row the card is showing.
  _mark() {
    const pick = this.selection.pick;
    for (const node of this.rowsEl.querySelectorAll("button[data-id]")) {
      node.classList.toggle("on", !!pick && pick.kind === node.dataset.kind
                                  && pick.id === node.dataset.id);
    }
  }
}
