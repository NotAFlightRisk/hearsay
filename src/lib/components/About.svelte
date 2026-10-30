<script lang="ts">
  import type { Live } from '#lib/live.svelte.ts';
  import { number } from '#lib/words.ts';

  let { live }: { live: Live } = $props();
  const analytics = Boolean(import.meta.env.PUBLIC_PLAUSIBLE_SCRIPT);
  const errors = Boolean(import.meta.env.PUBLIC_SENTRY_DSN);

  const key = [
    { ink: 'cool', words: 'A route being announced, inked from the network that owns it outwards' },
    { ink: 'occluded', words: 'A route that changed path' },
    { ink: 'warm', words: 'A route being withdrawn, with a ring where it was' },
    { ink: 'alarm', words: 'Something odd, drawn like a weather front' }
  ];
</script>

<h2>What you're looking at</h2>
<p>
  The internet is about 80,000 separate networks, each with an AS number, telling their neighbours
  which addresses they can reach. That gossip is BGP, and nobody checks most of it, so it really
  does run on hearsay.
</p>
{#if live.source === 'relay'}
  <p>
    Our relay listens to every router that feeds RIPE's
    <a href="https://ris-live.ripe.net/" rel="external">RIS Live</a>, {live.peers.heard
      ? number(live.peers.heard)
      : 'hundreds'} of them right now, and passes your browser a fair sample of the routes to draw. Everything
    it hears counts towards the land dots and the bulletins.
  </p>
{:else}
  <p>
    This globe is listening to {live.peers.listening || 'a few'} of the routers that feed RIPE's
    <a href="https://ris-live.ripe.net/" rel="external">RIS Live</a> and draws what they pass on as it
    happens. Usually our relay listens to all of them, but it isn't around right now.
  </p>
{/if}

<h3>The key</h3>
<ul class="key">
  {#each key as { ink, words } (ink)}
    <li><span class="swatch" style:--ink="var(--{ink})"></span>{words}</li>
  {/each}
  <li>
    <span class="dots" aria-hidden="true"></span>Land dots swell where there's more routing traffic,
    and go red during a confirmed outage
  </li>
  <li><span class="station" aria-hidden="true"></span>A RIS route collector</li>
</ul>

<h3>Where things are</h3>
<p>
  A network sits in the country it's registered in, near one of that country's bigger cities. That's
  a guess dressed up as a dot: plenty of networks span continents, and the city is picked from the
  AS number, not from where its routers are.
</p>

<h3>Where it comes from</h3>
<p>
  Routes from <a href="https://ris.ripe.net/" rel="external"
    >RIPE NCC's Routing Information Service</a
  >, network names and countries from
  <a href="https://ftp.ripe.net/ripe/asnames/" rel="external">RIPE's AS names list</a>, lookups from
  <a href="https://stat.ripe.net/" rel="external">RIPEstat</a>, confirmed incidents from
  {#if live.radar}<a href="https://radar.cloudflare.com/" rel="external">Cloudflare Radar</a> and{/if}
  <a href="https://ioda.inetintel.cc.gatech.edu/" rel="external">IODA</a>, and the map from
  <a href="https://www.naturalearthdata.com/" rel="external">Natural Earth</a>. Thanks to all of
  them.
</p>

<h3>Privacy</h3>
<p>
  No cookies and no accounts. Your browser talks straight to RIS Live and RIPEstat, so RIPE sees
  your IP address like any website would. Settings stay in your browser.
</p>
{#if analytics}
  <p>
    Visits are counted by our own Plausible, which doesn't track you across sites or keep personal
    data.
  </p>
{/if}
{#if errors}
  <p>
    If something breaks, the error (not you) gets sent to our own error tracker so it can be fixed.
  </p>
{/if}
<p>
  <a href="https://github.com/NotAFlightRisk/hearsay" rel="external">Source on GitHub</a>, MIT
  licensed.
</p>

<style>
  h2 {
    font-size: var(--text-md);
  }

  h3 {
    margin-top: var(--space-5);
    font-size: var(--text-sm);
  }

  p,
  li {
    font-size: var(--text-sm);
  }

  p {
    margin: var(--space-2) 0 0;
    max-width: 65ch;
  }

  .key {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 2rem 1fr;
      align-items: center;
      gap: var(--space-2);
    }
  }

  .swatch {
    height: 3px;
    border-radius: 2px;
    background: var(--ink);
  }

  .dots {
    height: 0.6rem;
    background: radial-gradient(circle, var(--globe-land) 40%, transparent 45%) 0 0 / 0.6rem 0.6rem;
  }

  .station {
    width: 0.8rem;
    height: 0.8rem;
    border: 2px solid var(--text);
    border-radius: 50%;
    background: radial-gradient(circle, var(--text) 25%, transparent 30%);
  }
</style>
