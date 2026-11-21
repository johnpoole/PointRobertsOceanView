// Run: node src/scene/test-shadows.mjs
import assert from 'node:assert/strict';
import { shadowPart, handOutShadows, shadowStrength, SHADOW_FADE_DEG } from './shadows.js';

const standard = (o = {}) => ({ isMeshStandardMaterial: true, transparent: false, opacity: 1, ...o });
const mesh = (material, userData = {}) => ({ isMesh: true, material, userData, children: [] });

// A solid lit thing throws a shadow and takes one.
assert.deepEqual(shadowPart(mesh(standard())), { cast: true, receive: true });
// Glass, the water and the propeller's blur take one and throw none.
assert.deepEqual(shadowPart(mesh(standard({ transparent: true, opacity: 0.92 }))),
  { cast: false, receive: true });
assert.deepEqual(shadowPart(mesh(standard({ opacity: 0.25 }))), { cast: false, receive: true });
// One see-through part is enough: the mesh is drawn into the map whole or not.
assert.deepEqual(shadowPart(mesh([standard(), standard({ transparent: true })])),
  { cast: false, receive: true });
// Told not to throw one.
assert.deepEqual(shadowPart(mesh(standard(), { noShadow: true })), { cast: false, receive: true });
// The sky, the hover boxes, a sprite, a group: nothing to do with it.
assert.equal(shadowPart(mesh({ isShaderMaterial: true })), null);
assert.equal(shadowPart(mesh({ isMeshBasicMaterial: true, transparent: true, opacity: 0 })), null);
assert.equal(shadowPart(mesh([standard(), { isMeshBasicMaterial: true }])), null);
assert.equal(shadowPart({ isSprite: true, material: standard(), userData: {} }), null);
assert.equal(shadowPart({ isGroup: true, userData: {} }), null);

// Going round: each mesh once, and one that has decided for itself is left be.
{
  const traverse = function (fn) { fn(this); for (const c of this.children) c.traverse(fn); };
  const node = (o) => Object.assign(o, { traverse });
  const house = node(mesh(standard()));
  const water = node(mesh(standard({ transparent: true })));
  const sky = node(mesh({ isShaderMaterial: true }));
  const farGround = node(mesh(standard(), { shadowsSet: true }));
  farGround.castShadow = false;
  farGround.receiveShadow = false;
  const root = node({ userData: {}, children: [house, water, sky, farGround] });
  const seen = new WeakSet();
  assert.equal(handOutShadows(root, seen), 2);
  assert.equal(house.castShadow, true);
  assert.equal(house.receiveShadow, true);
  assert.equal(water.castShadow, false);
  assert.equal(water.receiveShadow, true);
  assert.equal(sky.castShadow, undefined);
  assert.equal(farGround.castShadow, false);
  assert.equal(farGround.receiveShadow, false);

  // Something switches a shadow off by hand afterwards. The next round does not
  // switch it back on.
  house.castShadow = false;
  assert.equal(handOutShadows(root, seen), 0);
  assert.equal(house.castShadow, false);

  // A model that arrives later is picked up on the round after it arrives.
  const late = node(mesh(standard()));
  root.children.push(late);
  assert.equal(handOutShadows(root, seen), 1);
  assert.equal(late.castShadow, true);
}

// Full by the time the sun is clear of the horizon, gone when it is on it, and
// never past either end.
assert.equal(shadowStrength(40), 1);
assert.equal(shadowStrength(SHADOW_FADE_DEG), 1);
assert.equal(shadowStrength(SHADOW_FADE_DEG / 2), 0.5);
assert.equal(shadowStrength(0), 0);
assert.equal(shadowStrength(-6), 0);

console.log('PASS: who throws and who takes a shadow, one round per mesh, and the fade at the horizon');
