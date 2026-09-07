import * as THREE from "three";

// Proximity preloads detail even while looking away. Farther out, projected
// size and frustum intersection allow zoomed/shared views to request it too.
export function areaView(bounds, { near = 350, far = 550, pixels = 180, keepPixels = 120 } = {}) {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const matrix = new THREE.Matrix4(), frustum = new THREE.Frustum();
  return (camera, viewportHeight) => {
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    const distance = bounds.distanceToPoint(camera.position);
    const range = Math.max(1, camera.position.distanceTo(sphere.center));
    const diameter = sphere.radius * viewportHeight / (range * Math.tan(camera.fov * Math.PI / 360));
    const visible = frustum.intersectsBox(bounds);
    return { enter: distance <= near || (visible && diameter >= pixels),
      retain: distance <= far || (visible && diameter >= keepPixels) };
  };
}

// Area factories own these resources. Never use this on shared scene assets.
export function disposeArea(group) {
  group.removeFromParent();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const material of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
  group.clear();
}
