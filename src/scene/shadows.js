// Which things in the scene throw the sun's shadow and which take it.
//
// Sixty files build meshes here and more arrive after the page has opened, as
// an area's close-up model loads. So nothing is asked to say for itself: the
// scene is gone round a few times a second and each mesh not yet seen is given
// its part by what it is made of.
//
// Imports nothing, so node can check the rule against plain objects.

// What a mesh does about the sun's shadow: { cast, receive }, or null for one
// that has nothing to do with it.
//
// A surface the standard lights fall on takes a shadow. It throws one if it is
// solid: glass, the water and the propeller's blur let the sun through.
// Anything with a shader of its own — the sky, the screen a photograph is
// thrown on — is not lit by the sun at all and is left out, and so are the
// unlit boxes that exist to be hovered over.
export function shadowPart(object) {
  if (!object.isMesh) return null;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (!materials.length || !materials.every((m) => m && m.isMeshStandardMaterial)) return null;
  const solid = materials.every((m) => !m.transparent && m.opacity >= 1);
  return { cast: solid && !object.userData.noShadow, receive: true };
}

// Goes round everything under root and gives each mesh its part, once. A mesh
// that set userData.shadowsSet has decided for itself and is not touched.
// Returns how many were given one this time.
export function handOutShadows(root, seen) {
  let given = 0;
  root.traverse((object) => {
    if (seen.has(object)) return;
    seen.add(object);
    if (object.userData.shadowsSet) return;
    const part = shadowPart(object);
    if (!part) return;
    object.castShadow = part.cast;
    object.receiveShadow = part.receive;
    given++;
  });
  return given;
}

// How strongly the shadows are drawn for a sun this many degrees up. The sun's
// light is left on through twilight, coming from under the horizon, to stand
// for the glow that is still in the sky. A shadow map takes that literally and
// puts the whole world in the shade of the Earth, so the shadows are let go as
// the sun reaches the horizon and are gone when it is on it.
export const SHADOW_FADE_DEG = 2;
export function shadowStrength(elevationDeg) {
  return Math.min(Math.max(elevationDeg / SHADOW_FADE_DEG, 0), 1);
}
