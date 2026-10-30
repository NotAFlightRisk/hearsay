<script lang="ts">
  import type { Live } from '#lib/live.svelte.ts';

  let { live }: { live: Live } = $props();
  const issued = $derived(
    live.forecast &&
      new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      })
  );
</script>

<h2>The routing forecast</h2>
<p class="note">
  Issued {issued} UTC from the last five minutes. Each region is where its networks are registered, and
  "poor" means something odd is going on there.
</p>
{#if live.forecast.length}
  <dl>
    {#each live.forecast as region (region.key)}
      <div class={region.visibility}>
        <dt>{region.name}</dt>
        <dd>{region.line}</dd>
      </div>
    {/each}
  </dl>
{:else}
  <p class="note">Listening. The first forecast's ready in a few seconds.</p>
{/if}

<style>
  h2 {
    font-size: var(--text-md);
  }

  .note {
    margin: var(--space-1) 0 var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  dl {
    display: grid;
    gap: var(--space-4);
    margin: 0;
  }

  dt {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  dd {
    margin: var(--space-1) 0 0;
    font-size: var(--text-md);
  }

  .moderate dt {
    color: var(--warm);
  }

  .poor dt {
    color: var(--alarm);
  }
</style>
