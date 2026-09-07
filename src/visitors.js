import { fromWorld, toWorld } from "./geo.js";

// Stand behind the avatar, looking at its torso. Presence heading is camera
// yaw (positive toward west), rather than a compass bearing.
export function visitorView(at, sample = () => 0) {
  const p = toWorld(at.lat, at.lon, at.y);
  const feet = Math.max(p.y - 1.62, sample(at.lat, at.lon));
  const yaw = at.heading * Math.PI / 180;
  const eye = { x: p.x + Math.sin(yaw) * 6, y: feet + 3,
                z: p.z + Math.cos(yaw) * 6 };
  const ll = fromWorld(eye.x, eye.z);
  eye.y = Math.max(eye.y, sample(ll.lat, ll.lon) + 1.62);
  return { eye, aim: { x: p.x, y: feet + 1, z: p.z } };
}

export class VisitorList {
  constructor(feed, camera, goTo) {
    this.feed = feed;
    this.camera = camera;
    this.goTo = goTo;
    this.rows = new Map();
    this.nextLabel = 1;
    this.button = document.getElementById("visitors-btn");
    this.panel = document.getElementById("visitors");
    this.list = document.getElementById("visitors-rows");
    this.status = document.getElementById("visitors-status");
    this.close = document.getElementById("visitors-close");
    this.button.addEventListener("click", () => this.show(this.panel.classList.contains("hidden")));
    this.close.addEventListener("click", () => this.show(false));
    this.panel.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") this.show(false);
    });
    this.panel.addEventListener("keyup", e => e.stopPropagation());
    feed.onChange(kind => {
      if (["presence", "open", "close"].includes(kind)) this.update();
    });
    this.update();
  }

  show(on) {
    this.panel.classList.toggle("hidden", !on);
    this.button.setAttribute("aria-expanded", String(on));
    if (on) { this.update(); this.close.focus(); }
    else this.button.focus();
  }

  update() {
    // Match the avatar renderer's 64-instance limit and order.
    const here = new Map(this.feed.connected ? [...this.feed.presence].slice(0, 64) : []);
    const total = this.feed.connected ? this.feed.presence.size : 0;
    this.button.textContent = this.feed.connected ? `Visitors (${total})` : "Visitors · offline";
    this.status.textContent = !this.feed.connected ? "Visitor feed offline."
      : !total ? "No other visitors are here."
      : total > 64 ? `Showing 64 of ${total} other viewpoints.`
      : "Other viewpoints · one per open tab";
    for (const [id, row] of this.rows) {
      if (here.has(id)) continue;
      if (row.el.contains(document.activeElement)) this.close.focus();
      row.el.remove();
      this.rows.delete(id);
    }
    for (const [id, at] of here) {
      let row = this.rows.get(id);
      if (!row) {
        const label = `Visitor ${this.nextLabel++}`;
        const el = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = label;
        const distance = document.createElement("span");
        distance.className = "dim";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Go to";
        button.setAttribute("aria-label", `Go to ${label}`);
        button.addEventListener("click", () => {
          // Read at click time: a row may have moved or left since it was drawn.
          const latest = this.feed.connected && this.feed.presence.get(id);
          if (!latest) { this.update(); return; }
          this.goTo(latest);
          this.show(false);
        });
        el.append(name, distance, button);
        this.list.append(el);
        row = { el, distance };
        this.rows.set(id, row);
      }
      const p = toWorld(at.lat, at.lon, at.y);
      const d = Math.hypot(p.x - this.camera.position.x, p.y - this.camera.position.y,
                           p.z - this.camera.position.z);
      row.distance.textContent = d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
    }
  }
}
