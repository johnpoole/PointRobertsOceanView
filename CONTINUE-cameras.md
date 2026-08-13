# CONTINUE — the two cameras, and lining their pictures up with the render

Written 2026-08-13, at the end of a long session that got some of this right and
a lot of it wrong. Read the failures before repeating them.

## What this is for

Two Wyze Cam V3s look at the same ground the page renders. A frame from either
one can be thrown onto the terrain from where the camera stands, so the render
and the photograph can be held against each other and the render corrected.

That is the whole point: turning "it looks about right" into a number.

## What is in the page now

Press **C**. It takes whichever camera is looking most nearly the way you are —
facing the water, the one on the lower wall; facing the bank, the one on the
roof. The photograph goes onto the ground and the render's own trees come out.
**C** again flips the photograph off and on without moving anything else.
**N** moves to the other camera.

While a frame is up, **dragging moves the photograph**, not the view, and the
top of the screen shows which camera it is and where it is pointed. Those two
numbers are what to write back into `WYZE_CAMS` once a frame is lined up.

Everything is in `src/main.js` under `WYZE_CAMS`, and the projector itself is in
`src/scene/terrain.js`.

## The numbers, and how much to trust each

| | value | how it was got |
| --- | --- | --- |
| ocean view eye | 8.14 m MLLW | solved: the boulder 30 m out fixes height, the islands 30 km out fix aim |
| ocean view aim | 244.97°, 10.53° down | same solve |
| front door eye | 12.9 m MLLW | John's description, through the lidar roof in `cabin.js` |
| front door aim | 69°, level | John's arrows on a screenshot: seven of them, 197 px across, 12° |
| lens | 61° to the corner, 122° diagonal | fitted on the island skyline, 92 columns, a real minimum |
| tide, per frame | −0.56 and −0.21 m MLLW | NOAA, at the timestamp on each picture |

The lens is the only one of these with an honest error bar. The miss is 0.175°
at a 61° corner and rises either side — 0.182 at 60, 0.177 at 62, 0.201 at 64.
Wyze publish 130° for this camera and will not say whether that is measured
across or corner to corner. The 110 that was in the code for most of the day
came from nowhere defensible.

## The thing that is still wrong

**The boulder and the islands disagree by 4.25° of heading, and the lens is not
the reason.** Fitted separately at a range of lens angles:

```
corner   rock heading   island heading   apart
   55°       -115.00°         -110.75°    4.25°
   60°       -116.50°         -112.25°    4.25°
   65°       -117.75°         -112.25°    5.50°
   70°       -119.25°         -115.00°    4.25°
```

Both move together as the lens widens, which is what a lens error does. Their
difference does not close. So something that acts differently on near and far is
wrong: the camera height, or the boulder's position out of the lidar bake, or
where its foot was read in the frame.

The render currently carries the boulder's answer. The islands are therefore
about four degrees out.

## What was tried and did not work

Do not spend another morning on these.

- **Straightening the handrails.** Traced four straight edges and fitted a radial
  model to make them straight. Bow fell from 69 to 55 parts per thousand and slid
  toward ever wider angles with no minimum. The bow is mostly the tracer
  wandering along a weathered rail through grass, not the lens.
- **Fitting the lens with the boulder and the skyline together.** Ran to 178° on
  the diagonal with 29 px still unaccounted for. Two landmarks nearly above one
  another cannot pin three unknowns.
- **Fitting on the measured trees.** Those are crown apexes, not trunks — see
  below. Gave 57° for the front door, which was wrong by 12.
- **Correlating the haze with distance.** John's observation is right: pale means
  far, and the tone along the skyline is a distance profile. Both attempts slid
  to a search boundary, the second after taking out the sun's gradient, which
  turned out not to be the problem. Something in the correlation is degenerate
  and I did not find it.
- **Two curves, skyline and waterline.** Meant to free the lens. Only 90 of 1920
  columns carry both, and they sit tens of pixels apart, so they are effectively
  one curve. Ran to the opposite boundary, 70°.

## What is worth trying next

- **Sizing, not just dragging.** The drag assumes only the aim is off. It needs
  to stretch the frame across and up as well — the corner angle for overall
  scale, the aspect for the difference between the two axes. Then a frame can be
  lined up by hand completely, and what comes out is a measurement of the lens.
- **Landmarks off the horizon.** Everything used so far sits in a narrow band
  near the skyline, which is why heading and lens keep trading against each
  other. Something well above or below at a known place would break it.
- **The height.** It is the most likely reason the rock and the islands disagree.

## Things to know before touching it

**The projection lands on the ground, and only on the ground.** Three tiles carry
the projector: the near one, the lidar tile over the lot, and the far islands. A
ray that leaves the top of the frame goes over the horizon and hits nothing, so
the top of a photograph disappears when it is shifted up. Anything standing off
the ground — a trunk, a shed wall — is painted where its ray meets the dirt
behind it, not where it is. That is why tree trunks are a poor thing to line up
on and why the boulder's *foot* was used rather than the boulder.

There is no depth test against the projector either, so ground the camera cannot
see is painted as though it could.

**The photograph goes on after the lighting**, not into the diffuse colour. A
noon frame put in before the light gets shaded by whatever the sun is doing now,
and in the evening that turns it black — which reads as the picture failing to
load.

**The sea is held at the tide the frame was taken on** while a camera is up, or
the water stands over a beach the picture shows dry.

**`389-trees.json` gives crown apexes, not trunks.** The asset says so. On a
leaning fir that is metres from the foot: fifteen degrees of error at six metres,
under two at sixty. Fine as landmarks far off, useless near.

**The terrain cannot hold the stair.** The lidar is 1.15 m cells and a tread is a
quarter of that, so what the heightmap runs through the steps is a smooth ramp.
At the grazing angles this camera looks along, a foot of height error slides
where a ray lands four to six metres along the ground — which is why the middle
of the stair drifts while both its ends look right. A stair was built from the
photograph and taken out again: eight of its nineteen steps stood proud and
eleven were buried, so what showed was a broken line pointing the wrong way. It
is in the history at `c4d36cb`. Cutting the ground away along the flight is what
that needs, and nobody has done it.

**Half a metre of lidar will not help.** The engineering repository's own bake
script does the arithmetic: 3.08 ground returns to the square metre, so at half a
metre most cells hold nothing. 1.15 m is the ceiling. There is a note about it at
`PointRobertsEngineering/site/NOTE-terrain-under-the-front-door-camera.md`.

## Getting a fresh frame

```
.venv/Scripts/python scripts/grab_camera_frame.py
.venv/Scripts/python scripts/grab_camera_frame.py --entity camera.front_door
```

Needs `HA_TOKEN` in `.env` — a long-lived token from the Home Assistant profile
page. These cameras give no still images at all, so the script drives a browser
through the WebRTC handshake and takes a frame off the stream. It prefers the
installed Chrome because Playwright's own Chromium has no H.264.

Frames land in `assets/reference/`. Get the tide for the timestamp from NOAA the
same way `fetch_tide` in `server/proxy.py` does — the Point Roberts prediction
with the Cherry Point surge added — and put it on the camera in `WYZE_CAMS`.

## Looking at the render without opening the browser pane

John closes the pane because it takes half his screen. Use headless Chrome
instead: load `http://192.168.1.90:8091/`, wait about twenty seconds for the
terrain, dispatch `keydown` events for C and N, and screenshot. WebGL wants
`--use-gl=angle --enable-unsafe-swiftshader`. The clock can be driven by setting
`#clock-range` and firing an `input` event, which is how to get daylight out of
an evening session.
