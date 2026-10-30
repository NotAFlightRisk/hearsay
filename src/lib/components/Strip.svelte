<script lang="ts">
  import type { Live } from '#lib/live.svelte.ts';
  import { describe, number } from '#lib/words.ts';
  import Front from './Front.svelte';
  import StepRow from './StepRow.svelte';

  let { live, onbulletins }: { live: Live; onbulletins: () => void } = $props();

  const latest = $derived.by(() => {
    const anomaly = live.anomalies.find((each) => each.severity !== 'low');
    if (anomaly) return { severity: anomaly.severity, title: describe(anomaly, live.nameOf).title };
    const incident = live.incidents.find((each) => !each.end);
    if (incident) return { severity: 'medium' as const, title: incident.title };
  });
</script>

<section class="strip" aria-label="Right now">
  <button class="bulletin" type="button" onclick={onbulletins}>
    {#if latest}
      <Front severity={latest.severity} />
      <span class="title">{latest.title}</span>
    {:else}
      <span class="title quiet">Nothing odd in the last few minutes</span>
    {/if}
    <span class="more">Bulletins</span>
  </button>
  <div class="readouts">
    <p>
      <strong>{number(live.perSecond.updates)}</strong>
      <span>updates a second</span>
    </p>
    <p class="warm">
      <strong>{number(live.perSecond.withdrawn)}</strong>
      <span>withdrawals</span>
    </p>
    <StepRow steps={live.steps} />
  </div>
</section>

<style>
  .strip {
    position: absolute;
    inset: auto var(--edge) max(var(--space-3), env(safe-area-inset-bottom));
    z-index: 2;
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);

    @media (min-width: 60rem) {
      right: auto;
      width: 26rem;
    }
  }

  .bulletin {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--surface-raised);
    }
  }

  .title {
    flex: 1;
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quiet {
    color: var(--text-muted);
    font-weight: 400;
  }

  .more {
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .readouts {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: end;
    gap: var(--space-4);
    padding: 0 var(--space-2);

    p {
      display: grid;
      margin: 0;
    }

    strong {
      font-family: var(--font-mono);
      font-size: var(--text-lg);
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }

    span {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }

    .warm strong {
      color: var(--warm);
    }
  }
</style>
