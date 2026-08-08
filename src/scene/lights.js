// Lights that have to read at a distance, shared by the ships and the light on
// the point.
//
// A light seen at three kilometres is not a lit object. It is a point, and it is
// the same size whether it is a metre across or ten, because what you are seeing
// is the eye's own blur and not the lamp. So these are points with the size held
// in pixels rather than in metres, and they add to whatever is behind them
// instead of covering it, which is what a light does to a dark sea.

import * as THREE from "three";

let texture = null;

// A soft round dot. Drawn once and shared by everything.
function glow() {
  if (texture) return texture;
  const N = 64;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grad.addColorStop(0.0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.25)");
  grad.addColorStop(1.0, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, N, N);
  texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// lamps: [{ x, y, z, color, size }]. Returns a Points whose opacity is the whole
// of how far up the lights are, so a caller can bring them on with the dark.
export function buildLamps(lamps) {
  const pos = new Float32Array(lamps.length * 3);
  const col = new Float32Array(lamps.length * 3);
  // Points carry one size for the whole cloud, so a per-lamp size rides in the
  // colour instead: a smaller lamp is a dimmer lamp, which is also true.
  const c = new THREE.Color();
  let biggest = 0;
  for (const l of lamps) biggest = Math.max(biggest, l.size);
  lamps.forEach((l, i) => {
    pos[i * 3] = l.x;
    pos[i * 3 + 1] = l.y;
    pos[i * 3 + 2] = l.z;
    c.set(l.color).multiplyScalar(l.size / biggest);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    map: glow(),
    size: biggest,
    sizeAttenuation: false,   // pixels, not metres
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.visible = false;
  return points;
}

// Bring a lamp cloud up with the dark. night is 0 in full day, 1 after sunset.
export function setLampLevel(points, night, scale = 1) {
  const level = night * scale;
  points.visible = level > 0.02;
  points.material.opacity = Math.min(1, level);
}
