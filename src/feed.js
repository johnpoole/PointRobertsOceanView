// WebSocket client for the local proxy. Parses messages by message_type, keeps
// the world state (vessels keyed by mmsi, latest weather and tide, provider
// health, connection state), and reconnects with backoff. It never invents
// data: when the socket is down, connected is false and callers show it.

import { BACKEND_WS, STALE_SECONDS } from "./config.js";

export class Feed {
  constructor() {
    this.connected = false;
    this.vessels = new Map();    // mmsi -> { data, quality, receivedTime }
    this.aircraft = new Map();   // icao -> { data, quality, receivedTime }
    this.weather = null;      // { data, quality }
    this.tide = null;         // { data, quality }
    this.current = null;      // { data, quality } — the tidal stream, predicted
    this.providerHealth = { weather: "offline", tide: "offline", currents: "offline",
                            vessels: "offline", aircraft: "offline" };
    this.vesselsNote = "";   // why vessels are offline, in the monitor's words
    this.lastMessageAt = 0;
    // Everyone else with the page open, by the name the server gave them. Never
    // an address: the server sends a random id per connection and nothing else.
    this.presence = new Map();  // id -> { lat, lon, y, heading }
    this.selfId = null;         // what the server called us, so we can skip it

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
      // Nobody is here any more as far as this page knows. Leaving the last
      // list up would stand markers where people are not.
      this.presence.clear();
      this.selfId = null;
      this._emit("close");
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows; reconnect is handled there.
      try { ws.close(); } catch (err) { /* already closing */ }
    };
  }

  // Where this browser is standing, for everyone else's screen. Dropped on the
  // floor when the socket is not open: this is a nicety and it must never be the
  // thing that throws in the render loop.
  here(lat, lon, y, heading) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      this._ws.send(JSON.stringify({ type: "here", lat, lon, y, heading }));
    } catch (err) {
      /* the socket is going; onclose will deal with it */
    }
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
      case "current.state":
        this.current = { data: msg.data, quality: msg.quality };
        this.providerHealth.currents = "live";
        this._emit("current");
        break;
      case "aircraft.state":
        this._applyAircraft(msg);
        this._emit("aircraft");
        break;
      case "vessel.position":
        this._applyVessel(msg);
        this._emit("vessel");
        break;
      case "presence.you":
        this.selfId = msg.data.id;
        break;
      case "presence.state":
        this.presence.clear();
        for (const p of msg.data.here || []) {
          if (p.id !== this.selfId) this.presence.set(p.id, p);
        }
        this._emit("presence");
        break;
      default:
        break;
    }
  }

  _applySnapshot(data) {
    this.vessels.clear();
    for (const env of data.vessels || []) this._applyVessel(env);
    this.aircraft.clear();
    for (const env of data.aircraft || []) this._applyAircraft(env);
    this.weather = data.weather ? { data: data.weather.data, quality: data.weather.quality } : null;
    this.tide = data.tide ? { data: data.tide.data, quality: data.tide.quality } : null;
    this.current = data.current
      ? { data: data.current.data, quality: data.current.quality } : null;
    this.providerHealth = data.provider_health || this.providerHealth;
    this.vesselsNote = data.vessels_note || "";
  }

  _applyAircraft(env) {
    const icao = env.data.icao;
    if (icao == null) return;
    this.aircraft.set(icao, env);
    this.providerHealth.aircraft = "live";
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

  // A track is stale when the proxy flagged it, or its reported age exceeds the
  // threshold for its kind. Never drops it; the scene dims it instead.
  //
  // kind picks the threshold and is not optional. This used to read the vessel
  // threshold for both, so an aircraft gone quiet for four minutes still drew as
  // live: aircraft go stale at two minutes and ships at five, and the aircraft
  // figure sat in config.js unused.
  isStale(entry, kind) {
    const limit = STALE_SECONDS[kind];
    if (limit == null) {
      throw new Error(
        `feed.isStale: no stale threshold for ${JSON.stringify(kind)}. ` +
        `STALE_SECONDS in config.js has ${Object.keys(STALE_SECONDS).join(", ")}.`);
    }
    if (!entry) return true;
    if (entry.quality && entry.quality.stale) return true;
    const age = entry.quality ? entry.quality.age_seconds : null;
    if (age != null && age > limit) return true;
    return false;
  }
}
