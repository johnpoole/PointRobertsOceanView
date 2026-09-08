# Visitor load test — 8 September 2026

This records the original baseline investigation. The follow-up implementation
and matched measurements are in [CONTINUE-presence-performance.md](CONTINUE-presence-performance.md),
tracked by issue #60. The harness now defaults to the working `current` server;
`--variant baseline` loads the exact pre-improvement proxy from commit 1bc10a9,
and `--variant once` applies only encoding-once to that frozen baseline. Original
raw measurements below are preserved.

The app already batches positions. `src/main.js` sends `here` approximately
twice per second; `Clients.place` retains the latest validated pose per socket.
`presence_task` broadcasts one complete `presence.state` list, then sleeps
one second. It does **not** broadcast every incoming update. The actual tick
period is broadcast duration plus the sleep, so expensive sends slow the cadence.

The baseline `Clients.broadcast` serializes the same message inside its sequential
socket loop. Encoding once avoids repeated JSON work, but every socket still
receives and potentially compresses its own copy. At a fixed one-Hz cadence,
N recipients times N positions means approximately quadratic aggregate payload
delivery. Compression changes byte counts, not the need for N separate copies.
Browser rendering and initial model downloads are separate costs.

## Reusable harness

`scripts/load_presence.py` launches a fresh, single-worker Uvicorn child on an
atomically reserved **loopback-only** socket. It accepts no remote target.
The real FastAPI WebSocket route, validation, connection registry, presence
task, heartbeat, static routing and GZip middleware remain in use. Its lifespan
replaces upstream startup/shutdown: no third-party feed tasks run, the world
starts empty/offline, and visitor persistence is disabled. A second guard
rejects outbound non-loopback socket connects. No production source is patched.

Synthetic clients use the real `here` protocol and parse messages by type;
identity and broadcasts can interleave during a busy connection ramp. Poses
move gently near the marina. Mixed mode cycles orbit, walk, bike, cart, boat
and ultralight, including vehicle body pose/pitch/roll. Camera-only uses fly.
The target is two updates per second, staggered across clients. Measurements
begin after all clients connect and four seconds of warmup.

`--variant once` installs only a benchmark-process candidate that serializes
once while preserving message bytes, sequential order and failure removal.
`scripts/test_load_presence.py` verifies those properties against the existing
method, including a broken socket, along with valid poses and local asset paths.
The existing 19 presence tests also passed. The subsequent production change
and publication status are recorded in CONTINUE-presence-performance.md and #60.

Runs have bounded duration, client counts and memory checks. They stop early
on errors, server RSS exceeding 512 MiB by default, available system memory
below 512 MiB, or six consecutive half-second CPU samples above 95% of one
core. Each run closes its own clients, terminates only its own child process,
and cleans up its own temporary socket-handoff/log directory. No live Basement
traffic or third-party requests are generated. Raw JSON remains at the requested
output path. A failure or failed correctness check returns exit code 2.

### Rerun

Use Python with the app's FastAPI, Uvicorn, httpx and websockets dependencies,
plus `psutil`. The client uses the `websockets.asyncio` API (tested with 16.0).
For comparable deployment benchmarks, use the deployment's dependency versions
and Python version in a separate environment; do not silently replace them.

```powershell
python scripts/test_load_presence.py
python server/test_presence.py
foreach ($n in 1,10,50,100,250) {
  python scripts/load_presence.py --clients $n --variant baseline --seconds 15 --output "load-results/baseline-$n.json"
  if ($LASTEXITCODE -ne 0) { break }
}
python scripts/load_presence.py --clients 50 --variant once --output load-results/once-50.json
python scripts/load_presence.py --clients 100 --variant once --output load-results/once-100.json
python scripts/load_presence.py --clients 100 --variant baseline --seconds 20 --output load-results/baseline-100-repeat.json
python scripts/load_presence.py --clients 100 --seconds 20 --variant once --output load-results/once-100-repeat.json
python scripts/load_presence.py --clients 100 --variant baseline --mixture camera --output load-results/camera-100.json
python scripts/load_presence.py --clients 100 --variant baseline --slow-clients 5 --seconds 20 --output load-results/slow-100.json
python scripts/load_presence.py --clients 100 --variant baseline --no-compression --output load-results/uncompressed-100.json
python scripts/load_presence.py --variant baseline --static-clients 1 --output load-results/static-1.json
python scripts/load_presence.py --variant baseline --static-clients 5 --output load-results/static-5.json
```

Run scenarios sequentially, inspect results before increasing concurrency,
and stop the ramp if cadence is unacceptable even without a resource stop.
This run stopped at 250; multi-second delivery made a 500-client run unnecessary.
For comparisons, repeat paired variants under stable conditions and keep both
results. `--help` lists bounds and controls. Shell paths above assume repo root.

## Environment and metric definitions

- Intel Core i7-1165G7 at 2.80 GHz, 4 physical / 8 logical CPUs, 15.70 GiB RAM;
  Windows build 26200, Python 3.10.11. Generator and child server share this
  interactive laptop with other applications. This is not Basement hardware.
- Installed: FastAPI 0.115.12, Starlette 0.46.2, Uvicorn 0.34.3, websockets
  16.0, httpx 0.28.1, psutil 7.0.0. These differ from the production requirements
  pins and Docker's Python 3.11. No dependencies were changed for this test.
- Source HEAD `b7a313717ef8be496d2558307f2f096d2b8be152`; proxy SHA-256
  `cf6b6a5f276aa9de0cb88bf9921dbd725c8b8fef2a741fdba624c508877cb3b0`.
  Every result records source, versions, settings, UTC time and server log.
- CPU is process CPU seconds divided by elapsed time: **100% means one core**,
  not the whole laptop. RSS is sampled process resident memory; it is not a
  leak test. Generator CPU is separate (up to 75% of a core at 250 visitors).
- Delivery latency is client receipt/JSON parsing time minus the existing
  broadcast `server_time`, on the same machine clock. It includes sequential
  delivery and client processing; it is not Internet RTT. OS clock granularity
  affects very small values. The p95 samples share broadcast ticks and are
  correlated, not independent statistical trials.
- Pose age matches the client's latest visible heading to its send time.
  Superseded updates are intentionally coalesced; this is not an acknowledgment
  latency for every sent update. Input rates count successful client sends;
  separate server receive counts are also recorded.
- Server inbound/outbound bytes count UTF-8 application payloads before WebSocket
  compression. Client framed bytes count actual received transport data during
  measurement, including WebSocket framing/control frames after compression,
  excluding TCP/IP and TLS overhead. Buffered data and slightly different
  measurement boundaries can make receive and send totals differ.

## Sustained presence results

Raw results are linked below. Standard stages measure 15 seconds after warmup;
the paired repeats and slow-reader stage measure 20 seconds. All completed runs
had zero recorded client errors, disconnects or server send errors. Connected
and placed counts matched the target; normal readers received complete lists.
The initial 250-client attempt exposed the harness's identity-first assumption,
was discarded, and was rerun after handling messages by type.

| Baseline visitors | Server CPU / one core | Peak RSS MiB | Updates/client/s | Mean server tick ms | Delivery p95 ms | App outbound kB/s | Framed received kB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [1](load-results/baseline-1.json) | 0.4% | 50.3 | 1.952 | 1,010 | 4 | 0.2 | <0.1 |
| [10](load-results/baseline-10.json) | 3.7% | 53.1 | 1.996 | 1,014 | 22 | 19.7 | 2.0 |
| [50](load-results/baseline-50.json) | 18.8% | 67.9 | 1.995 | 1,146 | 150 | 411.0 | 35.2 |
| [100](load-results/baseline-100.json) | 40.8% | 86.6 | 1.997 | 1,668 | 1,013 | 1,127.7 | 96.5 |
| [250](load-results/baseline-250.json) | 89.6% | 143.3 | 2.015 | 4,140 | 3,050 | 2,790.1 | 321.3 |

At 250, clients received only 3–4 complete lists in the measurement window;
their own latest visible pose age reached p95 3.54 seconds. The input stream
continued near target while the output loop slowed. Measured outbound rates
therefore grow slower than the fixed-one-Hz quadratic expectation: the server
is delivering fewer ticks, not avoiding the copying cost. Small input-rate
deviations reflect window boundaries and scheduling. App inbound was about
38 kB/s at 100 and 111 kB/s at 250 in these runs.

### Encode-once comparison and variability

| Run | Baseline CPU → once CPU | Mean tick ms, baseline → once | Delivery p95 ms, baseline → once |
| --- | ---: | ---: | ---: |
| 50, first pair | 18.8% → 12.8% | 1,146 → 1,077 | 150 → 118 |
| 100, first pair | 40.8% → 31.0% | 1,668 → 1,233 | 1,013 → 313 |
| 100, repeated pair | 19.3% → 17.2% | 1,172 → 1,109 | 176 → 189 |

Sources: [once 50](load-results/once-50.json), [once 100](load-results/once-100.json),
[baseline 100 repeat](load-results/baseline-100-repeat.json),
[once 100 repeat](load-results/once-100-repeat.json).
The candidate reduced average CPU and tick duration in both 100-client pairs,
but the improvement varied and tail latency did not improve in the second pair.
These measurements support a narrow optimization, not a guaranteed percentage
speedup or a visitor limit. The baseline's 100-client CPU ranged 19–41% and
mean tick 1.17–1.67 seconds across the two runs.

[Camera-only 100](load-results/camera-100.json): 32.4% server CPU, 1.35-second
mean tick, 349 ms delivery p95, 61.1 kB/s framed receive. Different body payload
sizes matter, but this single run is not a controlled estimate of their CPU cost.

[Uncompressed 100](load-results/uncompressed-100.json): 33.3% CPU, 64.9 MiB
RSS, 1.47-second mean tick, 489 ms delivery p95 and about 1,271 kB/s framed
receive. Normal compressed 100-client runs used roughly 97–138 kB/s at their
respective cadences. Disabling compression greatly increases bytes here; the
variable CPU results do not justify disabling it in production. Synthetic
poses are structured and correlated, so their compression ratio may be optimistic.

### Slow readers

[100 clients, 5 slow](load-results/slow-100.json): slow clients read one message
every three seconds with a receive queue limit of one; they continue sending
positions at two Hz. Normal readers got 15 complete lists each in 20 seconds,
mean cadence 1.35 seconds and delivery p95 406 ms. Slow readers got six lists
each; delivery p95 was 14.70 seconds and pose age p95 15.13 seconds. Heartbeats
also consume a slow reader's read slot. No errors occurred.

This demonstrates stale-message backlog in a bounded slow-reader scenario.
It did **not** establish the worst-case server stall from a saturated remote
TCP connection: compression, loopback speed and OS buffers can absorb this
short run. Sequential awaited sends remain vulnerable to one blocked socket.
The slower-reader run being faster than one ordinary run is laptop variability,
not a performance benefit of slow clients. Do not infer a safe queue policy
from it; follow with controlled bandwidth/latency and longer soak tests.

## Cold HTTP asset burst

The separate scenario requests 82 local files per simulated page, using six
concurrent HTTP requests and GZip. The manifest includes the shell, local JS
modules and configured startup data. It deliberately includes optional local
detail modules, so it is a reproducible asset bundle, **not measured browser
time-to-interactive**. No CDN, WebGL, avatar rendering or feed downloads run.
HTTP caches are cold/unused; the OS filesystem cache may be warm.

| Concurrent bundles | Total time | Per-bundle time | Downloaded bodies | Server CPU / one core | Ending RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| [1](load-results/static-1.json) | 2.73 s | 2.73 s | 3.36 MiB | 69.8% | 52.7 MiB |
| [5](load-results/static-5.json) | 6.54 s | 6.37–6.54 s | 16.82 MiB | 104.1% | 57.3 MiB |

One source bundle is 9.50 MiB. Its near heightmap is 6,928,416 source bytes
and 2,265,460 transferred GZip bytes; the far heightmap is 769,934 / 685,955.
The manifest records every file, encoding and body-byte count. HTTP headers,
chunk framing, TCP and TLS are excluded. Static-file worker activity can take
process CPU slightly above one core. This burst is separate from presence;
it does not measure how simultaneous cold downloads affect presence cadence.

## Recommendations and issue draft

Draft issue: **Measure and improve visitor presence throughput and slow-client behavior**.
This proposal became issue #60. John approved publication of its completed
implementation, tests, reports and measurements on 8 September 2026.

- [x] Build a repeatable isolated load harness and record baseline, camera/vehicle,
  slow-reader, encoding comparison and cold-download results.
- [ ] Apply the tested encode-once change as a small production patch, with
  protocol/error-removal regression coverage and a paired staging benchmark.
  It saves repeated encoding without changing the existing batched protocol.
- [ ] Define an acceptable freshness target and test on deployment-matching
  hardware/dependencies with generators on a separate host, realistic network
  limits, real feed volume, browser avatar rendering and longer duration.
- [ ] Test a bounded per-client delivery policy for replaceable presence state:
  retain the newest unsent list, avoid unbounded stale queues, and handle stalled
  sends without delaying healthy clients. Keep initial identity/snapshot and
  other feed messages semantically distinct. Do not introduce unlimited tasks
  per client or drop arbitrary messages.
- [ ] Measure static precompression and versioned asset caching as a separate
  startup improvement. Test mixed cold-download/presence traffic before claiming
  an impact on sustained visitors.
- [ ] Only if larger audiences require it, evaluate visibility/area filtering
  or changed-position messages with removal/reconnect semantics. These can
  reduce payload volume; encoding once alone cannot remove N-by-N delivery.

No production files, feeds, deployment or GitHub issues were changed for this
benchmark. The harness, candidate, tests, source notes and raw results are local
reviewable work. These short loopback runs identify costs and follow-up tests;
they do not establish a production visitor capacity or long-term memory behavior.
