<script lang="ts">
  import type { Live } from '#lib/live.svelte.ts';
  import type { Settings, Theme } from '#lib/settings.ts';
  import { levels, type Level } from '#lib/stream/protocol.ts';
  import { number } from '#lib/words.ts';

  let { live, settings = $bindable() }: { live: Live; settings: Settings } = $props();

  let target = $state('');
  let problem = $state('');

  const levelWords: Record<Level, string> = {
    light: 'Light, kind to a phone plan',
    standard: 'Standard',
    busy: 'Busy, for a big screen'
  };
  const themes: Theme[] = ['auto', 'light', 'dark'];
  const layerWords = {
    routes: 'Routes as they spread',
    withdrawals: 'Withdrawals',
    networks: 'Networks',
    stations: 'RIS collectors',
    daylight: 'Day and night',
    spin: 'Turn slowly on its own'
  };

  function watch(event: SubmitEvent) {
    event.preventDefault();
    const text = target.trim().replace(/^as/i, '');
    problem = '';
    if (/^\d+$/.test(text)) live.watch({ asn: Number(text) });
    else if (/^[\d.]+\/\d+$|^[\da-f:]+\/\d+$/i.test(text))
      live.watch({ prefix: text.toLowerCase() });
    else problem = 'That needs to be an AS number like 13335, or a prefix like 1.1.1.0/24.';
  }

  const watching = $derived(
    live.watching && ('asn' in live.watching ? `AS${live.watching.asn}` : live.watching.prefix)
  );
</script>

<section aria-labelledby="watch-heading">
  <h2 id="watch-heading">Watch one network</h2>
  <p class="note">
    Hear about it from every RIS peer, not just ours, and see its routes inked darker.
  </p>
  {#if watching}
    <p class="watching">
      Watching <strong>{watching}</strong>
      <button type="button" onclick={() => live.watch(null)}>Stop</button>
    </p>
  {:else}
    <form onsubmit={watch}>
      <label class="visually-hidden" for="watch">AS number or prefix</label>
      <input
        id="watch"
        bind:value={target}
        placeholder="13335 or 1.1.1.0/24"
        autocomplete="off"
        spellcheck="false"
        aria-describedby="watch-problem"
      />
      <button type="submit">Watch</button>
    </form>
    <p id="watch-problem" class="problem" aria-live="polite">{problem}</p>
  {/if}
</section>

<fieldset>
  <legend>How much to listen to</legend>
  {#each Object.keys(levels) as Level[] as level (level)}
    <label class="choice">
      <input type="radio" name="level" value={level} bind:group={settings.level} />
      <span>{levelWords[level]} <small>{levels[level].peers} peers</small></span>
    </label>
  {/each}
  <p class="note">
    Using about {number(live.perSecond.kilobytes, 1)} KB a second, roughly
    {number((live.perSecond.kilobytes * 3600) / 1024)} MB an hour. It stops listening when you switch
    tabs.
  </p>
</fieldset>

<fieldset>
  <legend>On the globe</legend>
  {#each Object.entries(layerWords) as [key, words] (key)}
    <label class="choice">
      <input type="checkbox" bind:checked={settings.layers[key as keyof typeof layerWords]} />
      <span>{words}</span>
    </label>
  {/each}
</fieldset>

<fieldset>
  <legend>Theme</legend>
  <div class="row">
    {#each themes as theme (theme)}
      <label class="pill">
        <input type="radio" name="theme" value={theme} bind:group={settings.theme} />
        <span
          >{theme === 'auto'
            ? 'Match my device'
            : theme === 'light'
              ? 'Day chart'
              : 'Night chart'}</span
        >
      </label>
    {/each}
  </div>
</fieldset>

<style>
  section,
  fieldset {
    margin: 0 0 var(--space-5);
    padding: 0;
    border: 0;
  }

  h2,
  legend {
    padding: 0;
    font-size: var(--text-md);
    font-weight: 700;
  }

  .note {
    margin: var(--space-1) 0 var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  form {
    display: flex;
    gap: var(--space-2);
  }

  input:not([type]) {
    flex: 1;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--rule);
    border-radius: var(--radius-sm);
    background: var(--surface-raised);
    font-family: var(--font-mono);

    &::placeholder {
      color: var(--text-muted);
    }
  }

  button {
    min-height: 2.75rem;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 650;
    cursor: pointer;
  }

  .problem {
    margin: var(--space-1) 0 0;
    color: var(--alarm);
    font-size: var(--text-sm);
  }

  .watching {
    display: flex;
    align-items: center;
    gap: var(--space-3);

    strong {
      font-family: var(--font-mono);
    }

    button {
      margin-left: auto;
    }
  }

  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 2.75rem;
    cursor: pointer;

    small {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
  }

  input[type='radio'],
  input[type='checkbox'] {
    width: 1.1rem;
    height: 1.1rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .pill {
    position: relative;

    input {
      position: absolute;
      opacity: 0;
    }

    span {
      display: block;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--rule);
      border-radius: 999px;
      font-size: var(--text-sm);
      cursor: pointer;
    }

    input:checked + span {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
      font-weight: 650;
    }

    input:focus-visible + span {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
  }
</style>
