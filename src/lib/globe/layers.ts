import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  type IUniform,
  Mesh,
  Points,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Blending
} from 'three';
import * as glsl from './shaders.ts';

export const KIND = { announce: 0, withdraw: 1, change: 2, alarm: 3, focus: 4 } as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export interface Palette {
  ocean: Color;
  grid: Color;
  night: Color;
  rim: Color;
  land: Color;
  pressure: Color;
  alarm: Color;
  ink: Color;
  paper: Color;
  announce: Color;
  withdraw: Color;
  change: Color;
  focus: Color;
}

const kinds = (palette: Palette) => [
  palette.announce,
  palette.withdraw,
  palette.change,
  palette.alarm,
  palette.focus
];

const material = (
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, IUniform>
) =>
  new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false
  });

export function createSphere(palette: Palette) {
  const uniforms = {
    uOcean: { value: palette.ocean },
    uGrid: { value: palette.grid },
    uNight: { value: palette.night },
    uRim: { value: palette.rim },
    uSun: { value: new Vector3(0, 0, 1) },
    uDaylight: { value: 1 },
    uGlow: { value: 0.6 }
  };
  const mesh = new Mesh(
    new SphereGeometry(1, 96, 64),
    new ShaderMaterial({
      vertexShader: glsl.globeVertex,
      fragmentShader: glsl.globeFragment,
      uniforms
    })
  );
  return { mesh, uniforms };
}

/** The land, as a halftone screen of dots that can be tinted country by country */
export function createDots(positions: Float32Array, countryOf: Float32Array, countries: number) {
  const heat = new DataTexture(new Uint8Array(countries * 4), countries, 1, RGBAFormat);
  heat.needsUpdate = true;
  const uniforms = {
    uHeat: { value: heat },
    uCountries: { value: countries },
    uSize: { value: 2.4 },
    uRef: { value: 3 },
    uLand: { value: new Color() },
    uPressure: { value: new Color() },
    uAlarm: { value: new Color() }
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aCountry', new BufferAttribute(countryOf, 1));
  const points = new Points(geometry, material(glsl.dotsVertex, glsl.dotsFragment, uniforms));
  const set = (index: number, pressure: number, alarm: number) => {
    heat.image.data![index * 4] = Math.round(Math.min(pressure, 1) * 255);
    heat.image.data![index * 4 + 1] = Math.round(Math.min(alarm, 1) * 255);
  };
  return { points, uniforms, set, flush: () => (heat.needsUpdate = true) };
}

interface Shape {
  vertices: number;
  index: number[];
  fixed: Record<string, { size: number; values: number[] }>;
}

/** Many copies of one small shape in one plain buffer, a slot each, handed out round and round */
function batch(shape: Shape, layout: Record<string, number>, size: number) {
  const geometry = new BufferGeometry();
  for (const [name, { size: width, values }] of Object.entries(shape.fixed)) {
    const array = new Float32Array(size * values.length);
    for (let slot = 0; slot < size; slot++) array.set(values, slot * values.length);
    geometry.setAttribute(name, new BufferAttribute(array, width));
  }
  const index = new Uint32Array(size * shape.index.length);
  for (let slot = 0; slot < size; slot++) {
    index.set(
      shape.index.map((vertex) => vertex + slot * shape.vertices),
      slot * shape.index.length
    );
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  const attributes = Object.fromEntries(
    Object.entries(layout).map(([name, width]) => {
      const attribute = new BufferAttribute(new Float32Array(size * shape.vertices * width), width);
      geometry.setAttribute(name, attribute);
      return [name, attribute];
    })
  );
  (attributes.aTime.array as Float32Array).fill(-1e4);
  let cursor = 0;
  return {
    geometry,
    write(values: Record<string, number[]>) {
      const slot = cursor;
      cursor = (cursor + 1) % size;
      for (const [name, value] of Object.entries(values)) {
        const attribute = attributes[name];
        const array = attribute.array as Float32Array;
        const from = slot * shape.vertices * attribute.itemSize;
        for (let vertex = 0; vertex < shape.vertices; vertex++) {
          array.set(value, from + vertex * attribute.itemSize);
        }
        attribute.addUpdateRange(from, shape.vertices * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
  };
}

const SEGMENTS = 32;

function ribbon(): Shape {
  const u: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    u.push(i / SEGMENTS, i / SEGMENTS);
    side.push(-1, 1);
    if (i < SEGMENTS) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  return {
    vertices: (SEGMENTS + 1) * 2,
    index,
    fixed: { aU: { size: 1, values: u }, aSide: { size: 1, values: side } }
  };
}

export function createArcs(size: number, palette: Palette) {
  const arcs = batch(ribbon(), { aStart: 3, aEnd: 3, aTime: 2, aKind: 1 }, size);
  const uniforms = {
    uTime: { value: 0 },
    uPixel: { value: 0.001 },
    uWidth: { value: 2 },
    uTail: { value: 0.35 },
    uLinger: { value: 2.5 },
    uDim: { value: 1 },
    uKinds: { value: kinds(palette) }
  };
  const mesh = new Mesh(arcs.geometry, material(glsl.arcsVertex, glsl.arcsFragment, uniforms));
  mesh.frustumCulled = false;
  const add = (start: Vector3, end: Vector3, birth: number, duration: number, kind: Kind) =>
    arcs.write({
      aStart: start.toArray(),
      aEnd: end.toArray(),
      aTime: [birth, duration],
      aKind: [kind]
    });
  return { mesh, uniforms, add };
}

export function createRings(size: number, palette: Palette) {
  const square = {
    vertices: 4,
    index: [0, 1, 2, 0, 2, 3],
    fixed: { aCorner: { size: 2, values: [-1, -1, 1, -1, 1, 1, -1, 1] } }
  };
  const rings = batch(square, { aCentre: 3, aTime: 2, aKind: 1, aSize: 1 }, size);
  const uniforms = { uTime: { value: 0 }, uDim: { value: 1 }, uKinds: { value: kinds(palette) } };
  const mesh = new Mesh(rings.geometry, material(glsl.ringsVertex, glsl.ringsFragment, uniforms));
  mesh.frustumCulled = false;
  const add = (centre: Vector3, birth: number, duration: number, kind: Kind, radius: number) =>
    rings.write({
      aCentre: centre.toArray(),
      aTime: [birth, duration],
      aKind: [kind],
      aSize: [radius]
    });
  return { mesh, uniforms, add };
}

export function createStations(positions: Float32Array, palette: Palette) {
  const uniforms = {
    uPixelRatio: { value: 1 },
    uSize: { value: 9 },
    uInk: { value: palette.ink },
    uPaper: { value: palette.paper }
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    material(glsl.stationsVertex, glsl.stationsFragment, uniforms)
  );
  return { points, uniforms };
}

export function setBlending(materials: ShaderMaterial[], blending: Blending) {
  for (const each of materials) {
    each.blending = blending;
    each.needsUpdate = true;
  }
}

export { kinds };
