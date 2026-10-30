<script lang="ts">
  import type { Severity } from '#lib/bgp/types.ts';

  // weather chart symbols: a cold front's triangle, a warm front's bump, a station circle
  let { severity }: { severity: Severity } = $props();
  const words: Record<Severity, string> = { high: 'Serious', medium: 'Worth a look', low: 'Minor' };
</script>

<svg
  class={severity}
  viewBox="0 0 16 16"
  width="16"
  height="16"
  role="img"
  aria-label={words[severity]}
>
  {#if severity === 'high'}
    <path d="M2 13h12M4 13l4-8 4 8z" />
  {:else if severity === 'medium'}
    <path d="M2 12h12M4 12a4 4 0 0 1 8 0z" />
  {:else}
    <circle cx="8" cy="8" r="3.5" />
  {/if}
</svg>

<style>
  svg {
    flex: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .high {
    fill: var(--alarm);
    stroke: var(--alarm);
  }

  .medium {
    fill: var(--warm);
    stroke: var(--warm);
  }

  .low {
    fill: none;
    stroke: var(--text-muted);
  }
</style>
