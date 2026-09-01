// The sky dome: the Preetham daylight model on a large back-faced sphere, with
// the sun's own disk drawn on top of it. The horizon colour is exposed so the
// fog can match it and the ocean fades into the sky.
//
// The model needs one number for the state of the air and one for the sun, and
// both come from outside: turbidity out of the weather feed's aerosol reading,
// the sun's elevation out of the clock. Everything else is in skylight.js, which
// works out the per-frame constants once on the processor and hands them here as
// uniforms. The shader below evaluates the Perez function and nothing more, so
// there is only the one copy of the difficult arithmetic and the test can reach
// it.
//
// The tone map and the sRGB encode are inside this shader rather than on the
// renderer. Turning tone mapping on for the whole scene would move every colour
// in it, and the water was matched against a photograph by eye.

import * as THREE from "three";
import { HALO_POWER, HALO_STRENGTH, NIGHT_SKY, SUN_COS_INNER, SUN_COS_OUTER, skyColour, skyState } from "./skylight.js";

const RADIUS = 26000;

// Clean coastal air, which is where this sits when the feed has said nothing
// yet. An aerosol depth of about 0.15.
const DEFAULT_TURBIDITY = 2.5;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uPA: { value: new THREE.Vector3() },
      uPB: { value: new THREE.Vector3() },
      uPC: { value: new THREE.Vector3() },
      uPD: { value: new THREE.Vector3() },
      uPE: { value: new THREE.Vector3() },
      uZenith: { value: new THREE.Vector3() },
      uNorm: { value: new THREE.Vector3(1, 1, 1) },
      uSunTint: { value: new THREE.Vector3(1, 1, 1) },
      // Where the sun really is, for its disk, and where the model is allowed to
      // think it is, which is never below the horizon.
      uSunDir: { value: new THREE.Vector3(-0.7, 0.35, 0.2).normalize() },
      uSunSky: { value: new THREE.Vector3(-0.7, 0.35, 0.2).normalize() },
      uExposure: { value: 0.1 },
      uTwilight: { value: 1 },
      uCloud: { value: 0.1 },
      uHigh: { value: 0 },
      // Where the cloud is going, m/s in world x,z, and the scene clock in
      // seconds, so a deck drifts and the sun slider carries it along.
      uWind: { value: new THREE.Vector2(0, 1) },
      uTime: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      // The logdepthbuf chunks are what a built-in material gets for free and a
      // shader written out by hand does not. Without them the dome tests its
      // depth against a buffer written the other way and paints over the far
      // islands. common is in for isPerspectiveMatrix, which the chunk calls.
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>
        varying vec3 vDir;
        uniform vec3 uPA, uPB, uPC, uPD, uPE;
        uniform vec3 uZenith, uNorm, uSunTint, uSunDir, uSunSky;
        uniform float uExposure, uTwilight, uCloud, uHigh, uTime;
        uniform vec2 uWind;

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
        const vec3 NIGHT = vec3(${NIGHT_SKY.join(", ")});
        const float SUN_COS_INNER = ${SUN_COS_INNER};
        const float SUN_COS_OUTER = ${SUN_COS_OUTER};
        const float HALO_POWER = ${HALO_POWER}.0;
        const float HALO_STRENGTH = ${HALO_STRENGTH};

        vec3 srgb(vec3 c) {
          c = clamp(c, 0.0, 1.0);
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
                     step(vec3(0.0031308), c));
        }

        // ---- cloud ----------------------------------------------------------
        //
        // Preetham is a clear-sky model. There is no cloud in it, and the sky
        // over this water is mostly not clear, so the cloud is drawn on top of
        // the model and the model underneath is left exactly as it was. That is
        // deliberate: the fog reads the same model off the processor, in
        // skylight.js, and the two must not drift apart. What the fog wants is
        // the sky a distant thing fades into, which is the average of it, and
        // that is what the grey-out already gives it.
        //
        // A deck is a shell at a height and not a flat sheet. A sheet runs to
        // infinity at the horizon and whatever is drawn on it turns to noise
        // there. A shell puts the horizon at about a hundred and sixty
        // kilometres and packs the bands the way the eye sees them stacked.
        //
        // Overhead the deck is fifteen hundred metres off and at the horizon it
        // is a hundred and sixty kilometres off. No one cell size serves both.
        // See cfbm.
        //
        // The banding needs no help from the wind: the deck is seen at a
        // grazing angle, so a cell thirty kilometres out is already ten times
        // wider than it is tall. What the wind adds is slight.
        const float EARTH_R = 6371000.0;

        float chash(vec2 p) {
          p = fract(p * vec2(127.31, 311.7));
          p += dot(p, p.yx + 41.73);
          return fract(p.x * p.y * 2.17);
        }

        float cnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(chash(i), chash(i + vec2(1.0, 0.0)), f.x),
                     mix(chash(i + vec2(0.0, 1.0)), chash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        // A cell is worth drawing only in a window of range, and the window
        // moves with the size of the cell. Below it the cell is too small to
        // stand on the sky: the deck is seen at a grazing angle, so a cell of
        // size L at range t under a deck h metres up stands only L*h/t*t high,
        // and past a point that is sparkle and not cloud. Above it the cell is
        // so big that everything in view sits inside one of them, and a whole
        // sky the colour of one lattice value is a stain.
        //
        // Both ends matter and getting only the first was the mistake. Overhead
        // the shell is fifteen hundred metres off and the piece of it in view is
        // a few kilometres across, so a cell of sixty kilometres is one cell,
        // and the zenith came out flat and empty. At the horizon the shell is a
        // hundred and sixty kilometres off and a cell of five hundred metres is
        // a hairline, and the horizon came out combed.
        //
        // So the octaves run from a very coarse cell down to a fine one and each
        // is cut at both ends. Two or three survive at any range: the fine ones
        // overhead, the coarse ones out at the horizon, and the weights are
        // divided back out so the mean stays at a half and a threshold means the
        // same amount of cover everywhere.
        float cfbm(vec2 world, float coarsest, float h, float t) {
          float v = 0.0, norm = 0.0, cell = coarsest;
          for (int i = 0; i < 8; i++) {
            float stands = smoothstep(0.0012, 0.005, cell * h / (t * t));
            float fits = smoothstep(2.0, 0.6, cell / t);
            float w = stands * fits;
            v += cnoise(world / cell) * w;
            norm += w;
            cell *= 0.5;
          }
          return norm > 0.0 ? v / norm : 0.5;
        }

        // The threshold on the field that leaves a given fraction of the sky
        // covered.
        //
        // Measured, not reasoned about: the field is a weighted sum of whichever
        // octaves survived, and what that comes out looking like was guessed at
        // four times and got wrong four times. It is a bell with its middle at
        // 0.465 and eight hundredths of width to it, so almost all of it lies
        // between a third and six tenths, and a threshold anywhere outside that
        // is either a clear sky or a shut one. See test-cloud.mjs, which
        // measures it and holds this line to it.
        //
        // The curve through a bell is its own inverse and there is no closed
        // form for it, but a logit over 1.702 is one to three decimal places and
        // is one log. A straight line is not: it puts a quarter of the sky under
        // cloud when the feed says a tenth.
        float cover(float fraction) {
          float c = clamp(fraction, 0.005, 0.995);
          return 0.465 - 0.0476 * log(c / (1.0 - c));
        }

        // Where a ray leaves a shell h metres up: the world x,z of the point,
        // drifted downwind, and how far off it is. The sample runs upwind so the
        // cloud on it travels down.
        vec3 cloudAt(vec3 dir, float h, float speed) {
          float t = sqrt(EARTH_R * EARTH_R * dir.y * dir.y + 2.0 * EARTH_R * h + h * h)
                    - EARTH_R * dir.y;
          vec2 p = dir.xz * t - uWind * uTime * speed;
          return vec3(p, max(length(dir.xz * t), h));
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec3 dir = normalize(vDir);
          float cosG = clamp(dot(dir, uSunSky), -1.0, 1.0);
          float gamma = acos(cosG);
          float ct = max(dir.y, 0.01);   // the Perez function runs away below

          vec3 F = (1.0 + uPA * exp(uPB / ct))
                 * (1.0 + uPC * exp(uPD * gamma) + uPE * cosG * cosG);
          vec3 xyY = uZenith * F / uNorm;
          float x = xyY.y, y = xyY.z;

          // The colour at unit luminance, then the luminance on top of it.
          vec3 unit = y > 0.0
            ? mat3( 3.2406, -0.9689,  0.0557,
                   -1.5372,  1.8758, -0.2040,
                   -0.4986,  0.0415,  1.0570) * vec3(x / y, 1.0, (1.0 - x - y) / y)
            : vec3(0.0);

          // The light lighting the low sky near the sun came the long way in and
          // was reddened on the way. Preetham's chromaticity fit leaves that
          // out. Round the far side of the sky it did not come that way and
          // must not be reddened, or a sunrise lands on the western horizon.
          // To the fourth, the same as REDDEN_FALLOFF in skylight.js. Straight,
          // the western half of the sky came out orange to the top of the frame.
          float low = pow(1.0 - smoothstep(0.0, 0.5, max(dir.y, 0.0)), 2.0);
          float near = pow((1.0 + cosG) * 0.5, 2.0);
          vec3 red = 1.0 + (uSunTint - 1.0) * low * near;
          vec3 rgb = max(unit, 0.0) * xyY.x * uExposure * red;

          // Cloud scatters every wavelength alike: the same sky with the colour
          // taken out of it and a little of the light with it.
          rgb = mix(rgb, vec3(dot(rgb, LUMA) * 0.85), uCloud);

          // High cloud stands above the shadow line and is lit from beneath.
          rgb = mix(rgb, rgb * uSunTint * 1.7, uHigh * clamp(dir.y / 0.4, 0.0, 1.0));

          // Reinhard on the luminance alone. Squeezing each channel on its own
          // turns every bright sky white, and the sky beside a setting sun is
          // the brightest thing in the frame and the least white.
          float lum = dot(rgb, LUMA);
          rgb = lum > 0.0 ? clamp(rgb * ((lum / (1.0 + lum)) / lum), 0.0, 1.0) : vec3(0.0);
          // Thin high cloud first, because it is further off and the deck
          // stands in front of it. Both are drawn out along the wind, which is
          // what makes a sky read as bands rather than as spots.
          float deckA = 0.0;
          if (dir.y > 0.001) {
            vec2 w = length(uWind) > 0.05 ? normalize(uWind) : vec2(0.0, 1.0);
            mat2 W = mat2(w.y, -w.x, w.x, w.y);
            // How near the sun this patch is. The warm half of an evening sky
            // runs a long way round from the sun, so this is a wide falloff and
            // not a tight one.
            float toSun = pow(max(cosG, 0.0), 2.0);

            if (uHigh > 0.01) {
              vec3 q = cloudAt(dir, 9000.0, 2.2);
              // Squashed downwind, so a cell is drawn out along the wind rather
              // than round. The cell size below is across it.
              float n = cfbm(W * q.xy * vec2(1.0, 0.7), 64000.0, 9000.0, q.z);
              float thr = cover(uHigh);
              float a = smoothstep(thr, thr + 0.08, n);
              // Short. The field is a bell three tenths of the way wide, so a
              // long ramp here never reaches the far end of it and every cloud
              // comes out all rim and no body: pale wisps on a pale sky.
              float thick = clamp((n - thr) / 0.10, 0.0, 1.0);
              // Ice, and standing above the shadow line, so it is lit from
              // beneath and holds the last of the sun after everything under it
              // has gone grey. Thin at the edge and banked in the middle, the
              // same as any other cloud: white cloud on a white sky is nothing
              // at all, and the layers on an evening like this one are dark
              // bodies with the light coming round them.
              vec3 rim = mix(vec3(0.96, 0.96, 0.97), min(uSunTint * 2.2, vec3(1.0)), toSun);
              vec3 body = mix(vec3(0.34, 0.37, 0.45), uSunTint * 0.55, toSun);
              rgb = mix(rgb, mix(rim, body, thick), a);
            }

            if (uCloud > 0.01) {
              vec3 q = cloudAt(dir, 1500.0, 1.0);
              float n = cfbm(W * q.xy * vec2(1.0, 0.7), 32000.0, 1500.0, q.z);
              float thr = cover(uCloud);
              deckA = smoothstep(thr, thr + 0.09, n);
              // We stand under it, so what shows is the base. The thin rim
              // passes the light through and the thick middle does not, and
              // near a low sun the rim is the colour of the sun and not white.
              float thick = clamp((n - thr) / 0.10, 0.0, 1.0);
              vec3 rim = mix(vec3(0.93, 0.94, 0.96), min(uSunTint * 1.8, vec3(1.0)), toSun);
              vec3 base = mix(vec3(0.24, 0.27, 0.33), uSunTint * 0.42, toSun);
              rgb = mix(rgb, mix(rim, base, thick), deckA);
            }
          }

          // The night shows through where the day sky has gone, not over the
          // top of what is still lit.
          rgb = rgb * uTwilight + NIGHT * (1.0 - uTwilight) * (1.0 - rgb);

          // The sun's disk and its halo, in the colour the air has left it, and
          // no wider than that. Preetham already brightens the sky toward the
          // sun; a glow laid over the top of that is what turned the whole
          // western sky yellow.
          float s = max(dot(dir, uSunDir), 0.0);
          float sun = smoothstep(SUN_COS_OUTER, SUN_COS_INNER, s) + pow(s, HALO_POWER) * HALO_STRENGTH;
          // Behind the cloud that is actually drawn in front of it, and not
          // behind a fraction of the whole sky's cover. A hole in an overcast
          // lets the sun through at full strength, which is what an evening
          // like the one on the camera mostly is.
          rgb += uSunTint * sun * (1.0 - deckA) * uTwilight;

          gl_FragColor = vec4(srgb(rgb), 1.0);
        }`,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 16), mat);
    scene.add(mesh);
    this.mesh = mesh;

    this._turbidity = DEFAULT_TURBIDITY;
    this._elevationDeg = 20;
    this._sunDir = [0, 0.34, -0.94];
    this._scratch = new THREE.Color();
    this._rebuild();
  }

  // dir points at the sun; elevationDeg is its height above the horizon and goes
  // negative after it sets.
  setSun(dir, elevationDeg) {
    this.uniforms.uSunDir.value.copy(dir).normalize();
    this._elevationDeg = elevationDeg;
    this._sunDir = [dir.x, dir.y, dir.z];
    this._rebuild();
  }

  // turbidity from the aerosol reading, or null to leave it where it was. cloud
  // is the low and middle cover that lids the sky, 0..1; high is the thin cloud
  // above it.
  setAir(turbidity, cloud, high) {
    if (turbidity != null) this._turbidity = turbidity;
    if (cloud != null) this.uniforms.uCloud.value = Math.max(0, Math.min(cloud, 1));
    if (high != null) this.uniforms.uHigh.value = Math.max(0, Math.min(high, 1));
    this._rebuild();
  }

  // Where the cloud is going and how fast. The feed says where the wind comes
  // from, which is the other way round.
  setWind(fromDeg, speedMps) {
    if (fromDeg == null || speedMps == null) return;
    const toward = (fromDeg + 180) * Math.PI / 180;
    this.uniforms.uWind.value
      .set(Math.sin(toward), -Math.cos(toward))
      .multiplyScalar(Math.max(speedMps, 0));
  }

  // Seconds. Not the wall clock: a uniform is a 32-bit float and the epoch in
  // seconds resolves to about two minutes in one, which would hold the cloud
  // still. This is the scene's own elapsed time plus the slider's offset.
  setTime(seconds) {
    this.uniforms.uTime.value = seconds;
  }

  _rebuild() {
    const st = skyState(this._turbidity, this._elevationDeg);
    this.state = st;
    const u = this.uniforms;
    for (const [name, key] of [["uPA", "A"], ["uPB", "B"], ["uPC", "C"], ["uPD", "D"], ["uPE", "E"]]) {
      u[name].value.fromArray(st.perez[key]);
    }
    u.uZenith.value.fromArray(st.zenith);
    u.uNorm.value.fromArray(st.norm);
    u.uSunTint.value.fromArray(st.sun);
    u.uExposure.value = st.exposure;
    u.uTwilight.value = st.twilight;

    // The model is not allowed a sun below the horizon, so it is held there and
    // twilight takes the sky down from then on.
    const d = this._sunDir;
    const flat = Math.hypot(d[0], d[2]) || 1;
    this._sunSky = d[1] >= 0 ? d : [d[0] / flat, 0, d[2] / flat];
    u.uSunSky.value.fromArray(this._sunSky);
  }

  // The sky at the horizon in the given world direction, which is what the fog
  // has to match for the sea to run into it without a seam. Looking west into a
  // sunset that is orange and looking east it is not, so the direction matters.
  horizonColor(dir) {
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const [r, g, b] = skyColour(
      this.state, [dir.x / flat * 0.999, 0.035, dir.z / flat * 0.999], this._sunSky,
      { cloud: this.uniforms.uCloud.value, high: this.uniforms.uHigh.value });
    return this._scratch.setRGB(r, g, b, THREE.SRGBColorSpace);
  }
}
