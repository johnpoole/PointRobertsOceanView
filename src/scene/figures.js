// The people on the peninsula.
//
// Twelve bodies out of Kenney's Mini Characters, CC0, under assets/figures.
// Their rig is root, two legs, a torso, two arms and a head — seven joints, the
// same hierarchy the hand-built figure had — and they carry a walk clip that
// runs on the spot and bobs five centimetres, which is what the hand-built one
// did by arithmetic.
//
// All twelve share one eight kilobyte texture, so twelve different-looking
// people cost one image and one material.
//
// What the callers see has not changed. buildWalker returns a group at once and
// group.stride(metres) turns the legs, because a figure whose feet keep up with
// the ground it covers is the whole point and a clock cannot do that. The model
// arrives later and is dropped in. Nothing waits on it.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const FOLDER = "assets/figures/";
const BODIES = [
  "character-male-a.glb", "character-female-a.glb",
  "character-male-b.glb", "character-female-b.glb",
  "character-male-c.glb", "character-female-c.glb",
  "character-male-d.glb", "character-female-d.glb",
  "character-male-e.glb", "character-female-e.glb",
  "character-male-f.glb", "character-female-f.glb",
];

// They are modelled between 0.661 and 0.793 high, because some of them are
// wearing a hat. A person is 1.7 including the hat, so each body is measured
// and scaled on its own rather than all twelve by one number, which would have
// stood the tall-haired one at nearly two metres.
const PERSON_HEIGHT_M = 1.70;

// One turn of the clip is a whole cycle, which is both feet, so it covers two
// steps. The step length is the one the hand-built walk used.
const STRIDE_M = 0.76;
const CYCLE_M = STRIDE_M * 2;

const WALK = "walk";

let loaded = null;        // Promise of the built bodies, started on first use
let bodies = null;        // the loaded scenes and their clips, once it resolves

// Every body is its own file and every file names the same texture beside it, so
// without this the eight kilobyte image is fetched twelve times.
THREE.Cache.enabled = true;

function load() {
  if (loaded) return loaded;
  const loader = new GLTFLoader();
  loaded = Promise.all(BODIES.map(name =>
    loader.loadAsync(FOLDER + name).then(gltf => {
      const walk = gltf.animations.find(a => a.name === WALK);
      if (!walk) {
        throw new Error(
          `${name} has no clip called ${WALK}. It carries ` +
          `${gltf.animations.map(a => a.name).join(", ")}.`);
      }
      const high = new THREE.Box3().setFromObject(gltf.scene).max.y;
      if (!(high > 0.1)) {
        throw new Error(
          `${name} measures ${high} high, so there is nothing to scale it by.`);
      }
      return { scene: gltf.scene, walk, scale: PERSON_HEIGHT_M / high };
    })))
    .then(all => { bodies = all; return all; })
    .catch(err => {
      // Nobody on the peninsula is a thing you would notice, but only if it is
      // said. Falling back to something else would hide a broken deploy.
      console.error(
        `The figures under ${FOLDER} did not load, so the cast is not on the `
        + `ground. Check they were copied into the image.`, err);
      throw err;
    });
  return loaded;
}

// Start fetching before anybody asks, so the first golfer does not wait on it.
export function preload() {
  return load().catch(() => null);
}

// A walking person. coat is kept from the hand-built figure and now picks which
// of the twelve bodies this is, so the same caller gets the same person every
// time rather than a different one on each reload.
export function buildWalker(coat = 0) {
  const group = new THREE.Group();
  // Until the model lands there is nobody here. stride still answers, because
  // the callers drive it from the first frame.
  let mixer = null;
  let action = null;

  load().then((all) => {
    const pick = all[Math.abs(Math.round(coat)) % all.length];
    const body = cloneSkinned(pick.scene);
    body.scale.setScalar(pick.scale);
    // The models face +Z and everything in this scene faces -Z.
    body.rotation.y = Math.PI;
    body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    group.add(body);
    mixer = new THREE.AnimationMixer(body);
    action = mixer.clipAction(pick.walk);
    action.play();
    // Wherever the caller had walked to before the model arrived.
    mixer.setTime(group.walked * secondsPerMetre(pick.walk));
  }).catch((err) => {
    // load() reports its own failure and this catch is here so one figure that
    // cannot be built does not become an unhandled rejection. It still says so:
    // a figure silently missing is a figure nobody knows is missing.
    if (bodies) console.error("A figure could not be built:", err);
  });

  function secondsPerMetre(clip) {
    return clip.duration / CYCLE_M;
  }

  group.walked = 0;
  // Metres covered, not seconds elapsed. Feet that run off a clock skate.
  group.stride = (metres) => {
    group.walked = metres;
    if (!mixer || !action) return;
    mixer.setTime(metres * (action.getClip().duration / CYCLE_M));
  };
  return group;
}

// How many bodies there are, for anything spreading a cast across them.
export function bodyCount() {
  return BODIES.length;
}

export function ready() {
  return bodies !== null;
}
