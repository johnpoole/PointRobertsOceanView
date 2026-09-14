# Kite surfer references

Owner supplied `PXL_20260610_010833897.MP.jpg`,
`PXL_20260610_011421831.mp4` (16 seconds) and
`PXL_20260610_011500989.mp4` (71 seconds), also in `Photos-1-001.zip`.
The still and six evenly distributed frames from each video were inspected.
They establish the turquoise canopy with red edging and dark seams, dark
wetsuit, control lines, board and short runs offshore. No reference media is
loaded by the web app. Raw files, including the motion photo and archive, stay
local and ignored; all common video extensions are also ignored repository-wide.

The still's EXIF places the photographer at 48.984536, -123.083631 on
9 June 2026 at 18:08 local time. The modeled course is offshore to the west,
centred at 48.9852, -123.0875. The entire course clears the modeled seabed at
a low tide of -1 m MLLW. This is an approximate setting, not a recovered
GPS track or a live report of this person's whereabouts.

The cast member appears with **P**, only between calculated sunrise and sunset
and at wind speeds of at least **7.7 m/s (about 15 knots)**. Ten-minute sessions
occur in roughly three of every five seeded 45-minute windows. The schedule, wind
threshold, course and dimensions are modeling assumptions. Clock changes are
repeatable; forecasts outside their coverage and stale/missing live weather
produce no surfer. The board follows the ocean surface and is hidden on dry or
very shallow ground. The kite steers downwind; missing wind direction assumes west.

Implementation: `src/scene/kitesurfer*.js`; regression check:
`node src/scene/test-kitesurfer.mjs`. Tracked in GitHub issue #94.
