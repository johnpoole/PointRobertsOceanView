// The novel's route through the peninsula: where each chapter of Low Water
// stands, and the hour it stands there.
//
// The novel is in novel/low-water.html. This is only the camera: seven places,
// in the order the book visits them, each with the hour its scene is set at, so
// the page can wind the sun to it. What the water does at that hour is whatever
// the tide is really doing at that hour — the scene is not staged and the feed
// is not overridden.
//
// Every place is real and already in the model. Nothing here draws anything.

import { toWorld } from "../geo.js";

// eye and aim are lat, lon and metres above MLLW. hour is the scene's own hour
// on the peninsula's clock.
export const CHAPTERS = [
  {
    n: 1, title: "The border station",
    hour: 16.2,
    eye: [49.001930, -123.068460, 53.4],
    aim: [49.001300, -123.068400, 54.0],
    line: "Eleven minutes in an empty lane, and the light going all at once.",
  },
  {
    n: 2, title: "D dock",
    hour: 8.5,
    eye: [48.977700, -123.062900, 12.0],
    aim: [48.977050, -123.064200, 4.0],
    line: "Three hundred halyards on aluminium, out of time with each other.",
  },
  {
    n: 3, title: "The flats off the lighthouse",
    hour: 11.0,
    eye: [48.973400, -123.079600, 18.0],
    aim: [48.972500, -123.084500, 1.0],
    line: "A line of bottom harder than it should be, running north-west.",
  },
  {
    n: 4, title: "Lily Point",
    hour: 17.7,
    eye: [48.981900, -123.028900, 34.0],
    aim: [48.981300, -123.025400, 6.0],
    line: "What he saw in November, and was laughed at for.",
  },
  {
    n: 5, title: "The marina office",
    hour: 11.5,
    eye: [48.977500, -123.064100, 14.0],
    aim: [48.977092, -123.063342, 7.0],
    line: "Cash for a slip they use four nights a month, and the nights are in the table.",
  },
  {
    n: 6, title: "Maple Beach",
    hour: 3.3,
    eye: [48.999300, -123.029800, 14.0],
    aim: [48.999600, -123.026300, 1.0],
    line: "The lowest water of the series, and the wrong side of the line.",
  },
  {
    n: 7, title: "The border station, opening",
    hour: 8.5,
    eye: [49.001500, -123.069400, 56.0],
    aim: [49.001280, -123.068400, 53.0],
    line: "The nearest authority that can act is forty minutes away through another country.",
  },
];

// How long each chapter is held before the next, in seconds, and how long the
// camera takes to travel between them.
export const DWELL_S = 14;
export const TRAVEL_S = 5;

export function chapterPoints(chapter) {
  return {
    eye: toWorld(chapter.eye[0], chapter.eye[1], chapter.eye[2]),
    aim: toWorld(chapter.aim[0], chapter.aim[1], chapter.aim[2]),
  };
}
