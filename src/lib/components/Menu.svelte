<script lang="ts" module>
  export const tabs = ['bulletins', 'forecast', 'settings', 'about'] as const;
  export type Tab = (typeof tabs)[number];
</script>

<script lang="ts">
  import { fly } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Live } from '#lib/live.svelte.ts';
  import type { Settings as Choices } from '#lib/settings.ts';
  import About from './About.svelte';
  import Bulletins from './Bulletins.svelte';
  import Forecast from './Forecast.svelte';
  import Settings from './Settings.svelte';

  interface Props {
    live: Live;
    settings: Choices;
    tab: Tab;
  }

  let { live, settings = $bindable(), tab = $bindable() }: Props = $props();
  const calm = new MediaQuery('prefers-reduced-motion: reduce');
  const wide = new MediaQuery('min-width: 60rem');
  const names: Record<Tab, string> = {
    bulletins: 'Bulletins',
    forecast: 'Forecast',
    settings: 'Settings',
    about: 'About'
  };

  function keys(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    tab = next;
    document.getElementById(`tab-${next}`)?.focus();
  }
</script>

<aside
  id="menu"
  aria-label="Menu"
  transition:fly={{
    duration: calm.current ? 0 : 280,
    x: wide.current ? 32 : 0,
    y: wide.current ? 0 : 40
  }}
>
  <div class="tabs" role="tablist" aria-label="Menu sections" tabindex="-1" onkeydown={keys}>
    {#each tabs as each (each)}
      <button
        id="tab-{each}"
        type="button"
        role="tab"
        aria-selected={tab === each}
        aria-controls="panel-{each}"
        tabindex={tab === each ? 0 : -1}
        onclick={() => (tab = each)}
      >
        {names[each]}
        {#if each === 'bulletins' && live.anomalies.length}
          <span class="count">{live.anomalies.length}</span>
        {/if}
      </button>
    {/each}
  </div>
  <div class="panel" id="panel-{tab}" role="tabpanel" aria-labelledby="tab-{tab}" tabindex="-1">
    {#if tab === 'bulletins'}
      <Bulletins {live} />
    {:else if tab === 'forecast'}
      <Forecast {live} />
    {:else if tab === 'settings'}
      <Settings {live} bind:settings />
    {:else}
      <About {live} />
    {/if}
  </div>
</aside>

<style>
  aside {
    position: absolute;
    inset: auto var(--edge) max(var(--space-3), env(safe-area-inset-bottom));
    z-index: 4;
    display: flex;
    flex-direction: column;
    max-height: min(78dvh, 44rem);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);

    @media (min-width: 60rem) {
      inset: 4.5rem var(--edge) var(--space-3) auto;
      width: 25rem;
      max-height: none;
    }
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2);
    border-bottom: 1px solid var(--rule);
    overflow-x: auto;

    button {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 2.5rem;
      padding: 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-muted);
      font-size: var(--text-sm);
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;

      &:hover {
        color: var(--text);
      }

      &[aria-selected='true'] {
        background: var(--surface-raised);
        color: var(--text);
        box-shadow: inset 0 -2px 0 var(--accent);
      }
    }
  }

  .count {
    min-width: 1.25rem;
    padding: 0 var(--space-1);
    border-radius: 999px;
    background: var(--rule);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .panel {
    flex: 1;
    min-height: 0;
    padding: var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
