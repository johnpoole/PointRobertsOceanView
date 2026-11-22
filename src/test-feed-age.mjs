// How old the page thinks a track is, checked against the clock rather than
// against what the proxy said once.
//
// Run:
//     node src/test-feed-age.mjs
//
// This is here because the bug it guards could not be seen. A ship gone quiet
// still drew at full colour with "age 0 s" on its card, which is exactly what a
// ship still reporting looks like: the screen was not wrong-looking, it was
// wrong. Issue #66.
//
// quality.age_seconds is worked out on the proxy when the envelope is built, so
// it is true once. The page has to carry it forward itself, and the only thing
// that makes it do so is the time it wrote down when the envelope arrived.

import assert from "node:assert/strict";

globalThis.location = { protocol: "http:", host: "localhost" };

const { Feed, ageSeconds } = await import("./feed.js");
const { STALE_SECONDS } = await import("./config.js");

// A stand-in for an envelope off the wire. `heldSeconds` is how long ago the
// page received it; `reported` is what the proxy said its age was at that
// moment.
function entry(reported, heldSeconds) {
  return {
    quality: { stale: false, age_seconds: reported, warnings: [] },
    receivedTime: performance.now() - heldSeconds * 1000,
    data: { mmsi: "316001234" },
  };
}

// ---- ageSeconds ------------------------------------------------------------

function test_age_is_what_the_proxy_said_plus_the_time_since() {
  assert.equal(Math.round(ageSeconds(entry(12, 0))), 12);
  assert.equal(Math.round(ageSeconds(entry(12, 60))), 72);
  assert.equal(Math.round(ageSeconds(entry(0, 400))), 400);
}

function test_no_reported_age_still_ages_from_receipt() {
  // The proxy did not know when the fix was taken, so there is no base to add
  // to. The time held here is still a floor on how old it is, and a floor is
  // worth having: it can only call a track staler than it is known to be.
  assert.equal(Math.round(ageSeconds(entry(null, 90))), 90);
}

function test_nothing_known_reads_as_nothing_rather_than_zero() {
  assert.equal(ageSeconds(null), null);
  assert.equal(ageSeconds({ quality: null, receivedTime: null }), null);
}

function test_age_never_runs_backwards() {
  // A clock that has gone the wrong way must not make a track younger.
  const e = entry(30, -5);
  assert.equal(Math.round(ageSeconds(e)), 30);
}

// ---- isStale ---------------------------------------------------------------

function test_a_fresh_track_is_not_stale() {
  const feed = new Feed();
  assert.equal(feed.isStale(entry(5, 0), "vessels"), false);
  assert.equal(feed.isStale(entry(5, 0), "aircraft"), false);
}

function test_a_track_goes_stale_where_it_is_held_past_the_threshold() {
  // This is the whole point. Nothing new arrived, the reported age is the same
  // 5 s it always was, and the track must still grey.
  const feed = new Feed();
  for (const kind of ["vessels", "aircraft"]) {
    const held = STALE_SECONDS[kind] + 30;
    assert.equal(feed.isStale(entry(5, 0), kind), false, `${kind} fresh`);
    assert.equal(feed.isStale(entry(5, held), kind), true, `${kind} held ${held}s`);
  }
}

function test_the_proxys_own_flag_still_wins() {
  const feed = new Feed();
  const e = entry(0, 0);
  e.quality.stale = true;
  assert.equal(feed.isStale(e, "vessels"), true);
}

function test_a_missing_entry_is_stale() {
  const feed = new Feed();
  assert.equal(feed.isStale(null, "vessels"), true);
  assert.equal(feed.isStale(undefined, "aircraft"), true);
}

function test_an_unknown_kind_raises_rather_than_guessing() {
  const feed = new Feed();
  assert.throws(() => feed.isStale(entry(0, 0), "orcas"), /no stale threshold/);
}

// ---- the two stores --------------------------------------------------------

function test_both_vessels_and_aircraft_are_stamped_on_arrival() {
  // Aircraft were not. The constructor's comment said they carried a
  // receivedTime and they did not, so there was nothing to age them from and
  // the threshold in config.js could never be reached.
  const feed = new Feed();
  feed._applyVessel({ data: { mmsi: "316001234" }, quality: { age_seconds: 1 } });
  feed._applyAircraft({ data: { icao: "C01234" }, quality: { age_seconds: 1 } });

  const ship = feed.vessels.get("316001234");
  const plane = feed.aircraft.get("C01234");
  assert.ok(ship.receivedTime != null, "a vessel carries a receivedTime");
  assert.ok(plane.receivedTime != null, "an aircraft carries a receivedTime");
}

function test_stamping_an_aircraft_keeps_the_rest_of_its_envelope() {
  // The card reads source and source_time off the envelope, so wrapping it must
  // not drop them.
  const feed = new Feed();
  feed._applyAircraft({
    data: { icao: "C01234" },
    quality: { age_seconds: 3, stale: false, warnings: [] },
    source: "adsb.example",
    source_time: "2026-09-11T10:00:00Z",
  });
  const plane = feed.aircraft.get("C01234");
  assert.equal(plane.source, "adsb.example");
  assert.equal(plane.source_time, "2026-09-11T10:00:00Z");
  assert.equal(plane.quality.age_seconds, 3);
}

// ---- a provider that has failed ----------------------------------------------

const reading = (data) => ({ data, quality: { stale: false, age_seconds: 4, warnings: [] } });
const snapshot = (health) => ({
  message_type: "initial.snapshot",
  data: {
    weather: reading({ temperature_c: 9 }),
    tide: reading({ water_level_m: 2.6 }),
    current: reading({ drift_mps: 0.4 }),
    provider_health: { weather: "live", tide: "live", currents: "live", ...health },
  },
});

function test_a_failed_provider_takes_its_last_reading_with_it() {
  // The server sends the health and the last good reading in the same
  // snapshot. The reading used to be kept and shown beside the word offline.
  const feed = new Feed();
  feed._handle(snapshot({}));
  assert.equal(feed.tide.data.water_level_m, 2.6);
  assert.equal(feed.weather.data.temperature_c, 9);
  assert.equal(feed.current.data.drift_mps, 0.4);

  feed._handle(snapshot({ tide: "offline" }));
  assert.equal(feed.tide, null, "the tide's last reading was kept");
  assert.equal(feed.weather.data.temperature_c, 9, "the weather went with the tide");
  assert.equal(feed.current.data.drift_mps, 0.4, "the current went with the tide");

  feed._handle(snapshot({ weather: "offline", currents: "offline" }));
  assert.equal(feed.weather, null);
  assert.equal(feed.current, null);
  assert.equal(feed.tide.data.water_level_m, 2.6, "the tide did not come back");
}

function test_a_reading_too_old_does_not_stand_in_for_a_failed_provider() {
  const feed = new Feed();
  feed._handle(snapshot({ tide: "offline" }));
  const old = { message_type: "tide.state", ...reading({ water_level_m: 1.1 }) };
  old.quality.stale = true;
  feed._handle(old);
  assert.equal(feed.tide, null);
  // A fresh one brings the provider back and is kept.
  feed._handle({ message_type: "tide.state", ...reading({ water_level_m: 1.2 }) });
  assert.equal(feed.providerHealth.tide, "live");
  assert.equal(feed.tide.data.water_level_m, 1.2);
}

// ---- run -------------------------------------------------------------------

const tests = Object.entries({
  test_age_is_what_the_proxy_said_plus_the_time_since,
  test_no_reported_age_still_ages_from_receipt,
  test_nothing_known_reads_as_nothing_rather_than_zero,
  test_age_never_runs_backwards,
  test_a_fresh_track_is_not_stale,
  test_a_track_goes_stale_where_it_is_held_past_the_threshold,
  test_the_proxys_own_flag_still_wins,
  test_a_missing_entry_is_stale,
  test_an_unknown_kind_raises_rather_than_guessing,
  test_a_failed_provider_takes_its_last_reading_with_it,
  test_a_reading_too_old_does_not_stand_in_for_a_failed_provider,
  test_both_vessels_and_aircraft_are_stamped_on_arrival,
  test_stamping_an_aircraft_keeps_the_rest_of_its_envelope,
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (exc) {
    failed++;
    console.log(`FAIL ${name}: ${exc.message}`);
  }
}
console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
