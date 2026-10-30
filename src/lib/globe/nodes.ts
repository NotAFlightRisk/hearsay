import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import { kinds, type Kind, type Palette } from './layers.ts';
import { nodesFragment, nodesVertex } from './shaders.ts';

// how long a network's glow takes to fade, in seconds
const TAU = 40;

/** Every network we've seen recently, as a glowing point that flares when it's heard from */
export function createNodes(size: number, palette: Palette) {
  const slots = new Map<number, number>();
  const asns = new Float64Array(size);
  const position = new Float32Array(size * 3);
  const hit = new Float32Array(size).fill(-1e4);
  const heat = new Float32Array(size);
  const kind = new Float32Array(size);
  const focus = new Float32Array(size);
  const geometry = new BufferGeometry();
  const attributes = {
    position: new BufferAttribute(position, 3),
    aHit: new BufferAttribute(hit, 1),
    aHeat: new BufferAttribute(heat, 1),
    aKind: new BufferAttribute(kind, 1),
    aFocus: new BufferAttribute(focus, 1)
  };
  for (const [name, attribute] of Object.entries(attributes))
    geometry.setAttribute(name, attribute);
  geometry.setDrawRange(0, 0);
  const uniforms = {
    uTime: { value: 0 },
    uTau: { value: TAU },
    uRef: { value: 3 },
    uPixelRatio: { value: 1 },
    uDim: { value: 1 },
    uInk: { value: palette.ink },
    uKinds: { value: kinds(palette) }
  };
  const points = new Points(
    geometry,
    new ShaderMaterial({
      vertexShader: nodesVertex,
      fragmentShader: nodesFragment,
      uniforms,
      transparent: true,
      depthWrite: false
    })
  );
  points.frustumCulled = false;

  function claim(asn: number, at: Vector3) {
    let slot = slots.get(asn);
    if (slot !== undefined) {
      slots.delete(asn);
    } else if (slots.size < size) {
      slot = slots.size;
      geometry.setDrawRange(0, slot + 1);
    } else {
      // the least recently heard-from network gives up its seat
      const [oldest, freed] = slots.entries().next().value!;
      slots.delete(oldest);
      slot = freed;
      heat[slot] = 0;
    }
    slots.set(asn, slot);
    asns[slot] = asn;
    position.set([at.x, at.y, at.z], slot * 3);
    attributes.position.addUpdateRange(slot * 3, 3);
    attributes.position.needsUpdate = true;
    return slot;
  }

  function touch(slot: number, name: 'aHit' | 'aHeat' | 'aKind' | 'aFocus') {
    attributes[name].addUpdateRange(slot, 1);
    attributes[name].needsUpdate = true;
  }

  return {
    points,
    uniforms,
    hit(asn: number, at: Vector3, time: number, as: Kind) {
      const slot = claim(asn, at);
      heat[slot] = heat[slot] * Math.exp(-(time - hit[slot]) / TAU) + 1;
      hit[slot] = time;
      kind[slot] = as;
      for (const name of ['aHit', 'aHeat', 'aKind'] as const) touch(slot, name);
    },
    focus(selected: Set<number> | null) {
      for (const [asn, slot] of slots) {
        focus[slot] = selected?.has(asn) ? 1 : 0;
        touch(slot, 'aFocus');
      }
      uniforms.uDim.value = selected ? 0.3 : 1;
    },
    has: (asn: number) => slots.has(asn),
    where(asn: number) {
      const slot = slots.get(asn);
      return slot === undefined ? undefined : new Vector3().fromArray(position, slot * 3);
    },
    /** Networks worth tapping on: lit up recently enough to still be visible */
    *visible(time: number) {
      for (const [asn, slot] of slots) {
        if (heat[slot] * Math.exp(-(time - hit[slot]) / TAU) > 0.05 || focus[slot]) {
          yield { asn, at: new Vector3().fromArray(position, slot * 3) };
        }
      }
    }
  };
}
