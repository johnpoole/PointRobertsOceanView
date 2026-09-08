"""Deterministic single-writer, bounded delivery and connection lifecycle checks.
Run: python server/test_delivery.py (no network or upstream tasks).
"""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
import sys
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import proxy


class Socket:
    headers = {}
    client = SimpleNamespace(host="127.0.0.1")

    def __init__(self):
        self.messages=[]
        self.active=0
        self.peak=0
        self.gate=asyncio.Event()
        self.gate.set()
        self.entered=asyncio.Event()
        self.closed=[]
        self.fail=False
        self.block_close=False

    async def accept(self):
        await asyncio.sleep(0)

    async def send_text(self,text):
        self.active+=1
        self.peak=max(self.peak,self.active)
        self.entered.set()
        try:
            await self.gate.wait()
            if self.fail:
                raise ConnectionError("test write failure")
            self.messages.append(json.loads(text))
        finally:
            self.active-=1

    async def close(self,code):
        assert self.active==0,"close must not race an active send"
        self.closed.append(code)
        if self.block_close:
            await asyncio.Event().wait()


async def until(check):
    async def wait():
        while not check():
            await asyncio.sleep(.001)
    await asyncio.wait_for(wait(),1)


def message(kind="presence.state",seq=0):
    return {"message_type":kind,"seq":seq,"data":{"here":[]}}


async def new_pair():
    clients=proxy.Clients()
    a,b=Socket(),Socket()
    await clients.add(a)
    await clients.add(b)
    await until(lambda:len(a.messages)==2 and len(b.messages)==2)
    return clients,a,b


async def test_initial_order_encoding_visibility():
    clients=proxy.Clients()
    sockets=[Socket() for _ in range(6)]
    # Broadcast immediately after registration, before writers can execute.
    for i,s in enumerate(sockets):
        await clients.add(s)
        await clients.broadcast(message("heartbeat",i))
    await until(lambda:all(len(s.messages)>=3 for s in sockets))
    for s in sockets:
        assert [m["message_type"] for m in s.messages[:2]]==["presence.you","initial.snapshot"]
    for s,mode in zip(sockets,["orbit","walk","bike","cart","boat","ultralight"]):
        p=dict(type="here",lat=48.977,lon=-123.067,y=10,heading=210,mode=mode,
               body=dict(lat=48.977,lon=-123.067,y=8.4,heading=210,pitch=2,roll=-1))
        clients.place(s,proxy.read_position(json.dumps(p)))
    here=clients.placed()
    assert len(here)==6 and len({p['id'] for p in here})==6
    assert '127.0.0.1' not in json.dumps(here)
    assert all('body' in p for p in here[1:])
    with patch.object(proxy.json,"dumps",wraps=json.dumps) as encoded:
        await clients.broadcast({"message_type":"presence.state","data":{"here":here}})
        assert encoded.call_count==1
    await until(lambda:all(s.messages[-1]["message_type"]=="presence.state" for s in sockets))
    assert all(s.messages[-1]["data"]["here"]==here for s in sockets)
    assert all(s.peak==1 for s in sockets)
    await clients.shutdown()
    assert not clients._sockets and not clients._senders


async def test_coalescing_order_and_isolation():
    clients,slow,fast=await new_pair()
    slow.gate.clear();slow.entered.clear()
    await clients.broadcast(message(seq=0))
    await slow.entered.wait()
    await clients.broadcast(message(seq=1))
    await clients.broadcast(message("vessel.position",1))
    await clients.broadcast(message(seq=2))
    await clients.broadcast(message("initial.snapshot",2))
    await clients.broadcast(message(seq=3))
    await clients.broadcast(message("vessel.removed",3))
    await until(lambda:fast.messages[-1]["message_type"]=="vessel.removed")
    delivery=clients._sockets[slow]["delivery"]
    assert len(delivery.pending)==4
    assert [json.loads(x[1])["message_type"] for x in delivery.pending]==[
        "vessel.position","initial.snapshot","presence.state","vessel.removed"]
    assert json.loads(delivery.presence[1])["seq"]==3
    assert delivery.bytes==sum(x[2] for x in delivery.pending)
    slow.gate.set()
    await until(lambda:slow.messages[-1]["message_type"]=="vessel.removed")
    assert [(m["message_type"],m["seq"]) for m in slow.messages[2:]]==[
        ("presence.state",0),("vessel.position",1),("initial.snapshot",2),
        ("presence.state",3),("vessel.removed",3)]
    assert slow.peak==fast.peak==1
    await clients.shutdown()


async def test_overflow_timeout_reconnect_cleanup():
    for limit in ["messages","bytes"]:
        clients,slow,fast=await new_pair()
        old_id=clients._sockets[slow]["id"]
        slow.gate.clear();slow.entered.clear()
        await clients.broadcast(message(seq=0));await slow.entered.wait()
        with patch.object(proxy,"CLIENT_QUEUE_MESSAGES",3 if limit=="messages" else 128), \
             patch.object(proxy,"CLIENT_QUEUE_BYTES",200 if limit=="bytes" else 2*1024**2):
            for seq in range(6):
                await clients.broadcast(message("vessel.position",seq))
                await until(lambda:fast.messages[-1].get("seq")==seq and fast.messages[-1]["message_type"]=="vessel.position")
        await until(lambda:slow.closed)
        assert slow.closed==[1013] and clients.count==1 and clients.delivery_stats["overflow"]==1
        replacement=Socket();await clients.add(replacement)
        await until(lambda:len(replacement.messages)==2)
        assert replacement.messages[0]["data"]["id"]!=old_id
        assert replacement.messages[1]["message_type"]=="initial.snapshot"
        await clients.shutdown()
        assert not clients._senders
    clients,slow,fast=await new_pair()
    slow.gate.clear()
    with patch.object(proxy,"CLIENT_SEND_SECONDS",.05):
        await clients.broadcast(message())
        await until(lambda:slow.closed)
    assert slow.closed==[1013] and clients.delivery_stats["timeouts"]==1
    assert fast.messages[-1]["message_type"]=="presence.state"
    await clients.shutdown()
    assert not clients._senders


async def test_early_disconnect_failure_and_stuck_close():
    clients=proxy.Clients();s=Socket()
    await clients.add(s)
    await clients.disconnect(s)  # sender hasn't had an opportunity to run yet
    assert s.closed==[1000] and not clients._senders
    clients,a,b=await new_pair();a.fail=True
    await clients.broadcast(message())
    await until(lambda:a.closed)
    assert a.closed==[1011] and clients.count==1
    b.gate.clear();b.entered.clear();b.block_close=True
    await clients.broadcast(message());await b.entered.wait()
    with patch.object(proxy,"CLIENT_CLOSE_SECONDS",.03):
        await asyncio.wait_for(clients.shutdown(),.3)
    assert not clients._senders and not clients._sockets
    clients=proxy.Clients();s=Socket();s.block_close=True
    await clients.add(s);await until(lambda:len(s.messages)==2)
    with patch.object(proxy,"CLIENT_CLOSE_SECONDS",.03):
        leaving=asyncio.create_task(clients.disconnect(s))
        await until(lambda:s.closed)
        leaving.cancel()  # receiving ASGI task cancelled during writer cleanup
        await leaving
        await until(lambda:not clients._senders)
    assert clients.count==0


async def test_presence_backlog_is_one_item():
    clients,s,fast=await new_pair()
    s.gate.clear();s.entered.clear()
    await clients.broadcast(message(seq=0));await s.entered.wait()
    delivery=clients._sockets[s]["delivery"]
    for seq in range(1,1001):
        delivery.offer(clients._encoded(message(seq=seq)))
    assert len(delivery.pending)==1 and json.loads(delivery.presence[1])["seq"]==1000
    assert delivery.bytes==delivery.presence[2] and clients.delivery_stats["coalesced"]==999
    s.gate.set();await until(lambda:s.messages[-1].get("seq")==1000)
    await clients.shutdown()


async def main():
    proxy.visitors=proxy.Visitors()
    for test in [test_initial_order_encoding_visibility,test_coalescing_order_and_isolation,
                 test_overflow_timeout_reconnect_cleanup,test_early_disconnect_failure_and_stuck_close,
                 test_presence_backlog_is_one_item]:
        await test();print("PASS",test.__name__)
    assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    assert all(r["open"]==0 for r in proxy.visitors.listing())


if __name__=="__main__":
    asyncio.run(main())
