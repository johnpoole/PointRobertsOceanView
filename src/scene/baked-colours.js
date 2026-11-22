// The colour of every vertex of a part when its material is baked into it.
//
// A part is coloured one of two ways. Some carry one colour in their material.
// Others carry a colour at every vertex and share a white material that lets
// those through: the bicycle, the golf cart and the ultralight's pilot are made
// that way, tyres and frame and coat in one mesh. Baking the material's colour
// alone painted all of those white, and then one hue.
//
// own is the part's own colours, read with getX, getY and getZ, or null when
// the material does not use them. material is {r, g, b}. The two multiply,
// which is what the renderer does with them.
export function bakedColours(count, own, material) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = material.r * (own ? own.getX(i) : 1);
    out[i * 3 + 1] = material.g * (own ? own.getY(i) : 1);
    out[i * 3 + 2] = material.b * (own ? own.getZ(i) : 1);
  }
  return out;
}
