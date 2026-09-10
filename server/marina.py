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

# Where the model lives in the image. The Dockerfile fetches it and checks its
# hash; a missing file is a hard error rather than a quiet skip.
#
# YOLOX-tiny, Apache-2.0, trained on COCO. The first model here was MobileNet-SSD
# trained on VOC, which has no truck class at all, so a pickup standing in the
# lot was invisible to it by construction — which is exactly what was in the
# frame it was tested against.
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
WEIGHTS = MODEL_DIR / "yolox-tiny.onnx"

# COCO, in its own order. Only the first nine are ever looked at; the rest are
# here so that an index means what the model meant by it.
CLASSES = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
           "truck", "boat", "traffic light", "fire hydrant", "stop sign",
           "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
           "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag",
           "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
           "baseball bat", "baseball glove", "skateboard", "surfboard",
           "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon",
           "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot",
           "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
           "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
           "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
           "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
           "hair drier", "toothbrush"]

# What is worth counting here, and what to call it on the way out.
KEEP = {"car": "vehicles", "truck": "vehicles", "bus": "vehicles",
        "motorcycle": "vehicles", "person": "people", "boat": "boats"}

# Below this the detector is guessing. The vehicles in the frame this was tuned
# against came back between 0.26 and 0.39, so it sits under those and over the
# noise on the water.
CONFIDENCE = 0.30

# The model takes a 416 by 416 image. Handing it the whole frame at once found
# the boats and none of the cars, so the frame is walked in 416-pixel tiles at
# their own scale with a quarter of a tile of overlap. Eight tiles for a 1280 by
# 720 frame, about eight hundred milliseconds.
TILE = 416
STRIDE = 312

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
        import numpy as np

        if not WEIGHTS.exists():
            raise FileNotFoundError(
                f"Marina detector cannot start: {WEIGHTS} is not in the image. "
                f"The Dockerfile fetches it; a build that skipped that step "
                f"produces exactly this.")
        self._cv2 = cv2
        self.net = cv2.dnn.readNetFromONNX(str(WEIGHTS))
        # YOLOX gives its boxes against the three grids it was built on rather
        # than in pixels, so the offsets and strides are worked out once here.
        grids, strides = [], []
        for step in (8, 16, 32):
            side = TILE // step
            ys, xs = np.meshgrid(np.arange(side), np.arange(side), indexing="ij")
            grids.append(np.stack((xs, ys), 2).reshape(-1, 2))
            strides.append(np.full((side * side, 1), step))
        self._grid = np.concatenate(grids)
        self._stride = np.concatenate(strides)
        log.info("Marina detector loaded from %s", WEIGHTS)

    def _tile(self, patch, ox, oy):
        """Everything the model finds in one 416-pixel window, in frame pixels."""
        import numpy as np

        cv2 = self._cv2
        blob = cv2.dnn.blobFromImage(patch, 1.0, (TILE, TILE), swapRB=False)
        self.net.setInput(blob)
        out = self.net.forward()[0].copy()
        out[:, 0:2] = (out[:, 0:2] + self._grid) * self._stride
        out[:, 2:4] = np.exp(out[:, 2:4]) * self._stride
        # One score per class: how sure it is that anything is there at all,
        # times how sure it is of what it is.
        scores = out[:, 4:5] * out[:, 5:]
        best = scores.argmax(1)
        confidence = scores.max(1)
        for i in np.where(confidence > CONFIDENCE)[0]:
            bucket = KEEP.get(CLASSES[int(best[i])])
            if bucket is None:
                continue
            cx, cy, w, h = (float(v) for v in out[i, :4])
            yield (bucket, float(confidence[i]),
                   (ox + cx - w / 2, oy + cy - h / 2,
                    ox + cx + w / 2, oy + cy + h / 2))

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
        # The last row and column are pinned to the far edge rather than left off.
        # Stepping by the stride alone stops short whenever the frame is not a
        # whole number of strides wide, and on a 1280 by 720 frame that left the
        # bottom 120 pixels and the right 80 unscanned — which is the near field
        # of the car park, the part with the cars in it.
        found = []
        for y in _offsets(height):
            for x in _offsets(width):
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


def _offsets(size: int) -> list[int]:
    """Where the tiles start along one side, the last one flush with the edge."""
    last = max(size - TILE, 0)
    starts = list(range(0, last + 1, STRIDE))
    if starts[-1] != last:
        starts.append(last)
    return starts


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
