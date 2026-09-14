// Blender owns the cabin mesh and its terrain constraints. Both travel inside
// one GLB so a cached model cannot be paired with a different clearance file.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundClearance } from './ground-clearance.js';
import { stairCarve } from './stair.js';
import { toWorld } from '../geo.js';
import { terrainGrade } from './terrain-grade.js';

export async function loadCabinAsset() {
  const gltf = await new GLTFLoader().loadAsync('assets/site/389-cabin.glb');
  const root = gltf.scene.getObjectByName('CabinAsset');
  if (!root || root.userData.schema !== 1) throw new Error('Unsupported cabin GLB metadata');
  const { worldOrigin, terrain, stair, entrance } = root.userData;
  const surfaces = JSON.parse(terrain), spec = JSON.parse(stair), edge = JSON.parse(entrance);
  if (worldOrigin?.length !== 3 || !worldOrigin.every(Number.isFinite)
      || !surfaces.length || !surfaces.every(s => Number.isFinite(s.ceiling)
        && s.polygon.length >= 3 && s.polygon.every(p => p.length === 2 && p.every(Number.isFinite)))) {
    throw new Error('Invalid cabin GLB terrain constraints');
  }
  root.position.set(...worldOrigin);
  const grade=terrainGrade(root.userData.grade ? JSON.parse(root.userData.grade) : null);
  return {
    carve(diagonal) {
      const floors = groundClearance(surfaces, diagonal);
      const approach = stairCarve(spec, diagonal, edge);
      return (lat, lon, height) => {
        const p = toWorld(lat, lon);
        return floors(p.x, p.z, grade(p.x,p.z,approach(lat, lon, height)));
      };
    },
    addTo(scene, projector) {
      root.traverse(obj => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        // Preserve the existing camera projector on the approach concrete.
        for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (projector && mat.name === 'Approach concrete') projector.dress(mat);
        }
      });
      scene.add(gltf.scene);
    },
  };
}
