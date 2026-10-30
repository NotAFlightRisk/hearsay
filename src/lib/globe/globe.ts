import {
  AdditiveBlending,
  NormalBlending,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type ShaderMaterial
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createArcs,
  createDots,
  createRings,
  createSphere,
  createStations,
  setBlending,
  type Kind,
  type Palette
} from './layers.ts';
import { createNodes } from './nodes.ts';
import { subsolar, toLatLon, toVector } from './sphere.ts';

export interface Land {
  positions: Float32Array;
  countryOf: Float32Array;
  countries: number;
}

export interface Layers {
  routes: boolean;
  withdrawals: boolean;
  networks: boolean;
  stations: boolean;
  daylight: boolean;
  spin: boolean;
}

interface Flight {
  from: Vector3;
  to: Vector3;
  fromDistance: number;
  toDistance: number;
  start: number;
}

const FLIGHT_SECONDS = 1.4;
// how long a network sits still after you let go before it starts turning again
const RESUME_SPIN_MS = 8000;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

export class Globe {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(36, 1, 0.1, 50);
  private controls: OrbitControls;
  private sphere;
  private arcs;
  private rings;
  private nodes;
  private dots?: ReturnType<typeof createDots>;
  private stations?: ReturnType<typeof createStations>;
  private pending: { time: number; asn: number; at: Vector3; kind: Kind }[] = [];
  private flight?: Flight;
  private frame = 0;
  private epoch = performance.now();
  private resizer: ResizeObserver;
  private spinTimer?: ReturnType<typeof setTimeout>;
  private fit = 3;
  private insets = { top: 0, bottom: 0 };
  private layers: Layers = {
    routes: true,
    withdrawals: true,
    networks: true,
    stations: true,
    daylight: true,
    spin: true
  };

  constructor(
    private host: HTMLElement,
    private palette: Palette,
    dark: boolean
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.append(this.renderer.domElement);
    this.sphere = createSphere(palette);
    this.arcs = createArcs(2048, palette);
    this.rings = createRings(256, palette);
    this.nodes = createNodes(6000, palette);
    this.scene.add(this.sphere.mesh, this.nodes.points, this.arcs.mesh, this.rings.mesh);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.07,
      enablePan: false,
      autoRotateSpeed: 0.35,
      zoomSpeed: 0.6
    });
    this.controls.addEventListener('start', () => this.holdSpin());
    this.camera.position.copy(toVector(30, 0, 3));
    this.setPalette(palette, dark);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();
    this.tick();
  }

  get now() {
    return (performance.now() - this.epoch) / 1000;
  }

  get canvas() {
    return this.renderer.domElement;
  }

  setLand(land: Land) {
    this.dots = createDots(land.positions, land.countryOf, land.countries);
    this.dots.uniforms.uLand.value = this.palette.land;
    this.dots.uniforms.uPressure.value = this.palette.pressure;
    this.dots.uniforms.uAlarm.value = this.palette.alarm;
    this.scene.add(this.dots.points);
    this.resize();
  }

  setStations(points: [number, number][]) {
    const positions = new Float32Array(
      points.flatMap(([lat, lon]) => toVector(lat, lon, 1.004).toArray())
    );
    this.stations = createStations(positions, this.palette);
    this.stations.points.visible = this.layers.stations;
    this.scene.add(this.stations.points);
    this.resize();
  }

  /** Country pressure and alarm, both 0-1, then pushed to the GPU in one go */
  setCountry(index: number, pressure: number, alarm: number) {
    this.dots?.set(index, pressure, alarm);
  }

  flushCountries() {
    this.dots?.flush();
  }

  setPalette(palette: Palette, dark: boolean) {
    for (const [name, colour] of Object.entries(palette) as [
      keyof Palette,
      Palette[keyof Palette]
    ][]) {
      this.palette[name].copy(colour);
    }
    this.sphere.uniforms.uGlow.value = dark ? 0.9 : 0.5;
    const inks = [this.arcs.mesh.material, this.rings.mesh.material, this.nodes.points.material];
    setBlending(inks as ShaderMaterial[], dark ? AdditiveBlending : NormalBlending);
  }

  /** Room taken by the chrome above and below, so the globe sits in the space that's left */
  setInsets(top: number, bottom: number) {
    this.insets = { top, bottom };
    this.resize();
  }

  setLayers(layers: Layers) {
    this.layers = layers;
    this.nodes.points.visible = layers.networks;
    if (this.stations) this.stations.points.visible = layers.stations;
    this.sphere.uniforms.uDaylight.value = layers.daylight ? 1 : 0;
    this.controls.autoRotate = layers.spin;
  }

  /** Inks a route hop by hop, from the network that started it to the one that told us */
  route(points: [number, number][], asns: number[], kind: Kind) {
    const show = kind === 1 ? this.layers.withdrawals : this.layers.routes || kind > 2;
    const at = points.map(([lat, lon]) => toVector(lat, lon));
    let time = this.now;
    this.pending.push({ time, asn: asns[0], at: at[0], kind });
    for (let i = 1; i < at.length; i++) {
      const angle = at[i - 1].angleTo(at[i]);
      if (angle > 0.004 && show) {
        const duration = 0.35 + (1.2 * angle) / Math.PI;
        this.arcs.add(at[i - 1], at[i], time, duration, kind);
        time += duration * 0.8;
      }
      this.pending.push({ time, asn: asns[i], at: at[i], kind });
    }
  }

  ripple([lat, lon]: [number, number], kind: Kind, size = 0.05) {
    if (kind === 1 && !this.layers.withdrawals) return;
    this.rings.add(toVector(lat, lon), this.now, 2.4, kind, size);
  }

  focus(asns: Set<number> | null) {
    this.nodes.focus(asns);
    this.arcs.uniforms.uDim.value = asns ? 0.25 : 1;
    this.rings.uniforms.uDim.value = asns ? 0.25 : 1;
  }

  where(asn: number) {
    const at = this.nodes.where(asn);
    return at && toLatLon(at);
  }

  flyTo([lat, lon]: [number, number], closer = false) {
    const distance = this.camera.position.length();
    this.flight = {
      from: this.camera.position.clone().normalize(),
      to: toVector(lat + 8, lon),
      fromDistance: distance,
      toDistance: closer ? Math.min(distance, this.fit * 0.72) : distance,
      start: this.now
    };
    this.holdSpin();
  }

  /** Turns the globe by a few degrees, for the arrow keys */
  nudge(dLon: number, dLat: number) {
    const [lat, lon] = toLatLon(this.camera.position);
    const distance = this.camera.position.length();
    this.camera.position.copy(
      toVector(Math.max(-80, Math.min(80, lat + dLat)), lon - dLon, distance)
    );
    this.holdSpin();
  }

  zoom(factor: number) {
    const distance = this.camera.position.length() * factor;
    this.camera.position.setLength(
      Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, distance))
    );
  }

  /** The network under a finger or pointer, if there's one close enough */
  pick(x: number, y: number, reach = 22) {
    const box = this.canvas.getBoundingClientRect();
    const facing = this.camera.position.clone().normalize();
    let best: { asn: number; distance: number } | undefined;
    for (const { asn, at } of this.nodes.visible(this.now)) {
      if (at.dot(facing) < 0.15) continue;
      const screen = at.clone().project(this.camera);
      const dx = ((screen.x + 1) / 2) * box.width - (x - box.left);
      const dy = ((1 - screen.y) / 2) * box.height - (y - box.top);
      const distance = Math.hypot(dx, dy);
      if (distance < reach && (!best || distance < best.distance)) best = { asn, distance };
    }
    return best?.asn;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.spinTimer);
    this.resizer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private holdSpin() {
    this.controls.autoRotate = false;
    clearTimeout(this.spinTimer);
    this.spinTimer = setTimeout(
      () => (this.controls.autoRotate = this.layers.spin),
      RESUME_SPIN_MS
    );
  }

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const { top, bottom } = this.insets;
    this.camera.setViewOffset(width, height, 0, (bottom - top) / 2, width, height);
    // far enough back that the whole globe fits the room it's got, with a bit of air
    const half = (this.camera.fov * Math.PI) / 360;
    const room = Math.atan((Math.tan(half) * (height - top - bottom)) / height);
    const narrow = Math.min(room, Math.atan(Math.tan(half) * this.camera.aspect));
    this.fit = (width < height ? 1.03 : 1.1) / Math.sin(narrow);
    this.controls.minDistance = 1.25;
    this.controls.maxDistance = this.fit * 1.6;
    if (!this.frame) this.camera.position.setLength(this.fit);
    this.arcs.uniforms.uPixel.value = (2 * Math.tan(half)) / height;
    this.arcs.uniforms.uWidth.value = 1.6 + 0.6 * ratio;
    this.nodes.uniforms.uPixelRatio.value = ratio;
    this.nodes.uniforms.uRef.value = this.fit;
    if (this.stations) this.stations.uniforms.uPixelRatio.value = ratio;
    if (this.dots) {
      this.dots.uniforms.uRef.value = this.fit;
      // fewer, chunkier dots read better on a small screen
      this.dots.uniforms.uSize.value = ratio * Math.max(1.6, Math.min(width, height) / 340);
    }
  }

  private tick = () => {
    const now = this.now;
    if (this.flight) this.fly(now);
    this.controls.rotateSpeed = 0.25 + 0.25 * (this.camera.position.length() - 1);
    this.controls.update();
    for (const uniforms of [this.arcs.uniforms, this.rings.uniforms, this.nodes.uniforms]) {
      uniforms.uTime.value = now;
    }
    const due = this.pending.filter((hit) => hit.time <= now);
    if (due.length) {
      this.pending = this.pending.filter((hit) => hit.time > now);
      for (const hit of due) this.nodes.hit(hit.asn, hit.at, hit.time, hit.kind);
    }
    if (this.frame % 600 === 0) this.sphere.uniforms.uSun.value.copy(toVector(...subsolar()));
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };

  private fly(now: number) {
    const { from, to, fromDistance, toDistance, start } = this.flight!;
    const progress = Math.min((now - start) / FLIGHT_SECONDS, 1);
    const eased = easeOut(progress);
    const turn = new Quaternion().setFromUnitVectors(from, to);
    const direction = from.clone().applyQuaternion(new Quaternion().slerp(turn, eased));
    this.camera.position.copy(
      direction.setLength(fromDistance + (toDistance - fromDistance) * eased)
    );
    if (progress === 1) this.flight = undefined;
  }
}
