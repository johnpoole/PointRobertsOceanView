// Whether rain is drawn. It is drawn when rain is falling: any amount measured
// for the hour. The chance of rain is a forecast of this and is not it. At 80%
// most of the hour is dry, and a shower forecast at 40% falls all the same.
//
// No figure is not rain. The feed's "not supplied" draws nothing.
export function raining(state) {
  const mm = state.precipitation_mm;
  return mm != null && mm > 0;
}
