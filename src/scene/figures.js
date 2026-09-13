// The people on the peninsula.
//
// Xbot, the figure in three.js's additive blending example, with its walk clip.
// It is Mixamo's model, and Adobe's terms allow it to be used in a project but
// not redistributed as a raw file, so it is never copied into this repository.
// It loads at runtime off jsDelivr's mirror of the three.js repository, pinned
// to the same release as the rest of three here.
//
// Xbot is a mannequin: grey, with no clothes and no face. It is the base, and
// each character is dressed on top of it. Every vertex follows some bone, and
// which bone says what part of a person it is: the head and hands are skin, the
// chest and arms are a shirt, the hips and legs are trousers, the feet are shoes,
// and the crown of the head is hair. That is worked out once on the loaded model.
// Each character then gets its own five colours, so the geometry is shared by
// everyone and a character costs one small material.
//
// What the callers see has not changed. buildWalker returns a group at once and
// group.stride(metres) turns the legs, because feet that keep up with the ground
// covered are the whole point and a clock cannot do that. The model arrives
// later and is dropped in. Nothing waits on it.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

export const XBOT_URL =
  "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/models/gltf/Xbot.glb";

// Mixamo's walk carries the figure one cycle, both feet, and the step here is the
// one the hand-built walk used. The clip runs on the spot: its hips sway five
// centimetres side to side and never travel, so the callers do the moving.
const STRIDE_M = 0.76;
const CYCLE_M = STRIDE_M * 2;

const WALK = "walk";

// The parts a person is dressed in, in the order the shader indexes them.
export const REGIONS = ["skin", "shirt", "trousers", "shoes", "hair"];

// The crown of the head, as modelled. Xbot stands 1.81 m and the head bone
// carries everything from the jaw up; above this is the top and back of the
// skull, where hair is. 285 of its vertices.
const HAIR_ABOVE_M = 1.69;

// Which part of a person a vertex is, from the bone that moves it most and how
// high it sits. Bone names arrive as mixamorigHips or mixamorig:Hips depending
// on who read the file, so the prefix is taken off either way.
export function regionOf(boneName, y) {
  const bone = String(boneName).replace(/^mixamorig:?/, "");
  if (bone.startsWith("Head") || bone.startsWith("Neck")
      || bone.endsWith("Eye") || bone.includes("Hand")) {
    return bone.startsWith("Head") && y > HAIR_ABOVE_M ? 4 : 0;
  }
  if (bone.startsWith("Spine") || bone.endsWith("Shoulder")
      || bone.endsWith("Arm")) return 1;
  if (bone === "Hips" || bone.endsWith("UpLeg") || bone.endsWith("Leg")) return 2;
  if (bone.includes("Foot") || bone.includes("Toe")) return 3;
  throw new Error(`figures.js does not know what part of a person ${bone} is`);
}

// What people wear and what they look like. The shirt is the colour the caller
// asked for, which is how golfers and the cast were told apart before. The rest
// is chosen from the coat so the same caller always gets the same person.
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2b1f17, 0x4a3222, 0x8a6a45, 0xb9a27a, 0x9c9c9c, 0x1a1a1a];
const TROUSERS = [0x2e3440, 0x3b4a5a, 0x5a4a3a, 0x6b6b5e, 0x1f2328];
const SHOES = [0x2a2522, 0x3d3128, 0x1c1c1c, 0x6e6259];

// What a role wears. Anything a role does not set is chosen the way it is for
// anybody else, so a golfer still has their own hair colour under the cap and
// the caller's shirt colour still tells four golfers apart. head is a hat or a
// cap, and it takes the place of the hair.
//
// The roles are the ones cast.json gives, and the test holds them to it, so a
// role renamed there does not quietly lose its clothes here.
export const OUTFITS = {
  // A polo in the caller's colour, pale trousers, white shoes and a white cap.
  "the golfer": { trousers: 0xb8a57e, shoes: 0xe8e6e0, head: 0xe8e6e0 },
  // Kitchen whites and a skull cap, with dark trousers and non-slip black shoes.
  "the cook": { shirt: 0xeeeeea, trousers: 0x2c2c2e, shoes: 0x1c1c1c, head: 0xeeeeea },
  // Walking trousers and brown boots under whatever jacket they came in.
  "the hiker": { trousers: 0x5a5a4a, shoes: 0x5a3e2a },
  // Jeans and grey trainers.
  "the dog walker": { trousers: 0x3b4a5a, shoes: 0x8a8a86 },
  // Dark work trousers and black shoes, on their feet all day.
  "the shop hand": { trousers: 0x2e3440, shoes: 0x1f1f1f },
};

// The five colours one person is drawn in: skin, shirt, trousers, shoes, and
// hair or hat. role is optional, and a role with no outfit dresses like anyone.
export function paletteFor(coat, role) {
  const h = Math.imul(Math.round(coat) | 0, 2654435761) >>> 0;
  const wears = OUTFITS[role] || {};
  return [
    SKIN[h % SKIN.length],
    wears.shirt ?? (Math.round(coat) & 0xffffff),
    wears.trousers ?? TROUSERS[(h >>> 7) % TROUSERS.length],
    wears.shoes ?? SHOES[(h >>> 11) % SHOES.length],
    wears.head ?? HAIR[(h >>> 3) % HAIR.length],
  ];
}

// Mark every vertex with its region, once, on the loaded model. Clones share the
// geometry, so every figure after this carries the marks for nothing.
function dress(scene) {
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const g = o.geometry;
    const index = g.attributes.skinIndex;
    const weight = g.attributes.skinWeight;
    const pos = g.attributes.position;
    const region = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      let best = 0;
      for (let k = 1; k < 4; k++) {
        if (weight.getComponent(v, k) > weight.getComponent(v, best)) best = k;
      }
      const bone = o.skeleton.bones[index.getComponent(v, best)];
      region[v] = regionOf(bone.name, pos.getY(v));
    }
    g.setAttribute("region", new THREE.BufferAttribute(region, 1));
  });
}

// One character's clothes. The shader is the standard one with its diffuse
// colour taken from the palette by region instead of from a single colour, so
// the figures light, shade and fog the same as everything else in the scene.
function clothesFor(coat, role) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const palette = paletteFor(coat, role).map(c => new THREE.Color(c));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        "#include <common>\nattribute float region;\nvarying float vRegion;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\nvRegion = region;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        `#include <common>\nuniform vec3 uPalette[${REGIONS.length}];\nvarying float vRegion;`)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4( uPalette[ int( vRegion + 0.5 ) ], opacity );");
  };
  // Every character runs the same shader with different colours in it, so they
  // share one compiled program rather than compiling one each.
  material.customProgramCacheKey = () => "figure-palette";
  return material;
}

let loaded = null;        // Promise of the dressed model and its walk

function load() {
  if (loaded) return loaded;
  loaded = new GLTFLoader().loadAsync(XBOT_URL)
    .then((gltf) => {
      const walk = gltf.animations.find(a => a.name === WALK);
      if (!walk) {
        throw new Error(
          `${XBOT_URL} has no clip called ${WALK}. It carries ` +
          `${gltf.animations.map(a => a.name).join(", ")}.`);
      }
      dress(gltf.scene);
      return { scene: gltf.scene, walk };
    })
    .catch((err) => {
      // Nobody on the peninsula is a thing you would notice, but only if it is
      // said. Falling back to something else would hide it.
      console.error(`The figure at ${XBOT_URL} did not load, so the cast is not `
        + `on the ground.`, err);
      throw err;
    });
  return loaded;
}

// Start fetching before anybody asks, so the first golfer does not wait on it.
export function preload() {
  return load().catch(() => null);
}

// A walking person, dressed for their role, with the coat colour the caller
// gives as their shirt where the role does not set one.
export function buildWalker(coat = 0x808080, role = null) {
  const group = new THREE.Group();
  // Until the model lands there is nobody here. stride still answers, because
  // the callers drive it from the first frame.
  let mixer = null;
  let action = null;

  load().then((model) => {
    const body = cloneSkinned(model.scene);
    // The model faces +Z and everything in this scene faces -Z.
    body.rotation.y = Math.PI;
    const clothes = clothesFor(coat, role);
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.material = clothes;
      o.castShadow = true;
    });
    group.add(body);
    mixer = new THREE.AnimationMixer(body);
    action = mixer.clipAction(model.walk);
    action.play();
    // Wherever the caller had walked to before the model arrived.
    mixer.setTime(group.walked * (model.walk.duration / CYCLE_M));
  }).catch((err) => {
    // load() reports a failed fetch. Anything else is a figure that could not be
    // built, and a figure silently missing is one nobody knows is missing.
    console.error("A figure could not be built:", err);
  });

  group.walked = 0;
  // Metres covered, not seconds elapsed. Feet that run off a clock skate.
  group.stride = (metres) => {
    group.walked = metres;
    if (!mixer || !action) return;
    mixer.setTime(metres * (action.getClip().duration / CYCLE_M));
  };
  return group;
}
