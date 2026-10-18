import { Float32BufferAttribute } from 'three';

// A live displacement added to the base must have coefficient 1. Absolute
// targets otherwise multiply it by (1 - sum(weights)), cancelling the tissue
// whenever the existing expression/static weights sum to one. Convert once,
// keeping target names, indices, and the original blend result for any weights.
export function makeMorphsRelative(geometry) {
  if (geometry.morphTargetsRelative) return;
  const converted = {};
  for (const [name, targets] of Object.entries(geometry.morphAttributes)) {
    const base = geometry.attributes[name];
    converted[name] = targets.map(target => {
      if (!base || base.count !== target.count || base.itemSize !== target.itemSize) {
        throw new Error(`Cannot convert absolute ${name} morph: incompatible base attribute`);
      }
      const delta = new Float32Array(target.count * target.itemSize);
      for (let i = 0; i < target.count; i++) for (let k = 0; k < target.itemSize; k++) {
        delta[i * target.itemSize + k] = target.getComponent(i, k) - base.getComponent(i, k);
      }
      const relative = new Float32BufferAttribute(delta, target.itemSize);
      relative.name = target.name;
      return relative;
    });
  }
  geometry.morphAttributes = converted;
  geometry.morphTargetsRelative = true;
  geometry.dispose(); // discard cached absolute morph textures if already drawn
}
