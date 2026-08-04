// WebSocket client for the local proxy. Parses messages by message_type, keeps
// the world state (vessels keyed by mmsi, latest weather and tide, provider
// health, connection state), and reconnects with backoff. It never invents
// data: when the socket is down, connected is false and callers show it.

import { BACKEND_WS, STALE_SECONDS } from "./config.js";

export class Feed {
  constructor() {
    this.connected = false;
    this.vessels = new Map(); // mmsi -> { data, quality, receivedTime }
    this.weather = null;      // { data, quality }
    this.tide = null;         // { data, quality }
    this.providerHealth = { weather: "offline", tide: "offline", vessels: "offline", aircraft: "offline" };
    this.lastMessageAt = 0;

    this._ws = null;
    this._backoff = 1000;
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(kind) {
    for (const fn of this._listeners) fn(kind, this);
  }

  connect() {
    let ws;
    try {
      ws = new WebSocket(BACKEND_WS);
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._backoff = 1000;
      this._emit("open");
    };

    ws.onmessage = (event) => {
      this.lastMessageAt = performance.now();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.error("feed: bad JSON", err);
        return;
      }
      this._handle(msg);
    };

    ws.onclose = () => {
      this.connected = false;
      this._ws = null;
      this._emit("close");
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows; reconnect is handled there.
      try { ws.close(); } catch (err) { /* already closing */ }
    };
  }

  _scheduleReconnect() {
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, 15000);
    setTimeout(() => this.connect(), delay);
  }

  _handle(msg) {
    switch (msg.message_type) {
      case "initial.snapshot":
        this._applySnapshot(msg.data);
        this._emit("snapshot");
        break;
      case "heartbeat":
        this._emit("heartbeat");
        break;
      case "weather.state":
        this.weather = { data: msg.data, quality: msg.quality };
        this.providerHealth.weather = "live";
        this._emit("weather");
        break;
      case "tide.state":
        this.tide = { data: msg.data, quality: msg.quality };
        this.providerHealth.tide = "live";
        this._emit("tide");
        break;
      case "vessel.position":
        this._applyVessel(msg);
        this._emit("vessel");
        break;
      default:
        break;
    }
  }

  _applySnapshot(data) {
    this.vessels.clear();
    for (const env of data.vessels || []) this._applyVessel(env);
    this.weather = data.weather ? { data: data.weather.data, quality: data.weather.quality } : null;
    this.tide = data.tide ? { data: data.tide.data, quality: data.tide.quality } : null;
    this.providerHealth = data.provider_health || this.providerHealth;
  }

  _applyVessel(env) {
    const mmsi = env.data.mmsi;
    if (mmsi == null) return;
    const existing = this.vessels.get(mmsi);
    // Update in place so scene meshes can lerp; merge so a position update does
    // not wipe static fields (name, dimensions) carried by earlier messages.
    const merged = existing ? { ...existing.data, ...env.data } : env.data;
    this.vessels.set(mmsi, {
      data: merged,
      quality: env.quality,
      receivedTime: performance.now(),
    });
  }

  // A vessel is stale when the proxy flagged it, or its reported age exceeds the
  // stale threshold for its kind. Never drops it; the scene dims it instead.
  isStale(entry) {
    if (!entry) return true;
    if (entry.quality && entry.quality.stale) return true;
    const age = entry.quality ? entry.quality.age_seconds : null;
    if (age != null && age > STALE_SECONDS.vessels) return true;
    return false;
  }
}
