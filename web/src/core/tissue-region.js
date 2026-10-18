// Fit the moving mound independently of the static morph brush. The brush's
// anchor is an apex-depth construction, not an anatomical chest-wall estimate.
import { prepareMorpho, measurePrepared } from './morpho.js';
import { fromBody } from './field.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = Number.isFinite;

export function fitTissueRegion({ frame, params, meshes, wallInset = 0.04 }) {
  const p = params, inset = clamp(finite(wallInset) ? wallInset : 0.04, 0, 0.15);
  const apex = [1, -1].map(sign => fromBody(frame, [sign * Math.abs(p.anchor.x), p.anchor.y, p.anchor.z + p.depth].map(x => x * frame.S)));
  const measured = measurePrepared(prepareMorpho({ frame, meshes, apex }));
  const sides = measured.sides.map((m, i) => {
    const fallback = {
      centerU: Math.abs(p.anchor.x), cy: p.anchor.y,
      inner: Math.max(0, Math.abs(p.anchor.x) - (p.window?.x ?? 0.32)),
      outer: Math.abs(p.anchor.x) + (p.window?.x ?? 0.32),
      bottom: p.anchor.y - (p.window?.yDown ?? 0.42),
      top: p.anchor.y + (p.window?.yUp ?? 0.44),
      wall: p.anchor.z - Math.max(inset, p.depth * 0.25),
      peak: p.anchor.z + p.depth,
    };
    // A garment can bridge the cleavage: its transverse *aesthetic metric*
    // is undefined, but a measured lateral wall crossing still locates the
    // outer mound. Never invent a lateral border when the section is open.
    const usable = m.ok && !m.flags.some(f => ['flat', 'hole', 'apexOnSearchEdge'].includes(f))
      && m.apex?.every(finite) && m.imf?.every(finite) && m.bottom?.every(finite) && m.top?.every(finite);
    if (!usable) return { ...fallback, sign: i ? -1 : 1, method: 'prior', warnings: m.flags };
    const [u, y, z] = m.apex;
    const lateral = m.lateral && !m.flags.includes('lateralOpen') && !m.flags.includes('transverseHole') && m.lateral[0] > u + 0.05;
    const inner = m.medial && m.medial[0] < u - 0.05 ? Math.max(0, m.medial[0]) : fallback.inner;
    return {
      sign: i ? -1 : 1, centerU: u, cy: y,
      inner: clamp(inner, Math.max(0, u - 0.5), u - 0.05),
      outer: clamp(lateral ? m.lateral[0] : fallback.outer, u + 0.08, u + 0.6),
      bottom: clamp(m.bottom[0], y - 0.65, y - 0.08),
      top: clamp(m.flags.includes('topOpen') ? fallback.top : m.top[0], y + 0.08, y + 0.7),
      wall: clamp(m.imf[1] - inset, z - 0.7, z - 0.05), peak: z,
      method: lateral ? 'surface-sections' : 'surface-height-prior-width', warnings: m.flags,
    };
  });
  return { sides };
}
