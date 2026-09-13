// The two controls that move the scene clock, and what a past day costs.
//
// clock.js owns the offset itself and everything that reads it. This owns the
// hour and the day the reader chooses, the labels, and the rule about what
// cannot be shown once the page is standing on a day that has gone.
//
// They are kept apart because the slider is ±12 hours and a date three months
// back is two thousand of them, which would peg the thumb at one end and never
// come off it. The two add up.

import { setOffsetHours, sceneNow } from "./clock.js";

// What cannot be rewound. Ships and aircraft are live positions off a live
// feed and there is no archive to run them back to — the free AIS and ADS-B
// feeds carry now and nothing else. The club's sheet shows today. Rather than
// leave today's traffic standing in a scene from last month, they go, and the
// page says which.
export const GONE_ON_A_PAST_DAY =
  "ships, aircraft and the golf sheet are live and have no archive, so they are "
  + "not shown on a past day";

// Midnight to midnight on the calendar, so dragging the sun across midnight
// does not quietly change the day under the date box.
export function daysBetween(then, now) {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

export function asDateValue(when) {
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`
    + `-${String(when.getDate()).padStart(2, "0")}`;
}

// What the label beside the slider reads. "now" when the page is standing on
// the real clock; the hour and how far it has been dragged when only the hour
// has moved; and just the hour once a day has been chosen, because "14:20
// (-1823h)" tells nobody anything.
export function clockLabel(when, hourShift, dayShift) {
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:`
    + `${String(when.getMinutes()).padStart(2, "0")}`;
  if (hourShift === 0 && dayShift === 0) return "now";
  if (dayShift !== 0) return hhmm;
  const mins = Math.round(hourShift * 60);
  const away = Math.abs(mins);
  return `${hhmm} (${mins > 0 ? "+" : "-"}${Math.floor(away / 60)}h`
    + `${String(away % 60).padStart(2, "0")})`;
}

// #hour=14 opens at two in the afternoon, as an offset from now, so the slider
// and the link say the same thing and a share carries it.
export function hourFromHash(hash, now = new Date()) {
  const m = /(?:^#|&)hour=(-?\d+(?:\.\d+)?)/.exec(String(hash || ""));
  if (!m) return null;
  const want = Number(m[1]);
  if (!Number.isFinite(want) || want < 0 || want >= 24) return null;
  // Not rounded to the slider's minute: hour=14 should put the sun at two
  // o'clock, not six minutes short of it. The thumb snaps, the clock does not.
  return want - (now.getHours() + now.getMinutes() / 60);
}

export class ClockControl {
  // onChange runs after every move, for everything that reads the clock.
  // onPast(past) runs when the page crosses into or out of a past day, for the
  // layers that have to go.
  constructor({ onChange, onPast }) {
    this.range = document.getElementById("clock-range");
    this.value = document.getElementById("clock-value");
    this.date = document.getElementById("clock-date");
    this.note = document.getElementById("past-note");
    this.onChange = onChange;
    this.onPast = onPast;

    this.hourShift = 0;    // what the slider holds, in hours
    this.dayShift = 0;     // whole days back. Never above zero.
    this.wasPast = false;

    this.range.addEventListener("input",
      () => this.setHour(Number(this.range.value) / 60));
    this.date.addEventListener("change", () => {
      if (!this.date.value) { this.setDay(0); return; }
      const [y, m, d] = this.date.value.split("-").map(Number);
      this.setDay(daysBetween(new Date(y, m - 1, d), new Date()));
    });
    document.getElementById("clock-now").addEventListener("click", () => {
      this.dayShift = 0;
      this.setHour(0);
    });
  }

  get past() {
    return this.dayShift < 0;
  }

  // The hour within the day. Everything that moves the sun comes through here:
  // the slider, the novel's route, a recreation, and #hour= in a link.
  setHour(hours) {
    this.hourShift = hours;
    this.apply();
  }

  // Whole days back from today. Nothing forward: a past day can be looked up
  // and a future one cannot.
  setDay(days) {
    this.dayShift = Math.min(0, Math.round(days));
    this.apply();
  }

  // How far back the date may go. The oldest month anything on this page can
  // say a true thing about is the oldest the crossing figures reach.
  setOldest(month) {
    this.date.max = asDateValue(new Date());
    if (month) this.date.min = `${month}-01`;
  }

  apply() {
    setOffsetHours(this.hourShift + this.dayShift * 24);
    // The slider counts minutes. #hour= lands on any offset at all, so the
    // thumb snaps to the nearest minute and the clock does not.
    this.range.value = String(Math.round(this.hourShift * 60));
    const when = sceneNow();
    this.value.textContent = clockLabel(when, this.hourShift, this.dayShift);
    this.date.value = asDateValue(when);

    const past = this.past;
    this.note.textContent = past ? GONE_ON_A_PAST_DAY : "";
    this.note.classList.toggle("hidden", !past);
    if (past !== this.wasPast) {
      this.wasPast = past;
      this.onPast(past);
    }
    this.onChange();
  }
}
