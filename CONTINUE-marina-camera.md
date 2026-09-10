# The marina camera

The Point Roberts Marina publishes two webcams through HDOnTap. The second one,
`point-roberts_prm-CUST`, looks over the basin with the car park across its near
field. The server reads a still from it, counts what it can see, and the page
draws that many cars in the car park and that many people at the head of the
ramp.

John's decision, 10 September 2026: the marina put the camera on a public
website and will be happy for the views, so this reads it rather than waiting on
a written arrangement. The webcam reference notes are in
[CONTINUE-webcams.md](CONTINUE-webcams.md).

## Where the frame comes from

```
https://portal.hdontap.com/snapshot/point-roberts_prm-CUST?size=full
```

One GET, no key, 1280×720, about 120 KB. It is undocumented: the player page is
a shell that resolves its stream through their own API, and this endpoint was
found in the player's script. It works today and it can grow a token any week,
so every failure here is loud rather than quiet.

`?size=full` matters. The default is 640×360, where a car in that lot is forty
pixels across and reaches the detector as nineteen after its downscale. It was
tested against a daylight frame with three cars plainly in it and reported zero.

The first camera, `point-roberts_sw-view-CUST`, times out and then 504s on the
same endpoint. Either the snapshot service does not hold that stream or its name
differs there.

## How it is read

YOLOX-tiny, Apache-2.0, COCO. Six classes are kept: car, truck, bus and
motorcycle as vehicles, person, and boat. The file is 20 MB, fetched and
hash-checked at build time by `scripts/fetch_model.py` rather than carried in
the repository; a changed file at that URL fails the build.

**The first model here was MobileNet-SSD on VOC, and VOC has no truck class.** A
pickup standing in the lot was invisible to it by construction, which is what
was in the frame it was finally tested against: nothing over 0.10 in the tile
holding the truck, and the red car beside it called an aeroplane at 0.53. The
same two vehicles come back as vehicles under YOLOX.

Handing the whole frame to a 416×416 model shrinks everything past finding — it
returned the boats and none of the cars — so the frame is walked in 416-pixel
tiles at their own scale with a quarter of a tile of overlap. Eight tiles for a
1280×720 frame, about eight hundred milliseconds. The last row and column are
pinned flush to the far edge: stepping by the stride alone left the bottom 120
pixels and the right 80 unscanned, which is the near field of the car park.
Boxes of the same kind that cover each other by more than a third are one thing
found twice.

It still under-counts, and every reading carries its confidence range so the
readout can be read for what it is. At this range a person is twenty pixels tall
and near the edge of what the model will call one.

## When it is read

Only while a browser has the detailed marina open, and never otherwise.

The browser sends `{"type":"watching","area":"marina"}` on its own message type
and repeats it every thirty seconds while the area is up. The server holds that
per socket and forgets it after seventy-five seconds. This is deliberately not
part of the position message: a position goes out to every other browser on the
site, and what somebody is looking at stays on the server's side of the socket.

With nobody looking the feed reads `idle`, which is not a fault and is not drawn
as one.

## What leaves the server

Counts, and where in the frame they stood — the lower third is the lot, the rest
is water. No frame is stored, nothing is written to disk, and no world position
is claimed, because the camera has never been calibrated. A count is not a
survey.

## What the page draws

The car park is traced off the county 2022 aerial: 57.1 m long between the two
corners in `marina-lot.js`, 18.4 m across both rows and the aisle, twenty
stalls. Read off a photograph, not surveyed.

The cars are drawn in the first stalls in order. **Which stall a car is in is not
known and is not claimed** — the picture shows a number in the place the number
came from. The people stand at the head of the ramp for the same reason.

Nothing is drawn unless the camera is being read: no feed, nobody looking, a
failed fetch and a genuinely empty lot all draw the same empty car park, and the
readout in the top-left panel is what tells the three apart — counts when live,
`idle` when nobody is looking, `camera unread` when it broke.

## Checking it

```bash
python server/test_marina.py
node src/scene/test-marina-lot.mjs
```

The first covers the gate, the merge, and every way the read can fail. The
second covers the lot's shape, that every car stands inside it, and that a
count of zero, a broken camera and no feed at all draw the same thing.
