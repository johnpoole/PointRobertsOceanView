"""Protocol/candidate checks; the staged run supplies real socket integration."""
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.load_presence import asset_paths, pose, serialize_once, summary, ROOT, load_proxy
from server import proxy


async def comparison():
    baseline, _ = load_proxy("baseline")
    class Socket:
        def __init__(self, fail=False):
            self.fail,self.messages = fail,[]
        async def send_text(self,text):
            if self.fail:
                raise ConnectionError("synthetic disconnected client")
            self.messages.append(text)

    message = {"message_type":"presence.state","data":{"here":[pose(i,31,"mixed") for i in range(6)]}}
    outputs = []
    for candidate in [False,True]:
        clients = baseline.Clients()
        sockets = [Socket(),Socket(True),Socket()]
        clients._sockets = {s:{} for s in sockets}
        removed = []
        def remove(ws):
            removed.append(ws)
            del clients._sockets[ws]
        clients.remove = remove
        await (serialize_once(clients,message) if candidate else clients.broadcast(message))
        assert removed==[sockets[1]] and list(clients._sockets)==[sockets[0],sockets[2]]
        outputs.append([s.messages for s in sockets])
    assert outputs[0]==outputs[1]
    assert outputs[0][0]==[json.dumps(message)]


if __name__=="__main__":
    for mixture in ["camera","mixed"]:
        for i in range(12):
            for seq in [0,1,100,375]:
                p = pose(i,seq,mixture)
                parsed = proxy.read_position(json.dumps(p))
                assert parsed and parsed["mode"]==p["mode"]
                assert ("body" in p)==("body" in parsed)
    assert summary([3,1,2])["p50"]==2
    assert summary([])=={"n":0}
    paths=asset_paths()
    assert len(paths)==len(set(paths))
    assert all((ROOT/("index.html" if p=="/" else p[1:])).is_file() for p in paths)
    assert all(not p.startswith("http") for p in paths)
    asyncio.run(comparison())
    print("PASS: bounded valid camera/vehicle poses, identical baseline/candidate bytes and failure removal, local asset manifest, summary statistics")
