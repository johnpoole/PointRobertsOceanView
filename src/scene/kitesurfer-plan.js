// Appearance and motion are an assumed cast schedule, not a live observation.
export const KITE_SURFER = Object.freeze({
  role: 'the kite surfer',
  // Offshore of the reference photograph's GPS: 48.984536, -123.083631.
  lat: 48.9852, lon: -123.0875,
  minWindMps: 7.7, windowSeconds: 2700, sessionSeconds: 600,
  runPeriodSeconds: 160, northSouthRadiusM: 140, offshoreRadiusM: 24,
});

export function kiteSurferState(now, conditions = {}) {
  const time=+now, rise=+conditions.sunrise, set=+conditions.sunset;
  if (!Number.isFinite(time) || conditions.sunrise == null || conditions.sunset == null
      || !Number.isFinite(rise) || !Number.isFinite(set) || time<rise || time>=set
      || !Number.isFinite(conditions.windSpeedMps) || conditions.windSpeedMps<KITE_SURFER.minWindMps
      || !Number.isFinite(conditions.waterLevel)) return null;
  const seconds=time/1000, slot=Math.floor(seconds/KITE_SURFER.windowSeconds);
  // Stable across reloads, machines, clock scrubbing and frame rates. Most of
  // an otherwise suitable day is empty water, not a permanently looping rider.
  let seed=Math.imul(slot^(slot>>>16),0x45d9f3b);
  seed=Math.imul(seed^(seed>>>16),0x45d9f3b);
  seed=(seed^(seed>>>16))>>>0;
  if (seed%5>=3) return null;
  const start=slot*KITE_SURFER.windowSeconds+240+(seed%600);
  const elapsed=seconds-start;
  if(elapsed<0 || elapsed>=KITE_SURFER.sessionSeconds) return null;
  const phase=elapsed*Math.PI*2/KITE_SURFER.runPeriodSeconds;
  const east=KITE_SURFER.offshoreRadiusM*Math.cos(phase);
  const south=KITE_SURFER.northSouthRadiusM*Math.sin(phase);
  const vx=-KITE_SURFER.offshoreRadiusM*Math.sin(phase), vz=KITE_SURFER.northSouthRadiusM*Math.cos(phase);
  return { east, south, heading:Math.atan2(vx,vz), elapsed, phase,
    // Meteorological bearing is where wind comes FROM. Kite trails downwind.
    downwind:(Number.isFinite(conditions.windDirectionDegrees)?conditions.windDirectionDegrees:270)+180 };
}
