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

A drag turns the view as it does everywhere else, and the photograph stays on the
ground it was taken of.

**E** puts it in editing mode, and again takes it out. With nothing up it brings
a camera up too. While editing:

- a drag moves the photograph instead of the view
- the ground is thrown away and painted by height, half a metre to a band, so
  the shape under the picture can be seen. Sand and grass and shingle all read
  the same through a photograph laid over them
- **S** writes the aim out the way `WYZE_CAMS` wants it, as a lat/lon 300 m down
  the line of sight, and says whether the clipboard took it. Over plain http on
  the LAN there is no clipboard, so select it off the bar instead
- the bar across the top carries the numbers

Leaving editing mode leaves the photograph where it is. Only the tools go away.

A shift-drag used to stretch the frame as well, which is how the lens was
measured. It is out, because the lens is a number both cameras agree on. It is
in the history at `d8c0f74` if it is ever wanted back.

Everything is in `src/main.js` under `WYZE_CAMS`, and the projector itself is in
`src/scene/terrain.js`.

## The numbers, and how much to trust each

| | value | how it was got |
| --- | --- | --- |
| ocean view eye | 8.14 m MLLW | solved: the boulder 30 m out fixes height, the islands 30 km out fix aim |
| ocean view aim | 245.69°, 11.66° down | John, by hand, against the screen behind the islands |
| front door eye | 12.9 m MLLW | John's description, through the lidar roof in `cabin.js` |
| front door aim | 72.19°, 0.81° up | John, by hand, over the ground painted by height |
| lens | 60.26° to the corner, 1.5986 across | John, by hand, on the ocean view frame |
| tide, per frame | 1.82 and −0.21 m MLLW | NOAA, at the timestamp on each picture |

**The lens is measured now, and it holds on both cameras.** It was fitted by
hand on the beach frame and the bank frame then lined up without it being
touched, which is what says 1.5986 describes the glass rather than covering for
an error somewhere on the ocean view side. The corner barely moved from the 61
the skyline fit gave. The aspect did, from the frame's own 16:9, so the camera
does not work the same across as it does up:

| | across | up |
| --- | --- | --- |
| 61° corner, 16:9 | 106.3° | 59.8° |
| 60.26° corner, 1.5986 | 102.2° | 63.9° |

Every fit in the list below held the aspect at 16:9. That is why none of them
could close.

An aim is stored as a lat/lon 300 m down the line of sight, rounded to six
places, which costs a hundredth of a degree of heading. The bar reads back 245.68
and 71.95 rather than the 245.69 and 71.94 that were set.

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

The lens holding on the second camera closes one escape route: the aspect is not
absorbing an ocean view error, or it would not have worked on the bank. So the
height is what is left, and it is now the only thing between here and an answer.

Note also that the frame this was fitted against is gone. The ocean view camera
carries the high tide frame from the 13th, where the boulder is a cap above water
with its foot out of sight. The old low tide frame is still in
`assets/reference/` if the boulder is wanted again.

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
  below. Gave 57° for the front door, where the hand fit later said 71.94.
- **Arrows on a screenshot.** Seven marks pairing a trunk in the photograph with
  the same trunk in the render, 197 px across, called 12° and added to 57 to make
  69. The hand fit says 72.19, so it was under, and redoing the arithmetic
  through the measured lens sends it to 67.5, which is further under still. A
  trunk is painted where its ray meets the dirt behind it. Arrows between trunks
  cannot measure aim.
- **Lining the front door up without the bands.** Gave 11.28° up and it was ten
  degrees out. Pitch is the thing the eye cannot judge on a bank: photograph and
  render are both green up a slope and slide over one another without ever
  looking wrong. Nothing is learned from a hand fit on ground whose shape cannot
  be seen.
- **Correlating the haze with distance.** John's observation is right: pale means
  far, and the tone along the skyline is a distance profile. Both attempts slid
  to a search boundary, the second after taking out the sun's gradient, which
  turned out not to be the problem. Something in the correlation is degenerate
  and I did not find it.
- **Two curves, skyline and waterline.** Meant to free the lens. Only 90 of 1920
  columns carry both, and they sit tens of pixels apart, so they are effectively
  one curve. Ran to the opposite boundary, 70°.

## What is worth trying next

- **The height.** It is the only thing left holding the boulder and the islands
  four degrees apart. The lens is measured and the aims are set, so a sweep of
  the ocean view eye through a metre or two either side of 8.14 is now a
  one-variable search with everything else nailed down.
- **Landmarks off the horizon.** Everything used so far sits in a narrow band
  near the skyline, which is why heading and lens keep trading against each
  other. Something well above or below at a known place would break it.

## Things to know before touching it

**The projection lands on the ground, and on a screen behind everything.** Three
tiles carry the projector — the near one, the lidar tile over the lot, and the
far islands — and behind them all a sphere 120 km out with the camera at its
middle, which shows nothing except where the photograph falls on it. Every ray
hits the sphere, so the whole frame is somewhere; the ground and the islands
stand in front and cover their own parts, and what is left showing on it is the
part that used to land nowhere. That is what puts the photographed skyline on a
surface with the rendered skyline in front of it instead of a few pixels of edge
against edge.

Anything standing off the ground — a trunk, a shed wall — is still painted where
its ray meets the dirt behind it, not where it is. That is why tree trunks are a
poor thing to line up on and why the boulder's *foot* was used rather than the
boulder.

There is no depth test against the projector either, so ground the camera cannot
see is painted as though it could.

**The map view will not tip past level and the front door camera looks up.** Its
target stands above its eye, and `controls.update()` reads that as an illegal
angle and swings the view to a legal one — which drops you high over the cabin
looking somewhere else. `toWyzeCam` lifts `maxPolarAngle` while a camera is up
and `leaveWyze` puts it back. The projector never cared; only the viewpoint you
land at was wrong.

**A photograph reaches as far as its camera is given.** `range` on a camera in
`WYZE_CAMS`, in metres, or none at all. The front door has 100. Aimed 11° up it
sends most of its rays over the crest of the bank, and past the crest the ground
falls away and they graze on until they meet the far side of the strait.

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
