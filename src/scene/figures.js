// The people on the peninsula.
//
// Xbot, the figure in three.js's additive blending example, with its walk clip.
// It is Mixamo's model, and Adobe's terms allow it to be used in a project but
// not redistributed as a raw file, so it is never copied into this repository.
// It loads at runtime off jsDelivr's mirror of the three.js repository, pinned
// to the same release as the rest of three here.
//
// One file, loaded once, and every figure is a clone of it with its own
// skeleton and its own mixer.
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

let loaded = null;        // Promise of the model and its walk, started on first use

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

// A walking person. coat is kept so every caller's call stands.
export function buildWalker(coat = 0) {  // eslint-disable-line no-unused-vars
  const group = new THREE.Group();
  // Until the model lands there is nobody here. stride still answers, because
  // the callers drive it from the first frame.
  let mixer = null;
  let action = null;

  load().then((model) => {
    const body = cloneSkinned(model.scene);
    // The model faces +Z and everything in this scene faces -Z.
    body.rotation.y = Math.PI;
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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
