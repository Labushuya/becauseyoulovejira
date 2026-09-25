<script lang="ts">
	import Popover from '$lib/components/overlay/Popover.svelte';

	// Test harness for the popover building block (popover.test.ts): a menu with three entries,
	// or a panel with a named fieldset of radios, next to an outside button for leaving it.
	let {
		kind,
		onchoose = () => undefined
	}: { kind: 'menu' | 'panel'; onchoose?: (value: string) => void } = $props();

	let chosen = $state('b');
	const entries = ['a', 'b', 'c'];
</script>

<button type="button">Davor</button>
{#if kind === 'menu'}
	<Popover kind="menu" label="Auswahl" buttonLabel="Auswahl öffnen" placement="bottom-end">
		{#snippet button()}Symbol{/snippet}
		{#snippet children({ close })}
			{#each entries as entry (entry)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={chosen === entry}
					tabindex="-1"
					onclick={() => {
						chosen = entry;
						onchoose(entry);
						close();
					}}
				>
					Eintrag {entry.toUpperCase()}
				</button>
			{/each}
		{/snippet}
	</Popover>
{:else}
	<Popover kind="panel" labelledby="harness-legend">
		{#snippet button()}Filter{/snippet}
		{#snippet children({ close })}
			<fieldset>
				<legend id="harness-legend">Filter wählen</legend>
				{#each entries as entry (entry)}
					<label>
						<input
							type="radio"
							name="harness"
							value={entry}
							checked={chosen === entry}
							onchange={() => (chosen = entry)}
						/>
						Wert {entry.toUpperCase()}
					</label>
				{/each}
			</fieldset>
			<button type="button" onclick={close}>Fertig</button>
		{/snippet}
	</Popover>
{/if}
<button type="button">Danach</button>
