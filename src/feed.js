// WebSocket client for the local proxy. Parses messages by message_type, keeps
// the world state (vessels keyed by mmsi, latest weather and tide, provider
// health, connection state), and reconnects with backoff. It never invents
// data: when the socket is down, connected is false and callers show it.

import { BACKEND_WS, STALE_SECONDS } from "./config.js";

// How old a reading is now, rather than how old it was when it arrived.
//
// quality.age_seconds is worked out on the proxy at the moment the envelope is
// built, so it is true once and never again. The client used to read it and
// nothing else, which meant a track only aged when a fresh envelope happened to
// arrive for it — and the reaper broadcasts a snapshot only when it actually
// drops something, so on a quiet stretch nothing arrived and a ship gone quiet
// for six minutes still drew live at "age 0 s".
//
// Ageing it from receipt is what lets a track grey on its own, which is what
// the proxy's own drop cutoff already assumes happens.
//
// With no age upstream there is no base to add to, and the time held here is
// the floor: it says how long since anything was heard, which can only mark a
// track staler than it is known to be, never fresher.
export function ageSeconds(entry) {
  if (!entry) return null;
  const held = entry.receivedTime == null
    ? null
    : Math.max(0, (performance.now() - entry.receivedTime) / 1000);
  const reported = entry.quality ? entry.quality.age_seconds : null;
  if (reported == null) return held;
  return held == null ? reported : reported + held;
}

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
    // What the marina camera was last read to hold, or null when nobody is
    // looking at the marina and the server is not polling it.
    this.marina = null;
    // Who the golf club's booking sheet says is out on the course, or null.
    this.tee = null;
    this.calls = null;
    this.crossings = null;
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
  here(lat, lon, y, heading, mode, body) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      this._ws.send(JSON.stringify({ type: "here", lat, lon, y, heading, mode, body }));
    } catch (err) {
      /* the socket is going; onclose will deal with it */
    }
  }

  // Says this browser is looking at one of the detailed areas, so the server
  // knows whether a feed that costs somebody else bandwidth is worth polling.
  // Repeat it while the area is open; the server forgets after a minute or so.
  watching(area) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      this._ws.send(JSON.stringify({ type: "watching", area }));
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
        this._providerLive("weather", msg);
        this._emit("weather");
        break;
      case "tide.state":
        this.tide = { data: msg.data, quality: msg.quality };
        this._providerLive("tide", msg);
        this._emit("tide");
        break;
      case "current.state":
        this.current = { data: msg.data, quality: msg.quality };
        this._providerLive("currents", msg);
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
      case "crossings.state":
        this.crossings = { data: msg.data, quality: msg.quality };
        this._providerLive("crossings", msg);
        this._emit("crossings");
        break;
      case "blotter.calls":
        // What the Sheriff's daily report says the deputy was called out to.
        this.calls = msg;
        this._emit("calls");
        break;
      case "golf.tee":
        // Who the club's booking sheet says is out on the course.
        this.tee = msg;
        this._emit("tee");
        break;
      case "marina.presence":
        // Counts off the marina camera, or the reason there are none.
        this.marina = msg;
        this._emit("marina");
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
    this.marina = data.marina || null;
    this.tee = data.tee || null;
    this.calls = data.calls || null;
    // The monthly counts. The page reads the oldest month off them to know how
    // far back the date on the clock may go.
    this.crossings = data.crossings || null;
    this.vesselsNote = data.vessels_note || "";
  }

  // Arriving is not the same as being current. A reading the proxy has already
  // flagged too old to be the present one does not make its provider live: the
  // health the server sends, whenever it changes, stands instead. Without this
  // a provider that answers with hours-old numbers reads as live for as long as
  // it keeps answering.
  _providerLive(key, msg) {
    if (!(msg.quality && msg.quality.stale)) this.providerHealth[key] = "live";
  }

  _applyAircraft(env) {
    const icao = env.data.icao;
    if (icao == null) return;
    // Stamped the same as a vessel. The constructor above said aircraft carried
    // a receivedTime and they did not, so there was nothing to age them from.
    this.aircraft.set(icao, { ...env, receivedTime: performance.now() });
    this.providerHealth.aircraft = "live";
  }

  _applyVessel(env) {
    const mmsi = env.data.mmsi;
    if (mmsi == null) return;
    const existing = this.vessels.get(mmsi);
    // Update in place so scene meshes can lerp; merge so a position update does
    // not wipe static fields (name, dimensions) carried by earlier messages.
    const merged = existing ? { ...existing.data, ...env.data } : env.data;
    // The whole envelope, not just data and quality: the card that opens on a
    // clicked ship says where the position came from and when it was taken, and
    // those live on the envelope beside the data.
    this.vessels.set(mmsi, {
      ...env,
      data: merged,
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
    const age = ageSeconds(entry);
    if (age != null && age > limit) return true;
    return false;
  }
}
