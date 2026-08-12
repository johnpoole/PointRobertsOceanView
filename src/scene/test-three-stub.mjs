// Just enough of three for trees.js to run under node. Only what trees.js
// touches is here; anything it starts using will come up as undefined rather
// than quietly do nothing.
//
// The instance attributes carry a shadow of what the GPU has been told, filled
// only from the update ranges the code declares. A slot written without being
// named in a range shows up as a difference between the two.

export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
}

export class Quaternion {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  setFromAxisAngle(axis, a) {
    const h = a / 2, s = Math.sin(h);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s;
    this.w = Math.cos(h);
    return this;
  }
}

export class Color {
  constructor(hex = 0xffffff) { this.setHex(hex); }
  setHex(hex) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }
  toArray(a, o) { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; }
}

export class Matrix4 {
  constructor() { this.elements = new Float64Array(16); this.elements[15] = 1; }
  compose(pos, q, s) {
    const e = this.elements;
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    e[0] = (1 - (yy + zz)) * s.x; e[1] = (xy + wz) * s.x; e[2] = (xz - wy) * s.x; e[3] = 0;
    e[4] = (xy - wz) * s.y; e[5] = (1 - (xx + zz)) * s.y; e[6] = (yz + wx) * s.y; e[7] = 0;
    e[8] = (xz + wy) * s.z; e[9] = (yz - wx) * s.z; e[10] = (1 - (xx + yy)) * s.z; e[11] = 0;
    e[12] = pos.x; e[13] = pos.y; e[14] = pos.z; e[15] = 1;
    return this;
  }
  toArray(a, o) { for (let i = 0; i < 16; i++) a[o + i] = this.elements[i]; }
}

// What WebGLAttributes does with one of these: with no ranges named it sends
// the whole array, with ranges it sends those and clears them.
class Attribute {
  constructor(len, itemSize) {
    this.array = new Float32Array(len);
    this.shadow = new Float32Array(len);
    this.itemSize = itemSize;
    this.needsUpdate = false;
    this.updateRanges = [];
    this.floatsSent = 0;
  }
  addUpdateRange(start, count) { this.updateRanges.push({ start, count }); }
  clearUpdateRanges() { this.updateRanges.length = 0; }
  upload() {
    if (!this.needsUpdate) return;
    if (this.updateRanges.length) {
      for (const r of this.updateRanges) {
        this.shadow.set(this.array.subarray(r.start, r.start + r.count), r.start);
        this.floatsSent += r.count;
      }
      this.clearUpdateRanges();
    } else {
      this.shadow.set(this.array);
      this.floatsSent += this.array.length;
    }
    this.needsUpdate = false;
  }
}

export class InstancedMesh {
  constructor(geometry, material, room) {
    this.geometry = geometry;
    this.material = material;
    this.room = room;
    this.count = room;
    this.instanceMatrix = new Attribute(room * 16, 16);
    this.instanceColor = null;
    this.written = 0;
  }
  setMatrixAt(i, m) {
    if (i < 0 || i >= this.room) {
      throw new Error(`setMatrixAt: slot ${i} of a mesh with room for ${this.room}`);
    }
    this.written++;
    m.toArray(this.instanceMatrix.array, i * 16);
  }
  setColorAt(i, c) {
    if (i < 0 || i >= this.room) {
      throw new Error(`setColorAt: slot ${i} of a mesh with room for ${this.room}`);
    }
    if (!this.instanceColor) this.instanceColor = new Attribute(this.room * 3, 3);
    c.toArray(this.instanceColor.array, i * 3);
  }
  attributes() {
    return this.instanceColor ? [this.instanceMatrix, this.instanceColor]
                              : [this.instanceMatrix];
  }
  // Stand in for the render that would have picked these up.
  render() { for (const a of this.attributes()) a.upload(); }
}

export class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}

export class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(name, a) { this.attributes[name] = a; return this; }
  computeVertexNormals() { return this; }
  scale() { return this; }
  translate() { return this; }
}

export class CylinderGeometry extends BufferGeometry {}
export class IcosahedronGeometry extends BufferGeometry {}
export class OctahedronGeometry extends BufferGeometry {}
export class PlaneGeometry extends BufferGeometry {}

export class MeshStandardMaterial { constructor(o = {}) { Object.assign(this, o); } }

export class Scene {
  constructor() { this.children = []; }
  add(o) { this.children.push(o); }
}

export function mergeGeometries() { return new BufferGeometry(); }
