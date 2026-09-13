// Things somebody reported on the point, stood on the ground where they were.
//
// One layer each for what neighbours posted and for the fire and medical calls.
// The server works out where every item is, on the peninsula, and hands it over
// with a latitude and a longitude, so this only stands a post there. Several at
// one spot stand in a ring round it rather than inside each other.

import * as THREE from "three";
import { toWorld } from "../geo.js";

const POST_M = 2.6;
const HEAD_M = 0.42;
const RING_M = 6;           // how far apart two items at one place stand

// name names the group, colour is the head of each post, and when is the field
// the newest are sorted by.
export function buildPins(scene, sample, { name, colour, when }) {
  const group = new THREE.Group();
  group.name = name;
  group.visible = false;
  scene.add(group);

  const stalkShape = new THREE.CylinderGeometry(0.06, 0.06, POST_M, 6);
  stalkShape.translate(0, POST_M / 2, 0);
  const headShape = new THREE.SphereGeometry(HEAD_M, 12, 8);
  headShape.translate(0, POST_M + HEAD_M * 0.7, 0);
  const stalk = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.5, metalness: 0.2 });
  const head = new THREE.MeshBasicMaterial({ color: colour });

  let placed = [];

  return {
    group,
    get shown() { return group.visible; },
    get count() { return placed.length; },
    setVisible(on) { group.visible = on; },

    // Newest first on the card, whatever order they arrive in.
    setItems(items) {
      for (const p of placed) p.marker.removeFromParent();
      placed = [];
      const atPlace = new Map();
      const newest = [...items]
        .filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lon))
        .sort((a, b) => String(b[when]).localeCompare(String(a[when])));
      for (const item of newest) {
        const key = `${item.lat.toFixed(5)},${item.lon.toFixed(5)}`;
        const n = atPlace.get(key) || 0;
        atPlace.set(key, n + 1);
        const w = toWorld(item.lat, item.lon);
        const turn = n * 2.39996;         // the golden angle, so a ring never stacks
        const x = w.x + (n ? Math.cos(turn) * RING_M : 0);
        const z = w.z + (n ? Math.sin(turn) * RING_M : 0);
        const y = sample(item.lat, item.lon);
        const marker = new THREE.Group();
        marker.add(new THREE.Mesh(stalkShape, stalk), new THREE.Mesh(headShape, head));
        marker.position.set(x, y, z);
        marker.userData.item = item;
        group.add(marker);
        placed.push({ marker, item, spot: { x, y, z, heading: 0 } });
      }
      return placed.length;
    },

    get newest() { return placed.length ? placed[0] : null; },

    // One item by its position in the list, wrapping at both ends.
    at(index) {
      if (!placed.length) return null;
      const n = placed.length;
      return placed[((index % n) + n) % n];
    },

    indexOf(found) {
      return placed.indexOf(found);
    },

    // The item standing under this ray, or null.
    pick(raycaster) {
      if (!group.visible) return null;
      for (const hit of raycaster.intersectObjects(group.children, true)) {
        let o = hit.object;
        while (o && !o.userData.item) o = o.parent;
        const found = o && placed.find(p => p.marker === o);
        if (found) return found;
      }
      return null;
    },
  };
}
