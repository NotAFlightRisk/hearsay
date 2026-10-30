<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import GlobeView from '#lib/components/GlobeView.svelte';
  import Masthead from '#lib/components/Masthead.svelte';
  import Menu, { type Tab } from '#lib/components/Menu.svelte';
  import NetworkCard from '#lib/components/NetworkCard.svelte';
  import Strip from '#lib/components/Strip.svelte';
  import type { World } from '#lib/geo/place.ts';
  import type { Globe } from '#lib/globe/globe.ts';
  import { Live } from '#lib/live.svelte.ts';
  import { site } from '#lib/meta.ts';
  import { loadSettings, saveSettings, type Settings } from '#lib/settings.ts';
  import type { Level } from '#lib/stream/protocol.ts';

  const title = "hearsay - the internet's routing, live on a globe";
  const description =
    'Watch BGP happen: routes being announced and withdrawn across the world in real time, with possible leaks, hijacks and outages picked out in plain words.';

  let world = $state<World>();
  let live = $state<Live>();
  let settings = $state<Settings>();
  let open = $state(false);
  let tab = $state<Tab>('bulletins');
  let broken = $state(false);
  let level: Level | undefined;

  onMount(() => {
    settings = loadSettings();
    level = settings.level;
    fetch('/data/world.json')
      .then((response) => response.json())
      .then((loaded: World) => {
        world = loaded;
        live = new Live(loaded, level!, (error) => reportError(error));
        const asn = Number(page.url.searchParams.get('as'));
        if (asn > 0) live.select(asn);
      })
      .catch((error) => {
        broken = true;
        reportError(error);
      });
    return () => live?.destroy();
  });

  $effect(() => {
    if (!settings) return;
    saveSettings($state.snapshot(settings));
    if (live && settings.level !== level) live.setLevel(settings.level);
    level = settings.level;
  });

  // a selected network is a link you can share
  $effect(() => {
    const selected = live?.selected;
    if (live === undefined) return;
    const url = new URL(location.href);
    if (selected) url.searchParams.set('as', String(selected));
    else url.searchParams.delete('as');
    if (url.href !== location.href) replaceState(url, {});
  });

  // on a phone the chrome eats the top and bottom, so the globe centres in what's left
  function makeRoom(globe: Globe) {
    const measure = () => {
      const narrow = innerWidth < 960;
      const top = narrow
        ? (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0)
        : 0;
      const strip = document.querySelector('.strip')?.getBoundingClientRect();
      globe.setInsets(top, narrow && strip ? innerHeight - strip.top : 0);
    };
    new ResizeObserver(measure).observe(document.body);
    measure();
  }

  async function toggle(show = !open, at?: Tab) {
    if (at) tab = at;
    open = show;
    await tick();
    document.getElementById(open ? `tab-${tab}` : 'menu-button')?.focus();
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (open) void toggle(false);
    else live?.select(null);
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href="{site}/" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="{site}/" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content="{site}/og.png" />
  <meta
    property="og:image:alt"
    content="A globe of the world with routes being inked across it in blue, amber and violet"
  />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<svelte:window onkeydown={escape} />

<main class:picked={live?.selected}>
  <p class="visually-hidden">{description}</p>
  {#if world && settings}
    <GlobeView
      {world}
      layers={settings.layers}
      onready={(globe) => {
        live?.attach(globe);
        makeRoom(globe);
      }}
      onpick={(asn) => live?.select(asn)}
      onfail={() => (broken = true)}
    />
  {/if}
  <Masthead {live} {open} ontoggle={() => toggle()} />
  {#if broken}
    <p class="broken">
      Your browser can't draw the globe here, as WebGL is switched off or missing. The bulletins and
      forecast in the menu still work.
    </p>
  {/if}
  {#if live && settings}
    {#if live.selected}
      <NetworkCard {live} asn={live.selected} />
    {/if}
    <Strip {live} onbulletins={() => toggle(true, 'bulletins')} />
    {#if open}
      <Menu {live} bind:settings bind:tab />
    {/if}
  {/if}
  <noscript>
    <p class="broken">
      hearsay draws live routing data in your browser, so it needs JavaScript switched on.
    </p>
  </noscript>
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    overflow: hidden;

    /* on a phone the network's card takes the strip's spot */
    @media (max-width: 59.99rem) {
      &.picked :global(.strip) {
        visibility: hidden;
      }
    }
  }

  .broken {
    position: absolute;
    inset: 40% var(--edge) auto;
    max-width: 30rem;
    margin: 0 auto;
    padding: var(--space-4);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: center;
  }
</style>
