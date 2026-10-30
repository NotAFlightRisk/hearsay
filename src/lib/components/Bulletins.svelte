<script lang="ts">
  import type { Incident } from '#lib/bgp/types.ts';
  import type { Live } from '#lib/live.svelte.ts';
  import { ago, describe, number } from '#lib/words.ts';
  import Front from './Front.svelte';
  import Icon from './Icon.svelte';

  let { live }: { live: Live } = $props();

  const kinds: Record<Incident['kind'], string> = {
    outage: 'Outage',
    leak: 'Route leak',
    hijack: 'Possible hijack'
  };

  const severity = (incident: Incident) =>
    incident.end ? 'low' : incident.kind === 'outage' ? 'high' : 'medium';
</script>

<section aria-labelledby="spotted">
  <h2 id="spotted">Spotted live</h2>
  <p class="note">
    Picked out of what {live.source === 'relay' ? 'all' : 'our'}
    {live.peers.listening} peers are telling us, by rules of thumb. Treat them as hunches.
  </p>
  {#if live.anomalies.length}
    <ol>
      {#each live.anomalies as anomaly (anomaly.id)}
        {@const words = describe(anomaly, live.nameOf)}
        <li>
          <Front severity={anomaly.severity} />
          <div>
            <h3>{words.title}</h3>
            <p>{words.detail}</p>
            <p class="measures">
              <span>{number(anomaly.prefixes)} prefixes</span>
              <span>{number(anomaly.peers)} {anomaly.peers === 1 ? 'peer' : 'peers'}</span>
              <span>{ago(anomaly.last)}</span>
            </p>
          </div>
          {#if anomaly.asn}
            <button
              type="button"
              class="show"
              onclick={() => live.select(anomaly.asn)}
              aria-label="Show AS{anomaly.asn} on the globe"
            >
              <Icon name="target" size={18} />
            </button>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">
      Nothing odd yet. Leaks, hijacks and outages show up here the moment the rules spot one, and it
      can take a few minutes to learn what normal looks like.
    </p>
  {/if}
</section>

<section aria-labelledby="confirmed">
  <h2 id="confirmed">Confirmed elsewhere</h2>
  <p class="note">
    From people who watch the whole internet{live.radar ? ': Cloudflare Radar and IODA' : ': IODA'}.
    The last couple of days.
  </p>
  {#if live.incidents.length}
    <ol>
      {#each live.incidents as incident (incident.id)}
        <li>
          <Front severity={severity(incident)} />
          <div>
            <h3>
              <span class="kind">{kinds[incident.kind]}</span>
              {incident.title}
              {#if incident.end}<span class="cleared">Cleared</span>{/if}
            </h3>
            {#if incident.detail}<p>{incident.detail}</p>{/if}
            <p class="measures">
              {#if incident.prefixes}<span>{number(incident.prefixes)} prefixes</span>{/if}
              <span>started {ago(Date.parse(incident.start))}</span>
              {#if incident.url}
                <a href={incident.url} rel="external noopener" target="_blank"
                  >{incident.source}<Icon name="out" size={14} /></a
                >
              {:else}
                <span>{incident.source}</span>
              {/if}
            </p>
          </div>
          {#if incident.asns[0]}
            <button
              type="button"
              class="show"
              onclick={() => live.select(incident.asns[0])}
              aria-label="Show AS{incident.asns[0]} on the globe"
            >
              <Icon name="target" size={18} />
            </button>
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">
      Nothing confirmed right now, or the sources didn't answer. It checks again every ten minutes.
    </p>
  {/if}
</section>

<style>
  section + section {
    margin-top: var(--space-6);
  }

  h2 {
    font-size: var(--text-md);
  }

  .note,
  .empty {
    margin: var(--space-1) 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  ol {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-3);
    align-items: start;
    padding: var(--space-3) 0;
    border-top: 1px solid var(--rule);

    :global(svg[role='img']) {
      margin-top: 0.2rem;
    }

    p {
      margin: var(--space-1) 0 0;
      font-size: var(--text-sm);
    }
  }

  h3 {
    font-size: var(--text-sm);
    font-weight: 650;
  }

  .kind {
    display: block;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .cleared {
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border: 1px solid var(--rule);
    border-radius: 3px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .measures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs) !important;
    font-variant-numeric: tabular-nums;

    a {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }
  }

  .show {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid var(--rule);
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;

    &:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
  }
</style>
