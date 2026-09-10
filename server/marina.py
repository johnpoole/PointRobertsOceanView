"""What the marina camera can see of cars, people and boats.

The Point Roberts Marina publishes two webcams. The second one, prm, looks over
the basin with the parking lot across its near field, and HDOnTap serve a live
640x360 still of it. One still a minute goes through a small detector here and
what comes out is counts, split by where in the frame they stood. Nothing else
leaves this module: no frame is stored, nothing is written to disk, and no
position is claimed in world coordinates, because nobody has calibrated the
camera and a count is not a survey.

The resolution is the point rather than a limitation. At 640x360 a car in the
lot is about forty pixels across and a person on the dock is five or six, so
what this can report about a person is that one appears to be there, and often
not even that. Vehicles are the reliable half. Both are reported with the
confidence the detector gave them, and the counts say how sure they are.

The endpoint is undocumented. It is one GET with no key today and it may grow
one, so a failure here is loud: the feed goes offline with the reason on it
rather than reporting zero cars, which is what an empty lot also looks like.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("oceanview.marina")

# size=full is the 1280x720 still. The default is 640x360, and at that size a
# car in the lot is forty pixels and the detector finds none of them: it was
# tested on a daylight frame with three cars plainly in it and reported zero.
SNAPSHOT_URL = "https://portal.hdontap.com/snapshot/point-roberts_prm-CUST?size=full"
SOURCE = "pointrobertsmarina.com webcam (HDOnTap still)"

# Where the model lives in the image. The Dockerfile fetches both files and
# checks their hashes; a missing one is a hard error rather than a quiet skip.
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
PROTOTXT = MODEL_DIR / "mobilenet-ssd.prototxt"
WEIGHTS = MODEL_DIR / "mobilenet-ssd.caffemodel"

# MobileNet-SSD's twenty-one classes, in its own order.
CLASSES = ["background", "aeroplane", "bicycle", "bird", "boat", "bottle", "bus",
           "car", "cat", "chair", "cow", "diningtable", "dog", "horse", "motorbike",
           "person", "pottedplant", "sheep", "sofa", "train", "tvmonitor"]

# What is worth counting here, and what to call it on the way out.
KEEP = {"car": "vehicles", "bus": "vehicles", "motorbike": "vehicles",
        "person": "people", "boat": "boats"}

# Below this the detector is guessing. Kept low enough that a car eighty pixels
# across is found and high enough that the water does not become a fleet.
CONFIDENCE = 0.35

# The model takes a 300 by 300 image. Handing it the whole frame shrinks a car
# to nineteen pixels and it sees nothing, so the frame is walked in 300-pixel
# tiles at their own scale, overlapping by half so nothing is lost on a seam.
# Twenty-one tiles for a 1280 by 720 frame, and about a second to read them all.
TILE = 300
STRIDE = 150

# Two tiles overlapping means one car can be found twice. Boxes that cover each
# other by more than this are the same thing counted twice.
OVERLAP = 0.35

# The lot fills the near third of the frame and the docks sit above it. This is
# read off the frame, not surveyed, and it is the only spatial claim made.
LOT_TOP_FRACTION = 0.65


@dataclass
class Reading:
    """One sample. counts are what was found; boxes never leave the server."""
    at: float
    width: int = 0
    height: int = 0
    vehicles: int = 0
    people: int = 0
    boats: int = 0
    in_lot: int = 0
    on_water: int = 0
    confidences: list[float] = field(default_factory=list)

    def as_data(self) -> dict:
        return {
            "vehicles": self.vehicles,
            "people": self.people,
            "boats": self.boats,
            "in_lot": self.in_lot,
            "on_water": self.on_water,
            "detections": len(self.confidences),
            "confidence_min": round(min(self.confidences), 2) if self.confidences else None,
            "confidence_max": round(max(self.confidences), 2) if self.confidences else None,
            "frame_width": self.width,
            "frame_height": self.height,
        }


class Detector:
    """The model, loaded once. Raises if it is not there — never degrades."""

    def __init__(self) -> None:
        import cv2  # imported here so the module can be read without opencv

        missing = [p for p in (PROTOTXT, WEIGHTS) if not p.exists()]
        if missing:
            raise FileNotFoundError(
                "Marina detector cannot start: "
                + ", ".join(str(p) for p in missing)
                + " is not in the image. The Dockerfile fetches these; a build that "
                  "skipped that step produces exactly this.")
        self._cv2 = cv2
        self.net = cv2.dnn.readNetFromCaffe(str(PROTOTXT), str(WEIGHTS))
        log.info("Marina detector loaded from %s", MODEL_DIR)

    def _tile(self, patch, ox, oy):
        """Everything the model finds in one 300-pixel window, in frame pixels."""
        cv2 = self._cv2
        blob = cv2.dnn.blobFromImage(patch, 0.007843, (TILE, TILE), 127.5)
        self.net.setInput(blob)
        out = self.net.forward()
        for i in range(out.shape[2]):
            confidence = float(out[0, 0, i, 2])
            if confidence < CONFIDENCE:
                continue
            bucket = KEEP.get(CLASSES[int(out[0, 0, i, 1])])
            if bucket is None:
                continue
            x0 = ox + float(out[0, 0, i, 3]) * TILE
            y0 = oy + float(out[0, 0, i, 4]) * TILE
            x1 = ox + float(out[0, 0, i, 5]) * TILE
            y1 = oy + float(out[0, 0, i, 6]) * TILE
            yield bucket, confidence, (x0, y0, x1, y1)

    def read(self, jpeg: bytes) -> Reading:
        """Counts for one frame. Raises on anything that is not a frame."""
        import numpy as np

        cv2 = self._cv2
        image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(
                f"Marina snapshot was not a decodable image ({len(jpeg)} bytes from "
                f"{SNAPSHOT_URL}); the endpoint may have started answering with HTML.")
        height, width = image.shape[:2]
        if width < TILE or height < TILE:
            raise ValueError(
                f"Marina snapshot came back {width}x{height}, smaller than one "
                f"{TILE}-pixel tile; the endpoint has changed what it serves.")
        found = []
        for y in range(0, max(height - TILE, 0) + 1, STRIDE):
            for x in range(0, max(width - TILE, 0) + 1, STRIDE):
                found.extend(self._tile(image[y:y + TILE, x:x + TILE], x, y))
        reading = Reading(at=time.time(), width=width, height=height)
        for bucket, confidence, box in _merge(found):
            setattr(reading, bucket, getattr(reading, bucket) + 1)
            reading.confidences.append(confidence)
            middle = (box[1] + box[3]) / 2 / height
            if middle >= LOT_TOP_FRACTION:
                reading.in_lot += 1
            else:
                reading.on_water += 1
        return reading


def _overlap(a, b) -> float:
    """How much of the smaller box the two share, 0 to 1."""
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    both = (x1 - x0) * (y1 - y0)
    areas = [(q[2] - q[0]) * (q[3] - q[1]) for q in (a, b)]
    smaller = min(areas)
    return both / smaller if smaller > 0 else 0.0


def _merge(found):
    """One thing found in two overlapping tiles is one thing, not two.

    Keeps the most confident of each cluster. Only boxes of the same kind are
    merged: a person standing beside a car is two things in the same place.
    """
    kept = []
    for bucket, confidence, box in sorted(found, key=lambda f: -f[1]):
        if any(other[0] == bucket and _overlap(box, other[2]) > OVERLAP
               for other in kept):
            continue
        kept.append((bucket, confidence, box))
    return kept


async def sample(client, detector: Detector) -> Reading:
    """Pull one still and read it. Every failure raises with what and where."""
    response = await client.get(SNAPSHOT_URL, timeout=45,
                                headers={"User-Agent": "PointRobertsOceanView/1.0"})
    response.raise_for_status()
    kind = response.headers.get("content-type", "")
    if not kind.startswith("image/"):
        raise ValueError(
            f"Marina snapshot answered {kind or 'no content-type'} rather than an "
            f"image; {SNAPSHOT_URL} has changed or is refusing this client.")
    return detector.read(response.content)
