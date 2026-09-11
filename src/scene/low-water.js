// The novel's route through the peninsula, and what happens at each stop.
//
// The novel is in novel/low-water.html. This is the staging: seven places, in
// the order the book visits them, each with the hour its scene is set at, the
// tide it is set at, and the people who move through it. The page winds the sun
// to the hour and holds the sea at the level, so the light and the water are the
// ones the scene needs and the figures act the rest out. There are no captions.
// If a chapter cannot be read off the model then the staging is wrong and the
// answer is to fix the staging.
//
// Every place is real and comes off the terrain or the plan modules. The border
// positions are metres in the station's own frame, turned into lat and lon here
// so everything downstream sees one kind of coordinate.
//
// The hours are February hours, which is when the book is set. But an hour is
// not a light. Twenty to six is dark in February and a bright afternoon in June,
// and a scene written for a torch has to be dark whoever looks at it and
// whenever. So each chapter also carries the sun it was written under — the
// elevation in degrees on 12 February at that hour, and which side of noon it
// is on — and the page finds the minute today when the sun is there.
//
// hour stays because it is the book's, and because it is what the scene is.
//
// tide is metres MLLW, and null means leave the sea wherever it really is now.
// The two flat scenes name their tide because the whole story is that bottom
// drying, and a chapter that cannot show it shows nothing.

import { toWorld, fromWorld } from "../geo.js";
import { borderPoint } from "./border-plan.js";

// A point in the border station's own frame, as lat and lon.
function station(x, z) {
  const w = borderPoint(x, z);
  const g = fromWorld(w.x, w.z);
  return [g.lat, g.lon];
}

// The inbound lane, from a long way back in Canada through the booth and away
// south into the point. x = 3.4 is the lane the west gate arm stands over.
const LANE = (z) => station(3.4, z);
const BOOTH = station(6.2, 3.4);
const DOOR = station(21.0, -1.0);
const APRON = station(13.0, 1.0);

// The marina floats. The walk is the last thirty metres of D dock, because a
// figure covering the whole ninety at a walking pace is a scene forty seconds
// long and nothing else happens in it.
const FLOAT_MID = [48.977079, -123.064080];
const FLOAT_END = [48.976872, -123.063881];
const SLOOP = [48.976850, -123.063950];
// Up off the dock to the office door.
const PIER = [48.977240, -123.063620];
const OFFICE = [48.977092, -123.063342];

// The survey line off the drop-off south-west of the lighthouse. The bottom
// under it runs from five metres to seven, which is water a boat can work, and
// the boat covers it at two metres a second, which is survey speed.
const SURVEY = [[48.973300, -123.085700], [48.973650, -123.085900]];

// The bank top at Lily Point, above the old cannery beach.
const BANK = [[48.981500, -123.027600], [48.981610, -123.027470],
              [48.981720, -123.027340]];

// Boundary Bay off Maple Beach. The bottom here stands between five centimetres
// above MLLW and twenty below, so a tide half a metre under it leaves the whole
// flat dry, and the 49th parallel runs across the middle of this walk. That is
// the book's mechanism and it is in the terrain, not in a caption.
const CROSS_FROM = [49.000060, -123.025100];   // Canada
const CROSS_TO = [48.999950, -123.025480];     // United States
const WAITING = [[48.999900, -123.025900], [48.999870, -123.026000]];

// t is seconds into the scene. An actor is on the screen between its first key
// and its last and nowhere else, so walking off the end of a path and walking
// in through a door are the same thing said two ways.
//
// on says what holds them up: the terrain, the floating docks, or the sea.
export const CHAPTERS = [
  {
    n: 1, title: "The border station",
    hour: 16.2, sun: 10.3, west: true, tide: null, dwell: 26,
    eye: [49.001930, -123.068455, 53.4],
    aim: [49.001420, -123.068515, 52.0],
    actors: [
      // Eleven minutes in an empty lane. She has been sitting there a while
      // when the scene opens and he is still inside with her passport.
      { mode: "car", on: "ground", keys: [
        [0, ...LANE(3.4)], [16, ...LANE(3.4)],
        [21, ...LANE(20)], [26, ...LANE(80)],
      ] },
      { mode: "walk", on: "ground", keys: [
        [2, ...DOOR], [8, ...APRON], [14, ...BOOTH], [26, ...BOOTH],
      ] },
    ],
  },
  {
    n: 2, title: "D dock",
    hour: 8.5, sun: 8.7, west: false, tide: null, dwell: 26,
    eye: [48.977300, -123.063420, 13.0],
    aim: [48.976900, -123.063960, 1.5],
    actors: [
      { mode: "sloop", on: "water", keys: [[0, ...SLOOP], [26, ...SLOOP]] },
      // Down the float to the far end, and that is the hire.
      { mode: "walk", on: "float", keys: [
        [1, ...FLOAT_MID], [22, ...FLOAT_END], [26, ...FLOAT_END],
      ] },
      // And him, standing by his own boat the whole time, which is what he was
      // doing when she found the marina in the dark the night before.
      { mode: "walk", on: "float", keys: [[0, ...FLOAT_END], [26, ...FLOAT_END]] },
    ],
  },
  {
    n: 3, title: "The flats off the lighthouse",
    hour: 11.0, sun: 24.6, west: false, tide: 0.4, dwell: 24,
    eye: [48.973560, -123.084850, 22.0],
    aim: [48.973480, -123.085800, 0.0],
    actors: [
      { mode: "boat", on: "water", keys: [
        [0, ...SURVEY[0]], [22, ...SURVEY[1]], [24, ...SURVEY[1]],
      ] },
    ],
  },
  {
    n: 4, title: "Lily Point",
    hour: 17.7, sun: -3.0, west: true, tide: null, dwell: 26,
    eye: [48.981640, -123.026960, 69.0],
    aim: [48.981660, -123.027390, 64.5],
    actors: [
      // Dark by now. He walks her out along the bank and stops at the edge of
      // it, and the torch is the only reason there is anything to see.
      { mode: "walk", on: "ground", lamp: true, keys: [
        [0, ...BANK[0]], [12, ...BANK[1]], [24, ...BANK[2]], [26, ...BANK[2]],
      ] },
      { mode: "walk", on: "ground", keys: [
        [1, BANK[0][0] + 0.00003, BANK[0][1] + 0.00003],
        [13, BANK[1][0] + 0.00003, BANK[1][1] + 0.00003],
        [25, BANK[2][0] + 0.00003, BANK[2][1] + 0.00003],
        [26, BANK[2][0] + 0.00003, BANK[2][1] + 0.00003],
      ] },
    ],
  },
  {
    n: 5, title: "The marina office",
    hour: 11.5, sun: 26.3, west: false, tide: null, dwell: 24,
    eye: [48.977000, -123.062960, 13.0],
    aim: [48.977150, -123.063490, 6.0],
    actors: [
      // Up from the dock to the office, and in. The door is where they stop
      // being on the screen.
      { mode: "walk", on: "ground", keys: [[0, ...PIER], [20, ...OFFICE]] },
      { mode: "walk", on: "ground", keys: [
        [1, PIER[0] + 0.00003, PIER[1] - 0.00003],
        [21, OFFICE[0] + 0.00003, OFFICE[1] - 0.00003],
      ] },
    ],
  },
  {
    n: 6, title: "Maple Beach",
    // The book has this at twenty past three, which is forty degrees under the
    // horizon and a black screen. A big ebb an hour before first light is the
    // same tide out of the same series, and four degrees under leaves a flat to
    // see them standing on.
    hour: 3.3, sun: -4.0, west: false, tide: -0.5, dwell: 28,
    eye: [48.999790, -123.026250, 3.5],
    aim: [48.999980, -123.025450, -0.2],
    actors: [
      // The two of them standing on dry bottom on the American side of the
      // line, and the light coming down the flat out of Canada toward them.
      // They have a light of their own: nobody stands on a tidal flat in the
      // dark without one, and without it there is nobody there to see.
      { mode: "walk", on: "ground", lamp: true,
        keys: [[0, ...WAITING[0]], [28, ...WAITING[0]]] },
      { mode: "walk", on: "ground", keys: [[0, ...WAITING[1]], [28, ...WAITING[1]]] },
      { mode: "walk", on: "ground", lamp: true, keys: [
        [0, ...CROSS_FROM], [25, ...CROSS_TO], [28, ...CROSS_TO],
      ] },
    ],
  },
  {
    n: 7, title: "The border station, opening",
    hour: 8.5, sun: 8.7, west: false, tide: null, dwell: 24,
    eye: [49.000982, -123.068523, 54.5],
    aim: [49.001330, -123.068455, 52.5],
    actors: [
      // Half eight and the station open. She comes back up the lane, and this
      // time she is the one who gets out and goes inside.
      { mode: "car", on: "ground", keys: [
        [0, ...LANE(-40)], [6, ...LANE(-14)], [10, ...LANE(3.4)],
        [24, ...LANE(3.4)],
      ] },
      { mode: "walk", on: "ground", keys: [[0, ...BOOTH], [24, ...BOOTH]] },
      { mode: "walk", on: "ground", keys: [
        [12, ...LANE(3.4)], [18, ...APRON], [24, ...DOOR],
      ] },
    ],
  },
];

// How long the camera takes to travel between one chapter and the next. The
// dwell is the chapter's own, because a scene lasts as long as its action does.
export const TRAVEL_S = 5;

export function chapterPoints(chapter) {
  return {
    eye: toWorld(chapter.eye[0], chapter.eye[1], chapter.eye[2]),
    aim: toWorld(chapter.aim[0], chapter.aim[1], chapter.aim[2]),
  };
}
