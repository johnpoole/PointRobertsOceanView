# Presence delivery performance — issue #60

[Issue #60](https://github.com/johnpoole/PointRobertsOceanView/issues/60) tracks
this change. John explicitly approved commit, push and deployment on 8 September
2026 after reviewing the completed local work. Deployment verification and the
published revision are recorded in the issue.

## Implemented behavior

Every visitor still sends their latest viewpoint/body at two Hz and receives
the complete visitor list. The server still collects the latest pose per socket
and broadcasts `presence.state` on its one-second loop. No proximity filtering,
visibility reduction, smoothing, transport or schema changes are included.

`Clients.broadcast` now serializes once and shares the same immutable encoded
string with all connection queues. It yields one scheduler turn after enqueueing
so buffered upstream bursts cannot starve writers; it does not await a client's
network send. The presence loop's period includes this enqueue/encoding time,
not all sequential socket writes.

Each connection has one `ClientDelivery` task and at most one active write.
Identity and initial world snapshot are enqueued without yielding after socket
registration, before any broadcast can interleave. All messages, including
bootstrap and later feed snapshots, use this writer. A queue has at most 128
items / 2 MiB of encoded UTF-8 payload, plus one in-flight item which was admitted
under the same per-item bound. Metadata, Python/transport buffers and client-side
buffers are outside that application-payload accounting.

Only unsent `presence.state` is replaceable: there is at most one queued list.
The old pending list is removed and its replacement appended at the new
chronological position. Other events keep FIFO order, including snapshots,
vessel/aircraft updates/removals, weather/tide and heartbeat. They are not silently
dropped to make space. An already in-flight presence send finishes or times out;
it cannot be replaced halfway through a WebSocket message.

Queue overflow (including an individual payload larger than 2 MiB) or a send
blocked for five seconds disconnects only that client with code **1013**. A send
exception uses 1011; ordinary disconnect uses 1000; server shutdown uses 1001.
Close attempts have a one-second timeout. These are chosen resource/freshness
bounds, not limits derived from measured Internet capacity. If real feed bursts
or payloads approach them, inspect metrics and remeasure before changing them.
Queued events discarded on connection termination are recovered through the
existing reconnection/initial snapshot semantics; events are not silently
skipped on a connection claimed to be current.

The receiving route removes presence immediately on disconnect and shields
bounded writer cleanup from a second ASGI cancellation. Writers stay tracked
until done. Shutdown stops all writers and has a bounded wait, rather than
waiting indefinitely for a broken transport. The existing browser clears its
presence map on close and reconnects, receiving a new anonymous ID and fresh
initial snapshot. No IP, persistent identifier or other metadata was added to
public presence. No presence smoothing or browser code changed.

## Correctness checks

`python server/test_delivery.py` exercises the production implementation with
controlled asynchronous sockets and no network:

- Identity and initial snapshot precede broadcasts during a busy connection ramp.
- Exactly one JSON encoding for a broadcast to six clients; all receive equal
  complete camera/vehicle poses, with no address disclosure and no overlapping
  writes.
- 1,000 superseded presence updates leave exactly one queued latest list.
- A held writer does not delay another client; interleaved feed events keep
  their order while only obsolete presence is removed.
- Count/byte overflow and send timeout close only the affected socket; the
  replacement connection gets a new ID and initial snapshot.
- Early disconnect before writer startup, write failure, held close, receiving
  task cancellation during cleanup, visitor counts and absence of leaked tasks.

Existing checks passed: 19 presence tests (repeated after fixing a cancellation
edge case), 22 feed tests, 8 visitor/admin tests, and the harness's protocol and
historical encode-once comparison test. Python compilation and diff checks pass.
No live upstream feeds or Basement load were used.

## Matched loopback measurements

Same Windows i7-1165G7 laptop, four cores/eight logical CPUs, 15.7 GiB RAM and
Python 3.10 environment as [the original report](CONTINUE-load-test.md). Installed
FastAPI/Uvicorn/websockets versions differ from deployment; every result records
them. The generator shares the interactive machine. CPU percentages below use
**one core as 100%**, not all eight logical CPUs. Tests are short and are not a
production-capacity claim or a memory soak test.

Baseline loads the exact proxy source at `1bc10a90f767753f0705e30f7e980a3efaea87a0`
from Git into the isolated process. Current loads the working file. Both replace
only lifespan/upstream work and add identical counters, preserving their real
WebSocket routes and delivery behavior. The server records the tested proxy's
SHA-256 in each result. The initial 10-client current measurement predated the
teardown-only shield adjustment and is retained separately; its final-code
rerun is used below. The 50/100/250 and later tests include that adjustment.

Standard mixed-mode stages: four-second warmup then 15-second measurement.
Input stayed 1.98–2.00 updates/client/second. All target connections/positions
remained, all normal readers saw complete lists, and there were no unexpected
errors, send failures, overflows or disconnects. No presence coalescing was
needed in ordinary stages. The concurrency ramp stopped at 250, matching the
baseline investigation rather than claiming a capacity limit.

| Visitors | Server CPU, baseline → current | RSS MiB, baseline → current | Mean tick ms, baseline → current | Delivery p95 ms, baseline → current |
| --- | ---: | ---: | ---: | ---: |
| 10 | 1.3% → 2.3% | 53.4 → 53.6 | 1,011 → 1,006 | 6 → 7 |
| 50 | 7.2% → 4.8% | 68.6 → 68.7 | 1,042 → 1,005 | 46 → 24 |
| 100 | 14.7% → 14.5% | 87.0 → 87.2 | 1,142 → 1,002 | 142 → 139 |
| 250 | 57.2% → 51.3% | 143.4 → 143.5 | 2,140 → 1,019 | 1,209 → 536 |

Raw pairs: [10 baseline](load-results/perf-baseline-10.json)/[current](load-results/perf-final-current-10.json),
[50 baseline](load-results/perf-baseline-50.json)/[current](load-results/perf-current-50.json),
[100 baseline](load-results/perf-baseline-100.json)/[current](load-results/perf-current-100.json),
[250 baseline](load-results/perf-baseline-250.json)/[current](load-results/perf-current-250.json).

At 250, clients received 7 complete lists each in the baseline and 15 in the
current run. The current implementation did more delivery work while using
slightly less CPU. At 10, scheduling overhead/noise outweighed any encoding
savings; there is no universal CPU speedup claim. A 20-second 100-client repeat
measured CPU **21.0% → 14.3%**, mean tick **1,206 → 1,006 ms**, and delivery
p95 **213 → 111 ms** ([baseline](load-results/perf-repeat-baseline-100.json),
[current](load-results/perf-repeat-current-100.json)). Differences across runs
show why a single laptop measurement is not a guaranteed improvement percentage.

The change does **not** remove N-by-N delivery or per-connection compression.
At 250, application outbound grew **5.56 → 11.60 MB/s**, and received compressed
WebSocket frames grew **0.605 → 1.275 MB/s**, because the server delivered twice
as many complete lists. At 100, application outbound was **1.65 → 1.91 MB/s**,
framed receive **135 → 157 kB/s**. These are aggregate rates; framed bytes exclude
TCP/IP/TLS, and application bytes precede compression. Incoming positions remain
linear in visitor count. On a limited production uplink, network capacity may
be the next bottleneck even though the server cadence improves.

Camera-only 100-client comparison: CPU **15.2% → 12.6%**, mean tick **1,112 →
1,002 ms**, delivery p95 **137 → 51 ms**, RSS **86.2 → 86.7 MiB**
([baseline](load-results/perf-camera-baseline-100.json),
[current](load-results/perf-camera-current-100.json)). Both sent approximately
two updates/client/second. Vehicle payloads and complete visitor modes are
covered by the mixed-mode runs and protocol tests, not inferred from this case.

## Deterministic stalled-send checks

The harness can hold one chosen client's ASGI send, below the real production
delivery loop, starting two seconds into measurement. This guarantees actual
awaited backpressure; it does not purport to emulate every OS/TCP buffer or
Internet connection. Each case used 100 mixed-mode clients for 20 seconds.

| One connection held for 3 s | Baseline | Current |
| --- | ---: | ---: |
| Healthy-client mean cadence | 1,360 ms | 1,001 ms |
| Healthy-client cadence p95 / max | 4,124 / 4,135 ms | 1,020 / 1,048 ms |
| Healthy-client delivery p95 | 3,024 ms | 82 ms |
| Server CPU / one core | 15.9% | 11.2% |
| Stale pending lists replaced | none | 2 |

Both retained all 100 visitors, and the stalled connection recovered after the
hold. Raw [baseline](load-results/perf-stall-baseline-100.json) and
[current](load-results/perf-stall-current-100.json) record one injected stall each.

An [eight-second hold](load-results/perf-timeout-current-100.json) on the current
server hit its five-second send deadline: exactly one expected close code 1013,
one timeout, four coalesced lists and zero unexpected errors. The 99 healthy
clients retained complete remaining-visitor lists; mean tick was 1,003 ms,
healthy delivery p95 72 ms, server CPU 13.1%, RSS 87.1 MiB. Disconnecting an
unusable connection is deliberate bounded behavior, not filtering a connected
visitor out of the list.

Coalescing cannot retract bytes already handed to TCP or stored by a browser.
A merely slow JavaScript consumer can still read old buffered messages until
the transport applies backpressure. This change bounds **server pending state**
and isolates stalled sends; it does not promise zero end-to-end staleness on
unresponsive clients. Follow-up network/soak tests should use deployment-matching
dependencies, separate generator hosts, real feed volume and constrained links.

This limitation was also measured: [five slow application readers among 100](load-results/perf-slow-current-100.json)
on the current server, each reading one message every three seconds, reached
**16.43 seconds delivery p95** while healthy clients stayed at **88 ms** and
the mean server tick was **1,005 ms**. All connections stayed up, and no lists
were coalesced because the loopback/OS buffers had not applied send backpressure.
This deliberately differs from the injected stalled-send case above. It is
not evidence that old data can be removed after it enters transport/client buffers.

The camera-only and slow-reader runs additionally query the still-running child
after closing all synthetic clients: **zero connections, sender tasks, pending
messages and pending bytes** before terminating the child. The harness now does
this cleanup check on every successful presence run, alongside deterministic
shutdown/teardown tests. Earlier result files predate this added telemetry.

## Rerun / publication

From the repository root, with the app's Python dependencies and psutil:

```powershell
python server/test_delivery.py
python server/test_presence.py
python server/test_feeds.py
python server/test_visitors.py
python scripts/test_load_presence.py
foreach ($n in 10,50,100,250) {
  foreach ($variant in 'baseline','current') {
    python scripts/load_presence.py --clients $n --variant $variant --seconds 15 --output "load-results/check-$variant-$n.json"
    if ($LASTEXITCODE -ne 0) { throw 'Load test stopped; inspect its result before continuing.' }
  }
}
python scripts/load_presence.py --clients 100 --variant baseline --seconds 20 --stall-seconds 3 --output load-results/check-stall-baseline.json
python scripts/load_presence.py --clients 100 --variant current --seconds 20 --stall-seconds 3 --output load-results/check-stall-current.json
python scripts/load_presence.py --clients 100 --variant current --seconds 20 --stall-seconds 8 --expect-stall-close --output load-results/check-timeout.json
python scripts/load_presence.py --clients 100 --variant current --slow-clients 5 --seconds 20 --output load-results/check-slow-reader.json
```

The harness accepts no remote target, binds only loopback, runs no upstream
tasks, and stops only its own child/client processes. Current raw results and
earlier baseline/load-test files are preserved. No terrain, assets, frontend,
cache/precompression or unrelated user files are part of the implementation.
Issue #60 is completed after commit/push/deployment and verification; consult
its completion record for the running revision and production smoke check.
