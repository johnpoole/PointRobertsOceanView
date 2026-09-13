// What neighbours posted, put on the ground.
//
// Posts off Nextdoor's public Point Roberts pages and r/PointRoberts that name a
// road or a place on the peninsula. The server does the reading and the finding
// and hands each one over with where it names already worked out, so this only
// stands a post on that spot. Several posts about the same place stand in a ring
// round it rather than inside each other.

import * as THREE from "three";
import { toWorld } from "../geo.js";

const POST_M = 2.6;
const HEAD_M = 0.42;
const RING_M = 6;           // how far apart two posts about one place stand

export function buildCommunity(scene, sample) {
  const group = new THREE.Group();
  group.name = "community";
  group.visible = false;
  scene.add(group);

  const stalkShape = new THREE.CylinderGeometry(0.06, 0.06, POST_M, 6);
  stalkShape.translate(0, POST_M / 2, 0);
  const headShape = new THREE.SphereGeometry(HEAD_M, 12, 8);
  headShape.translate(0, POST_M + HEAD_M * 0.7, 0);
  const stalk = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.5, metalness: 0.2 });
  // Amber, so a neighbour's post is never mistaken for one of the Sheriff's calls.
  const head = new THREE.MeshBasicMaterial({ color: 0xe0a84f });

  let placed = [];

  return {
    group,
    get shown() { return group.visible; },
    get count() { return placed.length; },
    setVisible(on) { group.visible = on; },

    // posts is what the proxy sends. Newest first on the card, whatever order
    // they arrive in.
    setPosts(posts) {
      for (const p of placed) p.marker.removeFromParent();
      placed = [];
      const atPlace = new Map();
      const newest = [...posts]
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
      for (const post of newest) {
        const key = `${post.lat.toFixed(5)},${post.lon.toFixed(5)}`;
        const n = atPlace.get(key) || 0;
        atPlace.set(key, n + 1);
        const w = toWorld(post.lat, post.lon);
        const turn = n * 2.39996;         // the golden angle, so a ring never stacks
        const x = w.x + (n ? Math.cos(turn) * RING_M : 0);
        const z = w.z + (n ? Math.sin(turn) * RING_M : 0);
        const y = sample(post.lat, post.lon);
        const marker = new THREE.Group();
        marker.add(new THREE.Mesh(stalkShape, stalk), new THREE.Mesh(headShape, head));
        marker.position.set(x, y, z);
        marker.userData.post = post;
        group.add(marker);
        placed.push({ marker, post, spot: { x, y, z, heading: 0 } });
      }
      return placed.length;
    },

    get newest() { return placed.length ? placed[0] : null; },

    // One post by its position in the list, wrapping at both ends.
    at(index) {
      if (!placed.length) return null;
      const n = placed.length;
      return placed[((index % n) + n) % n];
    },

    indexOf(found) {
      return placed.indexOf(found);
    },

    // The post standing under this ray, or null.
    pick(raycaster) {
      if (!group.visible) return null;
      for (const hit of raycaster.intersectObjects(group.children, true)) {
        let o = hit.object;
        while (o && !o.userData.post) o = o.parent;
        const found = o && placed.find(p => p.marker === o);
        if (found) return found;
      }
      return null;
    },
  };
}
