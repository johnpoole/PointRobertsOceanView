"""Isolated, bounded benchmark of the real /ws/live presence path.

Run python scripts/load_presence.py --help. No remote target is accepted.
Only the child benchmark process is stopped; production files are not patched.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import tempfile
import time
import types

import httpx
import psutil
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def summary(values):
    a = sorted(values)
    if not a:
        return {"n": 0}
    return {"n": len(a), "min": a[0], "mean": sum(a)/len(a),
            **{name: a[min(len(a)-1, math.ceil(len(a)*p)-1)]
               for name, p in [("p50", .5), ("p95", .95), ("max", 1)]}}


BASELINE_REF = "1bc10a90f767753f0705e30f7e980a3efaea87a0"


def load_proxy(variant):
    if variant == "current":
        from server import proxy
        return proxy, (ROOT/"server/proxy.py").read_bytes()
    # Freeze the actual pre-improvement app, not a reimplementation of baseline.
    source = subprocess.check_output(["git","show",BASELINE_REF+":server/proxy.py"],cwd=ROOT)
    proxy = types.ModuleType("baseline_proxy")
    proxy.__file__ = str(ROOT/"server/proxy.py")
    exec(compile(source, proxy.__file__, "exec"), proxy.__dict__)
    return proxy, source


def serve(args):
    # No upstream tasks, real visitor log or production startup/shutdown hooks.
    # Also reject outgoing non-loopback connects as a second isolation boundary.
    original_connect, original_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def local_only(fn):
        def call(sock, address):
            if not isinstance(address, tuple) or address[0] not in {"127.0.0.1", "::1"}:
                raise RuntimeError("Benchmark blocked outbound connection")
            return fn(sock, address)
        return call
    socket.socket.connect = local_only(original_connect)
    socket.socket.connect_ex = local_only(original_connect_ex)
    proxy, tested_source = load_proxy(args.variant)
    import uvicorn

    proxy.clients = proxy.Clients()
    proxy.visitors = proxy.Visitors()
    proxy.world = proxy.World()  # empty/offline feeds, no fabricated live data
    state = {}

    def reset(measuring=False):
        state.clear()
        state.update(start=time.perf_counter(), inbound=0, outbound=0,
                     received=0, sent=0, durations=[], list_sizes=[], ticks=[],
                     send_errors=0, lag=[], injected_stalls=0, measuring=measuring)
        for key in getattr(proxy.clients,"delivery_stats",{}):
            proxy.clients.delivery_stats[key] = 0
    reset()

    real_broadcast = proxy.clients.broadcast

    async def broadcast(message):
        started = time.perf_counter()
        if args.variant == "once":
            await serialize_once(proxy.clients, message)
        else:
            await real_broadcast(message)
        if message.get("message_type") == "presence.state" and started >= state["start"]:
            state["durations"].append((time.perf_counter()-started)*1000)
            state["ticks"].append(started)
            state["list_sizes"].append(len(message["data"]["here"]))
    proxy.clients.broadcast = broadcast

    async def event_loop_probe():
        while True:
            due = time.perf_counter()+.1
            await asyncio.sleep(.1)
            state["lag"].append(max(0, time.perf_counter()-due)*1000)

    @asynccontextmanager
    async def lifespan(app):
        tasks = [asyncio.create_task(fn()) for fn in
                 (proxy.presence_task, proxy.heartbeat_task, event_loop_probe)]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if hasattr(proxy.clients,"shutdown"):
                await proxy.clients.shutdown()
    proxy.app.router.lifespan_context = lifespan

    async def app(scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/__loadtest/"):
            if scope["path"] == "/__loadtest/reset" and scope["method"] == "POST":
                reset(True)
            elapsed = time.perf_counter()-state["start"]
            data = {k: state[k] for k in ("inbound", "outbound", "received", "sent", "send_errors")}
            data.update(elapsed_s=elapsed, connections=proxy.clients.count,
                        senders=len(getattr(proxy.clients,"_senders",{})),
                        placed=len(proxy.clients.placed()),
                        tested_proxy_sha256=hashlib.sha256(tested_source).hexdigest(),
                        injected_stalls=state["injected_stalls"],
                        delivery_stats=getattr(proxy.clients,"delivery_stats",{}).copy(),
                        pending_messages=sum(len(s["delivery"].pending) for s in proxy.clients._sockets.values() if "delivery" in s),
                        pending_bytes=sum(s["delivery"].bytes for s in proxy.clients._sockets.values() if "delivery" in s),
                        broadcast_ms=summary(state["durations"]),
                        tick_interval_ms=summary([(b-a)*1000 for a,b in zip(state["ticks"],state["ticks"][1:])]),
                        list_sizes=summary(state["list_sizes"]), loop_lag_ms=summary(state["lag"]))
            await send({"type":"http.response.start", "status":200,
                        "headers":[(b"content-type", b"application/json")]})
            await send({"type":"http.response.body", "body":json.dumps(data).encode()})
            return

        async def measured_receive():
            msg = await receive()
            if msg["type"] == "websocket.receive" and "text" in msg:
                state["inbound"] += len(msg["text"].encode())
                state["received"] += 1
            return msg

        stalled = False
        async def measured_send(msg):
            nonlocal stalled
            try:
                # Deterministic send backpressure, below the real delivery loop.
                # It isn't a claim to emulate Internet buffers/bandwidth.
                if (state["measuring"] and not stalled and args.stall_seconds and scope.get("query_string")==b"stall=1"
                    and msg["type"]=="websocket.send" and '"presence.state"' in msg.get("text","")
                    and time.perf_counter()-state["start"]>=2):
                    stalled = True
                    state["injected_stalls"] += 1
                    await asyncio.sleep(args.stall_seconds)
                await send(msg)
            except Exception:
                if msg["type"] == "websocket.send":
                    state["send_errors"] += 1
                raise
            if msg["type"] == "websocket.send" and "text" in msg:
                state["outbound"] += len(msg["text"].encode())
                state["sent"] += 1
        await proxy.app(scope, measured_receive, measured_send)

    # Inherited bound socket removes the free-port race on Windows and Unix.
    sock = socket.socket(fileno=args.socket_fd) if os.name != "nt" else socket.fromshare(bytes.fromhex(args.socket_share))
    config = uvicorn.Config(app, log_level="warning", access_log=False,
                            ws="websockets", ws_per_message_deflate=not args.no_compression)
    asyncio.run(uvicorn.Server(config).serve(sockets=[sock]))


async def serialize_once(clients, message):
    """Benchmark-only candidate: same bytes, send order and failure handling."""
    encoded = json.dumps(message)
    dead = []
    for ws in list(clients._sockets):
        try:
            await ws.send_text(encoded)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)


def pose(i, seq, mixture):
    modes = ["fly"] if mixture == "camera" else ["orbit", "walk", "bike", "cart", "boat", "ultralight"]
    mode = modes[i % len(modes)]
    lat = 48.977+(i % 20)*.00003+math.sin(seq*.04)*.0001
    lon = -123.067+(i // 20)*.00003+math.cos(seq*.04)*.0001
    heading = round((i*13+seq*.1) % 360, 1)  # unique per sample during bounded run
    y = 5 if mode == "boat" else 22
    p = dict(type="here", lat=lat, lon=lon, y=y, heading=heading, mode=mode)
    if mode in {"walk", "bike", "cart", "boat", "ultralight"}:
        p["body"] = dict(lat=lat, lon=lon, y=y-1.6, heading=heading,
                         pitch=round(math.sin(seq*.1)*2,1), roll=round(math.cos(seq*.1)*2,1))
    return p


async def visitor(i, url, args, shared, ready, stop):
    r = {"sent":0, "received":0, "bytes_in":0, "bytes_out":0,
         "framed_bytes_in":0,
         "cadence_ms":[], "delivery_ms":[], "pose_age_ms":[], "send_lag_ms":[],
         "sizes":[], "error":None, "slow": i < args.slow_clients,
         "stalled": bool(args.stall_seconds and i==0), "expected_close":None}
    shared.append(r)
    ws = None
    class MeasuredConnection(ClientConnection):
        def data_received(self, data):
            if time.perf_counter() >= shared_start[0]:
                r["framed_bytes_in"] += len(data)
            super().data_received(data)
    try:
        ws = await connect(url+("?stall=1" if args.stall_seconds and i==0 else ""), compression=None if args.no_compression else "deflate",
                           max_size=8*1024*1024, max_queue=1, close_timeout=1,
                           open_timeout=15, create_connection=MeasuredConnection)
        # Broadcasts may interleave with identity/snapshot during a busy ramp.
        own = None
        while own is None:
            msg = json.loads(await asyncio.wait_for(ws.recv(),15))
            if msg.get("message_type") == "presence.you":
                own = msg["data"]["id"]
        ready[i].set()
        times = {}

        async def sender():
            seq = 0
            due = time.perf_counter()+i/max(1,args.clients)/args.hz
            while not stop.is_set():
                await asyncio.sleep(max(0,due-time.perf_counter()))
                now = time.perf_counter()
                p = pose(i,seq,args.mixture)
                text = json.dumps(p, separators=(",", ":"))  # JSON.stringify shape
                times[p["heading"]] = now
                await ws.send(text)
                if shared_start[0] <= now:
                    r["sent"] += 1
                    r["bytes_out"] += len(text.encode())
                    r["send_lag_ms"].append(max(0,now-due)*1000)
                seq += 1
                due = max(due+1/args.hz, now)  # bounded catch-up, record lag

        async def receiver():
            previous = None
            while not stop.is_set():
                raw = await ws.recv()
                now = time.perf_counter()
                msg = json.loads(raw)
                if now >= shared_start[0]:
                    r["bytes_in"] += len(raw.encode())
                    if msg.get("message_type") == "presence.state":
                        r["received"] += 1
                        stamp = datetime.fromisoformat(msg["server_time"]).timestamp()
                        r["delivery_ms"].append((time.time()-stamp)*1000)
                        here = msg["data"]["here"]
                        r["sizes"].append(len(here))
                        if previous is not None:
                            r["cadence_ms"].append((now-previous)*1000)
                        previous = now
                        me = next((p for p in here if p["id"] == own), None)
                        if me and me["heading"] in times:
                            r["pose_age_ms"].append((now-times[me["heading"]])*1000)
                if r["slow"]:
                    await asyncio.sleep(args.slow_delay)
        tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
        waiter = asyncio.create_task(stop.wait())
        try:
            done, _ = await asyncio.wait([*tasks,waiter],return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task is not waiter:
                    task.result()
                    raise RuntimeError("visitor stopped before test end")
        finally:
            for task in [*tasks,waiter]:
                task.cancel()
            await asyncio.gather(*tasks,waiter,return_exceptions=True)
    except Exception as exc:
        code = exc.rcvd.code if isinstance(exc,ConnectionClosed) and exc.rcvd else None
        if args.expect_stall_close and r["stalled"] and code==1013:
            r["expected_close"] = code
        else:
            r["error"] = type(exc).__name__+": "+str(exc)
        ready[i].set()
    finally:
        if ws:
            await ws.close()


shared_start = [float("inf")]


def cpu_seconds(process):
    c = process.cpu_times()
    return c.user+c.system


async def presence_run(base, child, args):
    records, ready, stop = [], [asyncio.Event() for _ in range(args.clients)], asyncio.Event()
    tasks = [asyncio.create_task(visitor(i,base.replace("http:","ws:")+"/ws/live",args,records,ready,stop))
             for i in range(args.clients)]
    process, generator = psutil.Process(child.pid), psutil.Process()
    samples, pressure = [], None
    result = None
    try:
        await asyncio.wait_for(asyncio.gather(*(e.wait() for e in ready)),25)
        if any(r["error"] for r in records):
            raise RuntimeError("Connection ramp failed: "+str([r["error"] for r in records if r["error"]][:3]))
        async with httpx.AsyncClient(timeout=10,trust_env=False) as http:
            await asyncio.sleep(args.warmup)
            await http.post(base+"/__loadtest/reset")
            shared_start[0] = started = time.perf_counter()
            c0,g0 = cpu_seconds(process),cpu_seconds(generator)
            process.cpu_percent()
            while time.perf_counter()-started < args.seconds:
                await asyncio.sleep(.5)
                sample = dict(cpu_percent=process.cpu_percent(), rss=process.memory_info().rss,
                              available=psutil.virtual_memory().available)
                samples.append(sample)
                if sample["rss"] > args.max_rss_mb*1024**2 or sample["available"] < 512*1024**2:
                    pressure = "memory threshold"
                    break
                if len(samples)>=6 and all(s["cpu_percent"]>95 for s in samples[-6:]):
                    pressure = "server sustained one-core saturation"
                    break
                if any(r["error"] for r in records):
                    pressure = "visitor error/disconnection"
                    break
            elapsed = time.perf_counter()-started
            shared_start[0] = float("inf")
            server = (await http.get(base+"/__loadtest/metrics")).json()
            cpu,gen_cpu = cpu_seconds(process)-c0,cpu_seconds(generator)-g0
        result = dict(clients=args.clients, variant=args.variant, mixture=args.mixture,
                      slow_clients=args.slow_clients, compression=not args.no_compression,
                      elapsed_s=elapsed, pressure_stop=pressure, server=server,
                      server_cpu_percent=100*cpu/elapsed, generator_cpu_percent=100*gen_cpu/elapsed,
                      server_peak_rss_mb=max(s["rss"] for s in samples)/1024**2,
                      server_sample_cpu=summary([s["cpu_percent"] for s in samples]),
                      sent_updates=sum(r["sent"] for r in records),
                      achieved_updates_per_client_s=sum(r["sent"] for r in records)/args.clients/elapsed,
                      client_bytes_received=sum(r["bytes_in"] for r in records),
                      client_framed_bytes_received=sum(r["framed_bytes_in"] for r in records),
                      errors=[r["error"] for r in records if r["error"]])
        result["expected_closes"] = [r["expected_close"] for r in records if r["expected_close"]]
        for name in ["normal","slow","stalled"]:
            subset = [r for r in records if (not r["slow"] and not r["stalled"] if name=="normal" else r[name])]
            result[name] = {key:summary([x for r in subset for x in r[key]]) for key in
                            ("cadence_ms","delivery_ms","pose_age_ms","send_lag_ms","sizes")}
            result[name]["messages_per_client"] = summary([r["received"] for r in subset])
        expected = args.clients-len(result["expected_closes"])
        allowed_sizes = {args.clients, expected}
        result["correctness"] = dict(all_connections_present=server["connections"]==expected,
            all_positions_present=server["placed"]==expected,
            normal_clients_received_complete_lists=all(r["sizes"] and all(n in allowed_sizes for n in r["sizes"])
                                                      and r["sizes"][-1]==expected
                                                      for r in records if not r["slow"] and not r["stalled"]),
            stalled_close_observed=bool(result["expected_closes"]) if args.expect_stall_close else True)
        return result
    finally:
        shared_start[0] = float("inf")
        stop.set()
        await asyncio.gather(*tasks,return_exceptions=True)
        if result is not None:
            async with httpx.AsyncClient(timeout=2,trust_env=False) as http:
                deadline=time.perf_counter()+3
                while True:
                    clean=(await http.get(base+"/__loadtest/metrics")).json()
                    if not clean["connections"] and not clean["senders"] or time.perf_counter()>=deadline:
                        break
                    await asyncio.sleep(.05)
            result["cleanup"]={k:clean[k] for k in ["connections","senders","pending_messages","pending_bytes"]}
            result["correctness"]["no_connection_or_writer_leaks"]=not any(result["cleanup"].values())


def asset_paths():
    # Bounded cold HTTP bundle: app shell, local modules, configured startup data.
    # No optional reference photos, CDN downloads or WebGL execution.
    import re
    config = (ROOT/"src/config.js").read_text(encoding="utf-8")
    paths = ["/", "/styles.css", "/favicon.svg"]
    paths += ["/"+p.relative_to(ROOT).as_posix() for p in sorted((ROOT/"src").rglob("*.js"))
              if not p.name.startswith("test-")]
    paths += ["/"+p for p in dict.fromkeys(re.findall(r'"(assets/[^"`]+)"',config))]
    return paths


async def static_run(base,child,args):
    paths = asset_paths()
    process = psutil.Process(child.pid)
    cpu0, start = cpu_seconds(process),time.perf_counter()
    async def page():
        began = time.perf_counter()
        sem = asyncio.Semaphore(6)
        async with httpx.AsyncClient(base_url=base,timeout=60,trust_env=False,
                                    headers={"Accept-Encoding":"gzip"}) as http:
            async def get(path):
                async with sem:
                    async with http.stream("GET",path) as response:
                        response.raise_for_status()
                        raw = sum([len(chunk) async for chunk in response.aiter_raw()])
                        file = ROOT/("index.html" if path=="/" else path.lstrip("/"))
                        return dict(path=path,wire_body_bytes=raw,source_bytes=file.stat().st_size,
                                    encoding=response.headers.get("content-encoding","identity"))
            files = await asyncio.gather(*(get(p) for p in paths))
        return dict(seconds=time.perf_counter()-began,files=files)
    pages = await asyncio.gather(*(page() for _ in range(args.static_clients)))
    elapsed = time.perf_counter()-start
    return dict(clients=args.static_clients,elapsed_s=elapsed,page_seconds=summary([p["seconds"] for p in pages]),
                server_cpu_percent=100*(cpu_seconds(process)-cpu0)/elapsed,
                server_rss_mb=process.memory_info().rss/1024**2,
                total_body_bytes=sum(f["wire_body_bytes"] for p in pages for f in p["files"]),
                manifest=pages[0]["files"])


async def run(args):
    # Bind only loopback, choose port atomically. Windows socket.share needs PID.
    sock = socket.socket()
    sock.bind(("127.0.0.1",0))
    sock.listen(2048)
    base = f"http://127.0.0.1:{sock.getsockname()[1]}"
    with tempfile.TemporaryDirectory(prefix="oceanview-load-") as temp:
        token = Path(temp)/"socket.txt"
        log_path = Path(temp)/"server.log"
        cmd = [sys.executable,str(Path(__file__).resolve()),"--serve","--variant",args.variant,
               "--socket-file",str(token),"--stall-seconds",str(args.stall_seconds)]
        if args.no_compression:
            cmd.append("--no-compression")
        with log_path.open("w",encoding="utf-8") as log:
            child = subprocess.Popen(cmd,cwd=ROOT,stdout=log,stderr=log,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0,
                                     pass_fds=() if os.name=="nt" else (sock.fileno(),))
            token.write_text(sock.share(child.pid).hex() if os.name=="nt" else str(sock.fileno()))
            try:
                async with httpx.AsyncClient(timeout=1,trust_env=False) as http:
                    for _ in range(100):
                        if child.poll() is not None:
                            raise RuntimeError(log_path.read_text(encoding="utf-8"))
                        try:
                            await http.get(base+"/__loadtest/metrics")
                            break
                        except httpx.HTTPError:
                            await asyncio.sleep(.1)
                    else:
                        raise RuntimeError("Isolated server startup timed out")
                result = await (static_run(base,child,args) if args.static_clients else presence_run(base,child,args))
            except Exception as exc:
                result = {"failure":type(exc).__name__+": "+str(exc)}
            finally:
                child.terminate()
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                sock.close()
            result["server_log"] = log_path.read_text(encoding="utf-8")[-4000:]
    result["environment"] = dict(time_utc=datetime.now(timezone.utc).isoformat(),
        python=sys.version,platform=platform.platform(),processor=platform.processor(),
        logical_cpus=psutil.cpu_count(),physical_cpus=psutil.cpu_count(logical=False),
        memory_gb=psutil.virtual_memory().total/1024**3,
        packages={p:importlib.metadata.version(p) for p in ["uvicorn","websockets","fastapi","starlette","httpx","psutil"]},
        proxy_sha256=hashlib.sha256((ROOT/"server/proxy.py").read_bytes()).hexdigest(),
        git_head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip())
    result["settings"] = {k:v for k,v in vars(args).items() if not k.startswith("socket")}
    output = Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"output":str(output),**{k:result[k] for k in
          ("elapsed_s","server_cpu_percent","pressure_stop","achieved_updates_per_client_s","errors","failure") if k in result}}),flush=True)
    if result.get("failure") or result.get("errors") or result.get("pressure_stop") or not all(result.get("correctness",{}).values()):
        return 2
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--clients",type=int,default=10)
    p.add_argument("--seconds",type=float,default=15)
    p.add_argument("--warmup",type=float,default=4)
    p.add_argument("--hz",type=float,default=2)
    p.add_argument("--variant",choices=["baseline","once","current"],default="current")
    p.add_argument("--mixture",choices=["mixed","camera"],default="mixed")
    p.add_argument("--slow-clients",type=int,default=0)
    p.add_argument("--slow-delay",type=float,default=3)
    p.add_argument("--stall-seconds",type=float,default=0,
                   help="Block one client's ASGI send once, for a deterministic backpressure test")
    p.add_argument("--expect-stall-close",action="store_true",help="Expect code 1013 on the deliberately stalled client")
    p.add_argument("--no-compression",action="store_true")
    p.add_argument("--static-clients",type=int,default=0)
    p.add_argument("--max-rss-mb",type=int,default=512)
    p.add_argument("--output",default="load-results/latest.json")
    p.add_argument("--serve",action="store_true",help=argparse.SUPPRESS)
    p.add_argument("--socket-file",help=argparse.SUPPRESS)
    args = p.parse_args()
    if args.serve:
        token = Path(args.socket_file)
        for _ in range(100):
            if token.exists():
                raw = token.read_text()
                if raw:
                    break
            time.sleep(.05)
        else:
            raise RuntimeError("Socket handoff timed out")
        args.socket_share,args.socket_fd = (raw,None) if os.name=="nt" else (None,int(raw))
        serve(args)
        return 0
    if not (1<=args.clients<=500 and 2<=args.seconds<=60 and 0<=args.warmup<=15
            and .1<=args.hz<=5 and 0<=args.slow_clients<=args.clients
            and 0<=args.static_clients<=10 and 1<=args.slow_delay<=10
            and 64<=args.max_rss_mb<=1024 and 0<=args.stall_seconds<=10):
        p.error("Bounds: 1–500 clients, 2–60 seconds, 0–15 warmup, .1–5 Hz, 0–10 static clients, 1–10 slow delay, 64–1024 MB RSS")
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
