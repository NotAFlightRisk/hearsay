<script lang="ts">
  import { fly } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Live } from '#lib/live.svelte.ts';
  import { ago, countryName, number } from '#lib/words.ts';
  import Icon from './Icon.svelte';

  let { live, asn }: { live: Live; asn: number } = $props();
  const calm = new MediaQuery('prefers-reduced-motion: reduce');
  const name = $derived(live.nameOf(asn));
  const network = $derived(live.network);
  const watched = $derived(live.watching && 'asn' in live.watching && live.watching.asn === asn);
  const links = $derived([
    { name: 'bgp.tools', href: `https://bgp.tools/as/${asn}` },
    { name: 'RIPEstat', href: `https://stat.ripe.net/AS${asn}` },
    { name: 'PeeringDB', href: `https://www.peeringdb.com/asn/${asn}` },
    { name: 'Radar', href: `https://radar.cloudflare.com/as${asn}` }
  ]);
</script>

<section
  class="card"
  aria-labelledby="network-name"
  transition:fly={{ duration: calm.current ? 0 : 240, y: 24 }}
>
  <header>
    <div>
      <p class="asn">AS{asn}</p>
      <h2 id="network-name">
        {name === undefined ? 'Looking it up…' : name || 'No name on record'}
      </h2>
      {#if countryName(network?.country)}<p class="where">
          Registered in {countryName(network?.country)}
        </p>{/if}
    </div>
    <button class="close" type="button" aria-label="Close" onclick={() => live.select(null)}>
      <Icon name="close" size={18} />
    </button>
  </header>

  <dl>
    <div>
      <dt>Routes announced</dt>
      <dd>{number(network?.announced ?? 0)}</dd>
    </div>
    <div>
      <dt>Withdrawn</dt>
      <dd>{number(network?.withdrawn ?? 0)}</dd>
    </div>
    <div>
      <dt>Prefixes seen</dt>
      <dd>{number(network?.prefixes ?? 0)}</dd>
    </div>
  </dl>
  <p class="since">
    Since you opened the page{network?.lastSeen ? `, last heard ${ago(network.lastSeen)}` : ''}.
    Only routes it starts are counted, not ones it passes along.
  </p>

  {#if network?.upstreams.length}
    <p class="upstreams">
      Reaches the world through
      {#each network.upstreams as upstream, i (upstream)}
        <button type="button" class="link" onclick={() => live.select(upstream)}
          >AS{upstream}</button
        >{i < network.upstreams.length - 1 ? ', ' : ''}
      {/each}
    </p>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="watch"
      aria-pressed={!!watched}
      onclick={() => live.watch(watched ? null : { asn })}
    >
      <Icon name="eye" size={18} />{watched ? 'Watching' : 'Watch it'}
    </button>
    <nav aria-label="More about AS{asn}">
      {#each links as link (link.name)}
        <a href={link.href} rel="external noopener" target="_blank">{link.name}</a>
      {/each}
    </nav>
  </div>
</section>

<style>
  .card {
    position: absolute;
    inset: auto var(--edge) max(var(--space-3), env(safe-area-inset-bottom));
    z-index: 3;
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);

    @media (min-width: 60rem) {
      inset: 4.5rem auto auto var(--edge);
      width: 22rem;
    }
  }

  header {
    display: flex;
    align-items: start;
    gap: var(--space-3);

    div {
      flex: 1;
      min-width: 0;
    }
  }

  .asn {
    margin: 0;
    color: var(--cool);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  h2 {
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }

  .where,
  .since,
  .upstreams {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .close {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid var(--rule);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3) 0;
    border-block: 1px solid var(--rule);

    dt {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }

    dd {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--text-lg);
      font-variant-numeric: tabular-nums;
    }
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-family: var(--font-mono);
    text-decoration: underline;
    text-underline-offset: 0.18em;
    cursor: pointer;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);

    nav {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      font-size: var(--text-sm);
    }
  }

  .watch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: transparent;
    color: var(--accent);
    font-weight: 650;
    cursor: pointer;

    &[aria-pressed='true'] {
      background: var(--accent);
      color: var(--on-accent);
    }
  }
</style>
