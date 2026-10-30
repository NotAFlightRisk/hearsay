<script lang="ts">
  import { onMount } from 'svelte';
  import type { Globe, Layers } from '#lib/globe/globe.ts';
  import { collectors } from '#lib/geo/collectors.ts';
  import type { World } from '#lib/geo/place.ts';

  interface Props {
    world: World;
    layers: Layers;
    onready: (globe: Globe) => void;
    onpick: (asn: number | null) => void;
    onfail: () => void;
  }

  let { world, layers, onready, onpick, onfail }: Props = $props();
  let host: HTMLDivElement;
  let globe = $state<Globe>();
  let pressed: { x: number; y: number; at: number } | undefined;

  const STEP = 6;

  function land() {
    const count = world.dots.length / 3;
    const positions = new Float32Array(count * 3);
    const countryOf = new Float32Array(count);
    const rad = Math.PI / 1800;
    for (let i = 0; i < count; i++) {
      const lat = world.dots[i * 3] * rad;
      const lon = world.dots[i * 3 + 1] * rad;
      const r = 1.002;
      positions.set(
        [r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lon)],
        i * 3
      );
      countryOf[i] = world.dots[i * 3 + 2];
    }
    return { positions, countryOf, countries: world.countries.length };
  }

  // three.js is most of the download, so the page draws first and the globe follows
  async function start() {
    const [{ Globe }, { prefersDark, readPalette }] = await Promise.all([
      import('#lib/globe/globe.ts'),
      import('#lib/globe/palette.ts')
    ]);
    const made = new Globe(host, readPalette(), prefersDark());
    made.setLand(land());
    made.setStations(Object.values(collectors).map(({ lat, lon }) => [lat, lon]));
    onready(made);
    const repaint = () =>
      requestAnimationFrame(() => made.setPalette(readPalette(), prefersDark()));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
    new MutationObserver(repaint).observe(document.documentElement, {
      attributeFilter: ['data-theme']
    });
    return made;
  }

  onMount(() => {
    const ready = start().then(
      (made) => (globe = made),
      () => onfail()
    );
    return () => void ready.then((made) => made?.dispose());
  });

  $effect(() => globe?.setLayers({ ...layers }));

  function down(event: PointerEvent) {
    pressed = { x: event.clientX, y: event.clientY, at: performance.now() };
  }

  // a tap, not the end of a drag
  function up(event: PointerEvent) {
    if (!pressed || !globe) return;
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    if (moved < 8 && performance.now() - pressed.at < 500) {
      onpick(
        globe.pick(event.clientX, event.clientY, event.pointerType === 'touch' ? 30 : 18) ?? null
      );
    }
    pressed = undefined;
  }

  function keys(event: KeyboardEvent) {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => globe?.nudge(-STEP, 0),
      ArrowRight: () => globe?.nudge(STEP, 0),
      ArrowUp: () => globe?.nudge(0, STEP),
      ArrowDown: () => globe?.nudge(0, -STEP),
      '+': () => globe?.zoom(0.85),
      '=': () => globe?.zoom(0.85),
      '-': () => globe?.zoom(1.18)
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="globe"
  bind:this={host}
  role="application"
  aria-roledescription="globe"
  aria-label="Live map of internet routing. Drag or use the arrow keys to turn it, plus and minus to zoom. Every bulletin it draws is listed in the menu."
  tabindex="0"
  onpointerdown={down}
  onpointerup={up}
  onkeydown={keys}
></div>

<style>
  .globe {
    position: absolute;
    inset: 0;
    touch-action: none;
    cursor: grab;

    &:active {
      cursor: grabbing;
    }

    &:focus-visible {
      outline-offset: -4px;
    }

    :global(canvas) {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
</style>
