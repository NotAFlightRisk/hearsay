<script lang="ts">
  import type { Live } from '#lib/live.svelte.ts';
  import Icon from './Icon.svelte';

  let { live, open, ontoggle }: { live?: Live; open: boolean; ontoggle: () => void } = $props();

  const status = $derived(live?.status ?? 'loading');
  const words = $derived(
    {
      loading: 'Getting ready',
      connecting: 'Connecting',
      live: `Live from ${live?.peers.heard || live?.peers.listening} peers`,
      paused: 'Paused while hidden',
      offline: 'Reconnecting'
    }[status]
  );
</script>

<header>
  <h1>hearsay</h1>
  <p class="status" data-status={status} role="status">
    <span class="light" aria-hidden="true"></span>{words}
  </p>
  <button
    id="menu-button"
    class="menu"
    type="button"
    aria-expanded={open}
    aria-controls="menu"
    aria-label={open ? 'Close the menu' : 'Open the menu'}
    onclick={ontoggle}
  >
    <Icon name={open ? 'close' : 'menu'} />
  </button>
</header>

<style>
  header {
    position: absolute;
    inset: 0 0 auto;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: max(var(--space-3), env(safe-area-inset-top)) var(--edge) var(--space-3);
    pointer-events: none;

    > * {
      pointer-events: auto;
    }
  }

  h1 {
    font-size: var(--text-lg);
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .light {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--text-muted);

    [data-status='live'] & {
      background: var(--cool);
      animation: breathe 2.4s ease-in-out infinite;
    }

    [data-status='offline'] & {
      background: var(--warm);
    }
  }

  .menu {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    margin-left: auto;
    border: 1px solid var(--rule);
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: var(--surface-raised);
    }
  }

  @keyframes breathe {
    50% {
      opacity: 0.35;
    }
  }
</style>
