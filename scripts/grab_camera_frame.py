"""Pull one frame off the Ocean View camera and write it to a file.

The Wyze cameras give no still images — the integration's async_camera_image
returns nothing on purpose, so /api/camera_proxy answers 500 and always will.
The only way to a picture is to open the WebRTC stream and take a frame off it.

So a browser does it. It is pointed at Home Assistant's own origin, and the
whole handshake runs inside that page: a websocket to the HA API, a receive-only
peer connection, the offer up, the answer and the ICE candidates back, then the
first frame that arrives is drawn to a canvas and handed out as a PNG.

Needs a long-lived access token from the HA profile page, in .env as
HA_TOKEN. Keep it out of the repo.

Run:
    .venv/Scripts/python scripts/grab_camera_frame.py
    .venv/Scripts/python scripts/grab_camera_frame.py --entity camera.front_door

Output:
    assets/reference/<entity>-<utc timestamp>.png
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "reference"

# The Pi at the Calgary house, over Tailscale. The LAN name resolves badly.
HA_URL = "http://100.87.94.99:8123"

# Long enough for the camera to wake, the P2P path to come up and a keyframe to
# arrive. A cold camera is slow; ten seconds is not enough and looks like a bug.
GRAB_TIMEOUT_MS = 25000

# The handshake and the frame grab, run inside a page served by HA so the
# websocket is same-origin. Returns a PNG data URL, or throws with what failed.
GRAB_JS = r"""
async ({ token, entityId, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const strange = [];   // anything on the subscription that was not expected

  // Every step here can stall on something the far end never sends, and a
  // promise that never settles is a script that hangs with nothing to show for
  // it. One clock over the lot, and a note of what it was waiting for.
  let stage = "starting";
  const guard = sleep(timeoutMs).then(() => {
    throw new Error(`gave up while ${stage}, after ${timeoutMs / 1000} s`);
  });
  const work = (async () => {

  const say = (what) => { stage = what; console.log(`stage: ${what}`); };

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);

  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/websocket`);
  let nextId = 1;
  let sessionId = null;
  let answered = false;
  let pc = null;
  let authOk = null, authFailed = null;
  const authDone = new Promise((ok, no) => { authOk = ok; authFailed = no; });
  // Once auth has gone through, authDone is settled and rejecting it does
  // nothing, so later trouble is kept here where the waiting loop looks for it.
  let failure = null;
  const giveUp = (e) => { failure = e; authFailed(e); };
  const pending = [];    // our candidates, until HA names the session
  const theirs = [];     // and theirs, until the answer is in
  const replies = new Map();

  const send = (payload) => { const id = nextId++; ws.send(JSON.stringify({ id, ...payload })); return id; };
  const ask = (payload) => new Promise((ok) => { replies.set(send(payload), ok); });
  const sendCandidate = (c) => send({
    type: "camera/webrtc/candidate", entity_id: entityId, session_id: sessionId,
    candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex },
  });

  // One handler for the whole conversation: auth first, then the subscription's
  // events. Splitting it races the auth message, which arrives immediately.
  //
  // Everything in here is wrapped, because an async event handler that throws
  // does it into nobody's hands: the rejection is unhandled, the page carries on
  // as though the message never came, and the wait outside times out saying the
  // camera never answered when what really happened is that the answer arrived
  // and setRemoteDescription refused it.
  ws.onmessage = async (m) => {
    try { await handle(JSON.parse(m.data)); }
    catch (e) { giveUp(new Error(`handling a message from HA: ${e.message}`)); }
  };

  const handle = async (msg) => {
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: token }));
      return;
    }
    if (msg.type === "auth_ok") { authOk(); return; }
    if (msg.type === "auth_invalid") {
      authFailed(new Error(`HA refused the token: ${msg.message}`));
      return;
    }
    if (msg.type === "result") {
      if (msg.success === false) {
        giveUp(new Error(`HA said no to ${msg.id}: ${msg.error && msg.error.message}`));
        return;
      }
      const want = replies.get(msg.id);
      if (want) { replies.delete(msg.id); want(msg.result); }
      return;
    }
    if (msg.type !== "event") return;
    const ev = msg.event;
    if (ev.type === "session") {
      sessionId = ev.session_id;
      while (pending.length) sendCandidate(pending.shift());
      return;
    }
    if (ev.type === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: ev.answer });
      answered = true;
      while (theirs.length) await pc.addIceCandidate(theirs.shift());
      return;
    }
    if (ev.type === "candidate") {
      // The far end trickles its first candidate before the answer, and a
      // candidate with no remote description on the connection is an error, not
      // a wait. Hold them until there is something to add them to.
      const c = ev.candidate;
      const cand = typeof c === "string" ? { candidate: c, sdpMLineIndex: 0 } : c;
      if (answered) await pc.addIceCandidate(cand); else theirs.push(cand);
      return;
    }
    if (ev.type === "error") {
      giveUp(new Error(`HA said: ${ev.code || ""} ${ev.message || JSON.stringify(ev)}`));
      return;
    }
    strange.push(ev);
  };

  console.log("handler ready");
  say(`opening a websocket to ${location.origin}`);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = () => no(new Error(`the websocket to ${location.origin} would not open`));
  });

  say("waiting for HA to take the token");
  await authDone;

  // The camera is on the Point Roberts LAN and this is not, so the only path
  // between them is the relay Wyze hands out with the session. Without these
  // the offer is answered and nothing ever connects.
  say("asking for the ICE servers");
  const clientConfig = await ask(
    { type: "camera/webrtc/get_client_config", entity_id: entityId });
  const iceServers = (clientConfig && clientConfig.configuration
                      && clientConfig.configuration.iceServers) || [];
  console.log(`ice servers: ${iceServers.length}`);
  if (!iceServers.length) {
    throw new Error("HA gave back no ICE servers, so there is no path to the camera");
  }

  pc = new RTCPeerConnection({ iceServers });
  pc.addTransceiver("video", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (e) => { stream.addTrack(e.track); video.srcObject = stream; };
  pc.oniceconnectionstatechange = () => console.log(`ice: ${pc.iceConnectionState}`);

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    if (sessionId) sendCandidate(e.candidate); else pending.push(e.candidate);
  };

  say("making the offer");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: "camera/webrtc/offer", entity_id: entityId, offer: offer.sdp });

  // A size on the element and a clock that has moved means a frame decoded.
  say(`waiting for ${entityId} to answer`);
  let noted = false;
  while (Date.now() < deadline) {
    if (answered && !noted) { noted = true; say("waiting for a frame to decode"); }
    if (video.videoWidth && video.readyState >= 2 && video.currentTime > 0) break;
    // A real timer, not a settled promise. Awaiting something already resolved
    // yields the microtask queue and nothing else, so the loop spins and the
    // websocket's own messages never get their turn — the answer arrives at the
    // socket and is never read, and this waits out the clock for no reason.
    await sleep(100);
    if (failure) throw failure;
  }
  if (!video.videoWidth || video.currentTime === 0) {
    const seen = strange.length ? ` Unexpected events: ${JSON.stringify(strange)}.` : "";
    throw new Error(
      (answered
        ? `${entityId} answered and the peer connection is ${pc.connectionState}/` +
          `${pc.iceConnectionState}, but no frame decoded in ${timeoutMs / 1000} s. ` +
          `That is a codec or a path problem, not the handshake.`
        : `${entityId} never answered in ${timeoutMs / 1000} s.`) + seen);
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const url = canvas.toDataURL("image/png");
  ws.close();
  pc.close();
  return { url, width: canvas.width, height: canvas.height };
  })();

  return await Promise.race([work, guard]);
}
"""


def token_from_env() -> str:
    """HA_TOKEN out of the environment or .env, which is not in the repo."""
    token = os.environ.get("HA_TOKEN")
    if token:
        return token.strip()
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("HA_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise SystemExit(
        f"grab_camera_frame: no HA_TOKEN. Make a long-lived access token at\n"
        f"  {HA_URL}/profile/security\n"
        f"and put it in {env} as\n"
        f"  HA_TOKEN=...\n"
        f"It is a credential; .env is already out of the repo.")


def grab(entity: str, token: str, headed: bool) -> tuple[bytes, int, int]:
    with sync_playwright() as p:
        # Playwright's own Chromium build ships without H.264, which is what
        # these cameras send, so the installed Chrome is used where there is
        # one. Without it the handshake completes and no frame ever decodes.
        try:
            browser = p.chromium.launch(channel="chrome", headless=not headed)
            which = "Chrome"
        except Exception:
            browser = p.chromium.launch(headless=not headed)
            which = "Playwright Chromium (no H.264 — a frame may never decode)"
        print(f"browser: {which}", flush=True)
        page = browser.new_page()
        # The handshake runs in the page, so its complaints belong here.
        page.on("console", lambda m: print(f"  page {m.type}: {m.text}", flush=True))
        page.on("pageerror", lambda e: print(f"  page error: {e}", flush=True))
        # Same origin as the websocket, so nothing has to be allowed through.
        # Not the front page: that one redirects itself to the login flow and
        # the navigation tears down the script half way through the handshake.
        # /api/ is a two-line JSON reply on the same origin that sits still.
        page.goto(f"{HA_URL}/api/", wait_until="domcontentloaded")
        result = page.evaluate(
            GRAB_JS,
            {"token": token, "entityId": entity, "timeoutMs": GRAB_TIMEOUT_MS})
        browser.close()
    head, b64 = result["url"].split(",", 1)
    if "image/png" not in head:
        raise SystemExit(f"grab_camera_frame: the canvas gave back {head}, not a PNG")
    return base64.b64decode(b64), result["width"], result["height"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entity", default="camera.ocean_view",
                    help="camera.ocean_view (west, lower level) or camera.front_door")
    ap.add_argument("--headed", action="store_true",
                    help="show the browser, to watch the handshake")
    args = ap.parse_args()

    token = token_from_env()
    png, w, h = grab(args.entity, token, args.headed)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = OUT_DIR / f"{args.entity.split('.', 1)[1]}-{stamp}.png"
    out.write_bytes(png)
    print(f"{out}  {w} x {h}  {len(png)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
