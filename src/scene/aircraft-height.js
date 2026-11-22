// What to call the height an aircraft is drawn at.
//
// Drawn from its GPS height it is a height above the water, and "altitude" is
// the word. Drawn from its altimeter it is a pressure, which is off by about
// 8 m for every hPa the day differs from standard, and the row says so.
//
// A record written before the source was kept has none, and those were all
// pressure altitudes.
export function altitudeLabel(state) {
  return state.altitude_source === "geometric" ? "altitude" : "pressure altitude";
}
