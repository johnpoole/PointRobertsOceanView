// Grain on a surface, and the shade of a hollow, added to a material that is
// otherwise three's standard one.
//
// The grain is one small square of generated stone (detail-texels.js) laid on
// at three sizes at once. It is thrown onto the surface from three sides —
// down, and across from the south and from the east — and each side counts for
// as much as the surface faces it, so a bluff face gets grain that runs down it
// instead of the ground's grain smeared out sideways. The method is Abyssal
// Garden's (github.com/Noniv/abyssal-garden, MIT).
//
// It changes two things and neither is the colour of the surface. It lightens
// and darkens about the colour already there, and it leans the surface a little
// so the sun catches it unevenly. With distance it blurs to its own mean, which
// is nothing, so anything far off is as it was.

import * as THREE from "three";
import { detailTexels, DETAIL_SIZE, HEIGHT_RMS } from "./detail-texels.js";

// Metres one repeat of the square covers, coarsest first. Chosen so that none
// is a whole multiple of another and the three never line up.
const TILE_M = [31, 5.3, 0.9];
// How much of the height each size carries. The finest is the least because it
// is the one that turns to noise first as you back away.
const SHARE = [0.45, 0.35, 0.20];
// What the three sizes come to together, as the usual distance from the mean.
// Dividing by it is what lets a depth be said as a share of the colour.
const USUAL = HEIGHT_RMS * Math.hypot(...SHARE);
// The finest size is let go between these distances, in metres: past the
// second a 0.9 m repeat is a few pixels and only crawls.
const FINE_FADE_M = [25, 70];
// And the lean of the surface is let go between these, for the same reason.
const LEAN_FADE_M = [150, 600];

let shared = null;
function detailMap() {
  if (shared) return shared;
  const map = new THREE.DataTexture(
    detailTexels(), DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  // Ground seen from a standing eye is seen at a low angle, and without this
  // the grain blurs away a few metres out.
  map.anisotropy = 4;
  map.needsUpdate = true;
  shared = { value: map };
  return shared;
}

const PARS_VERTEX = `
  varying vec3 vDetailPos;
  varying vec3 vDetailN;
`;

const POSITION_VERTEX = `
  vec4 detailAt = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    detailAt = instanceMatrix * detailAt;
  #endif
  vDetailPos = ( modelMatrix * detailAt ).xyz;
`;

// transformedNormal is in the camera's frame. Multiplying on the left by the
// view matrix turns it back into the world's.
const NORMAL_VERTEX = `
  vDetailN = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );
`;

const PARS_FRAGMENT = `
  uniform sampler2D detailMap;
  varying vec3 vDetailPos;
  varying vec3 vDetailN;

  struct DetailTap { float height; float mottle; vec3 lean; };

  // One size of the grain, from all three sides at once.
  DetailTap detailTap( vec3 p, vec3 w, float perM ) {
    vec4 x = texture2D( detailMap, p.zy * perM );
    vec4 y = texture2D( detailMap, p.xz * perM );
    vec4 z = texture2D( detailMap, p.xy * perM );
    DetailTap t;
    t.height = x.b * w.x + y.b * w.y + z.b * w.z;
    t.mottle = x.a * w.x + y.a * w.y + z.a * w.z;
    vec2 a = x.rg * 2.0 - 1.0;
    vec2 b = y.rg * 2.0 - 1.0;
    vec2 c = z.rg * 2.0 - 1.0;
    // A lean in the square is a lean along the two axes that side was thrown
    // along, and a surface leans away from the way it climbs.
    t.lean = -( vec3( 0.0, a.y, a.x ) * w.x + vec3( b.x, 0.0, b.y ) * w.y
              + vec3( c.x, c.y, 0.0 ) * w.z );
    return t;
  }
`;

// sand: the flat of the beach is left nearly even, which is what makes it read
// as sand. It needs the terrain's own vStony to know where that is.
function colourFragment(depth, sand) {
  return `
  vec3 detailW = pow( abs( normalize( vDetailN ) ), vec3( 4.0 ) );
  detailW /= ( detailW.x + detailW.y + detailW.z );
  float detailDist = length( vDetailPos - cameraPosition );
  float detailFine = 1.0 - smoothstep( ${FINE_FADE_M[0].toFixed(1)}, ${FINE_FADE_M[1].toFixed(1)}, detailDist );
  DetailTap detailA = detailTap( vDetailPos, detailW, ${(1 / TILE_M[0]).toFixed(6)} );
  DetailTap detailB = detailTap( vDetailPos, detailW, ${(1 / TILE_M[1]).toFixed(6)} );
  DetailTap detailC = detailTap( vDetailPos, detailW, ${(1 / TILE_M[2]).toFixed(6)} );
  float detailHeight = ( detailA.height - 0.5 ) * ${SHARE[0].toFixed(2)}
                     + ( detailB.height - 0.5 ) * ${SHARE[1].toFixed(2)}
                     + ( detailC.height - 0.5 ) * ${SHARE[2].toFixed(2)} * detailFine;
  float detailK = 1.0;
  ${sand ? `
  detailK = 1.0 - ${sand.even.toFixed(2)} * ( 1.0 - vStony )
          * ( 1.0 - smoothstep( ${sand.from.toFixed(1)}, ${sand.to.toFixed(1)}, vDetailPos.y ) );
  ` : ""}
  diffuseColor.rgb *= 1.0 + detailK * ( detailHeight * ${(depth / USUAL).toFixed(3)}
                    + ( detailA.mottle - 0.5 ) * ${depth.toFixed(3)} );
  `;
}

function leanFragment(lean) {
  return `
  {
    float keep = 1.0 - smoothstep( ${LEAN_FADE_M[0].toFixed(1)}, ${LEAN_FADE_M[1].toFixed(1)}, detailDist );
    vec3 leanWorld = ( detailA.lean * 0.5 + detailB.lean * 0.8 + detailC.lean * detailFine )
                   * ${lean.toFixed(3)} * detailK * keep;
    normal = normalize( normal + ( viewMatrix * vec4( leanWorld, 0.0 ) ).xyz );
  }
  `;
}

// material: a MeshStandardMaterial, whether or not something has already
// rewritten its shader. What was there runs first and this is added after.
//
// detail: { depth, lean, sand } or null. depth is how far the grain usually
//   moves the colour, as a share of it: 0.1 is a tenth lighter or darker. lean
//   is how far it tips the surface. sand is { even, from, to }:
//   how much of the grain to take off flat beach, and the heights in metres it
//   comes back in between. sand needs the geometry's `stony` attribute.
// open: true if the geometry carries the `open` attribute out of openness.js.
export function dressSurface(material, { detail = null, open = false } = {}) {
  if (!detail && !open) {
    throw new Error("dressSurface: asked for neither grain nor hollows, so there is nothing to add.");
  }
  const before = material.onBeforeCompile;
  const keyBefore = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    // Made here and not above, so the square is only ever built by a page that
    // is about to draw with it.
    if (detail) shader.uniforms.detailMap = detailMap();

    let vertex = shader.vertexShader;
    let fragment = shader.fragmentShader;
    const put = (source, anchor, text, what) => {
      if (!source.includes(anchor)) {
        throw new Error(
          `dressSurface: three's standard ${what} shader no longer has ${anchor} in it, ` +
          `so there is nowhere to put the grain. src/scene/detail.js needs a new anchor.`);
      }
      return source.replace(anchor, `${anchor}\n${text}`);
    };

    if (detail) {
      vertex = put(vertex, "#include <common>", PARS_VERTEX, "vertex");
      vertex = put(vertex, "#include <defaultnormal_vertex>", NORMAL_VERTEX, "vertex");
      vertex = put(vertex, "#include <begin_vertex>", POSITION_VERTEX, "vertex");
      fragment = put(fragment, "#include <common>", PARS_FRAGMENT, "fragment");
      fragment = put(fragment, "#include <color_fragment>",
        colourFragment(detail.depth, detail.sand), "fragment");
      fragment = put(fragment, "#include <normal_fragment_maps>",
        leanFragment(detail.lean), "fragment");
    }
    if (open) {
      vertex = put(vertex, "#include <common>",
        "attribute float open;\nvarying float vOpen;", "vertex");
      vertex = put(vertex, "#include <begin_vertex>", "vOpen = open;", "vertex");
      fragment = put(fragment, "#include <common>", "varying float vOpen;", "fragment");
      // Only what comes from the sky. The sun is not dimmed by a hollow, it is
      // either in it or it is not, and that is the shadow map's to say.
      fragment = put(fragment, "#include <lights_fragment_end>",
        "reflectedLight.indirectDiffuse *= vOpen;", "fragment");
    }
    shader.vertexShader = vertex;
    shader.fragmentShader = fragment;
  };

  const mark = `${detail ? `-grain${detail.depth}:${detail.lean}${detail.sand ? ":sand" : ""}` : ""}`
    + `${open ? "-open" : ""}`;
  material.customProgramCacheKey = () => keyBefore.call(material) + mark;
}
