"""Where Point Roberts is, for anything that has to keep to it.

The feeds read here cover more than the point. PulsePoint carries the whole of
Whatcom County, Reddit and Nextdoor posts name places across the line in
Tsawwassen, and OSM has roads on both sides of it. What goes on the map is
what is on the peninsula.

The line is the 49th parallel as it is surveyed here, and it runs between the
two border stations: the US station's north wall is at 49.00156 and the
Canadian station's south wall at 49.00217 (src/scene/border-plan.js and
src/scene/boundary-bay.js). The water bounds the rest, with room for the docks
and the flats off the shore.
"""

from __future__ import annotations

NORTH = 49.0020     # the line
SOUTH = 48.965      # off Lighthouse Marine Park, past the marina breakwater
WEST = -123.098     # off the west bluff
EAST = -123.020     # off Lily Point


def in_point_roberts(lat: float, lon: float) -> bool:
    return SOUTH <= lat < NORTH and WEST <= lon <= EAST
