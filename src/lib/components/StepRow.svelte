<script lang="ts">
  import { number } from '#lib/words.ts';

  // the last minute, a second per step, and the newest one always lit
  let { steps }: { steps: number[] } = $props();
  const peak = $derived(Math.max(...steps, 1));
  const now = $derived(steps.at(-1) ?? 0);
</script>

<div
  class="steps"
  role="img"
  aria-label="Route updates a second over the last minute. {number(
    now
  )} just now, peaking at {number(peak)}."
>
  {#each steps as step, i (i)}
    <span class:now={i === steps.length - 1} style:--level={step / peak}></span>
  {/each}
</div>

<style>
  .steps {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 1.75rem;

    span {
      flex: 1;
      height: calc(8% + var(--level) * 92%);
      background: var(--text-muted);
      opacity: 0.45;
      border-radius: 1px;
      transition: height 0.4s var(--ease-out);
    }

    .now {
      background: var(--cool);
      opacity: 1;
    }
  }
</style>
