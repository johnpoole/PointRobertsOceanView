"""Fire and medical calls on the point, off PulsePoint.

Whatcom County's fire and EMS dispatches go out through PulsePoint, and its
public web page shows them: what the call was, the address, when it came in,
when it closed, and which units went. Point Roberts is Station 58.

The page receives the incidents AES-encrypted and decrypts them in the browser
with a password its code assembles from "CommonIncidents" and "brady", and
this does the same. The format is CryptoJS's OpenSSL one: base64 ciphertext,
a hex IV and a hex salt, with the key drawn from the password and the salt by
MD5 in OpenSSL's EVP_BytesToKey.

The feed holds about the last hundred calls in the county, which is a day, so
calls are kept on disk as they arrive and the map grows from there. Only calls
on the peninsula are kept.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from Crypto.Cipher import AES

from server.peninsula import in_point_roberts

log = logging.getLogger("oceanview.pulsepoint")

SOURCE = "PulsePoint, Whatcom Fire/EMS"
AGENCY = "EMS1094"
FEED = f"https://api.pulsepoint.org/v1/webapp?resource=incidents&agencyid={AGENCY}"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://web.pulsepoint.org/"}
# How the web app builds it: "CommonIncidents"[13], [1] and [2] are t, o, m;
# then "brady", "5", and "r" + "i" + "n" + "gs".
PASSWORD = b"tombrady5rings"
KEEP_DAYS = 365
TYPES_FILE = Path("assets") / "pulsepoint-call-types.json"


def load_call_types(root: Path) -> dict[str, dict]:
    path = root / TYPES_FILE
    try:
        return json.loads(path.read_text(encoding="utf-8"))["types"]
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        raise RuntimeError(f"{path} could not be read ({exc}); the call types come "
                           "from PulsePoint's web app and are baked there.") from exc


def decrypt(wrapped: dict) -> dict:
    """The feed as the web page sees it after decrypting."""
    try:
        salt = bytes.fromhex(wrapped["s"])
        iv = bytes.fromhex(wrapped["iv"])
        body = base64.b64decode(wrapped["ct"])
    except (KeyError, ValueError, TypeError) as exc:
        raise RuntimeError(f"PulsePoint's feed is not in the ct/iv/s form: {exc}") from exc
    derived, prev = b"", b""
    while len(derived) < 48:
        prev = hashlib.md5(prev + PASSWORD + salt).digest()
        derived += prev
    key, derived_iv = derived[:32], derived[32:48]
    if derived_iv != iv:
        raise RuntimeError(
            "PulsePoint's feed does not decrypt with the password its web app used: "
            "the IV it sent is not the one the password gives. Read the password "
            "builder out of the current https://web.pulsepoint.org app code again.")
    plain = AES.new(key, AES.MODE_CBC, iv).decrypt(body)
    plain = plain[:-plain[-1]]
    # The plaintext is a JSON string holding the JSON document.
    inner = json.loads(plain.decode("utf-8"))
    return json.loads(inner) if isinstance(inner, str) else inner


def read_calls(feed: dict, types: dict[str, dict]) -> list[dict]:
    """The calls on the peninsula, active and recent."""
    incidents = feed.get("incidents")
    if not isinstance(incidents, dict):
        raise RuntimeError(f"PulsePoint's feed has no incidents; it has {sorted(feed)}")
    calls = []
    for group in ("active", "recent"):
        for row in incidents.get(group) or []:
            try:
                lat, lon = float(row["Latitude"]), float(row["Longitude"])
            except (KeyError, TypeError, ValueError):
                continue
            if not in_point_roberts(lat, lon):
                continue
            code = row.get("PulsePointIncidentCallType")
            known = types.get(code)
            calls.append({
                "id": str(row["ID"]),
                "type": code,
                # A code their table does not carry is shown as the code and not
                # given a meaning.
                "description": known["description"] if known else None,
                "category": known["category"] if known else None,
                "received": row.get("CallReceivedDateTime"),
                "closed": row.get("ClosedDateTime"),
                "address": row.get("FullDisplayAddress"),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "units": [u["UnitID"] for u in row.get("Unit") or [] if u.get("UnitID")],
                "active": group == "active",
            })
    return calls


@dataclass
class FireCalls:
    path: Path
    types: dict[str, dict]
    calls: dict[str, dict] = field(default_factory=dict)     # id -> call

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            self.calls = json.loads(self.path.read_text(encoding="utf-8"))["calls"]
        except (json.JSONDecodeError, OSError, KeyError) as exc:
            raise RuntimeError(f"{self.path} is there but unreadable: {exc}. Move it "
                               "aside and the next pass starts the calls again.") from exc
        log.info("Fire and medical calls: %d off disk", len(self.calls))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"calls": self.calls}), encoding="utf-8")

    def take(self, incoming: list[dict]) -> int:
        """New calls are added. A call already kept is brought up to date: it
        closes, and units assigned since are added. Returns how many were new."""
        added = 0
        for call in incoming:
            kept = self.calls.get(call["id"])
            if kept is None:
                self.calls[call["id"]] = call
                added += 1
                continue
            kept["active"] = call["active"]
            if call["closed"]:
                kept["closed"] = call["closed"]
            if call["units"]:
                kept["units"] = sorted(set(kept["units"]) | set(call["units"]))
        return added

    def trim(self, now: datetime) -> None:
        cutoff = now - timedelta(days=KEEP_DAYS)
        self.calls = {k: c for k, c in self.calls.items()
                      if c["received"] and _when(c["received"]) >= cutoff}

    async def refresh(self, client: httpx.AsyncClient) -> int:
        answer = await client.get(FEED, headers=HEADERS, follow_redirects=True)
        answer.raise_for_status()
        added = self.take(read_calls(decrypt(answer.json()), self.types))
        self.trim(datetime.now(timezone.utc))
        self.save()
        return added

    def as_data(self) -> dict:
        newest = sorted(self.calls.values(), key=lambda c: c["received"] or "", reverse=True)
        return {"calls": newest, "agency": AGENCY}

    def latest_time(self) -> datetime | None:
        return max((_when(c["received"]) for c in self.calls.values() if c["received"]),
                   default=None)


def _when(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))
