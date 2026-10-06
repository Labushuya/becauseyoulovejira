<script lang="ts">
	import { normalizeTitle, type InboxItemSummary } from '$lib/domain/inbox';
	import { sourceChannelLabel, sourceOrigin, sourceWhen } from '$lib/domain/sources';
	import ErrorIcon from './ErrorIcon.svelte';

	// Choosing new entries of the inbox as sources of a ticket (ADR-0031 section 7): a search over title,
	// sender, chat and address and one checkbox per entry with its channel, date and origin. One building
	// block for "Quelle hinzufügen …" of a ticket and "Neues Ticket" (NT-1). `chosen` is replaced as a
	// whole on every change.
	let {
		candidates,
		chosen = $bindable([]),
		legend = 'Neue Einträge im Eingang',
		error = null,
		onchange = () => undefined
	}: {
		/** The new entries of the inbox. */
		candidates: readonly InboxItemSummary[];
		/** IDs of the chosen entries. */
		chosen?: string[];
		legend?: string;
		/** A refusal at the list (ADR-0009). */
		error?: string | null;
		onchange?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = { search: `${uid}-search`, error: `${uid}-error` };

	let query = $state('');

	const shown = $derived.by(() => {
		const needle = normalizeTitle(query);
		if (needle === '') return candidates;
		return candidates.filter((item) =>
			normalizeTitle(`${item.title} ${sourceOrigin(item)}`).includes(needle)
		);
	});

	function toggle(id: string, on: boolean) {
		chosen = on
			? [...chosen.filter((entry) => entry !== id), id]
			: chosen.filter((entry) => entry !== id);
		onchange();
	}
</script>

<div class="entries">
	<span class="search-field search">
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<circle cx="7" cy="7" r="4.25" />
			<path d="M10.25 10.25L13.5 13.5" />
		</svg>
		<input
			id={ids.search}
			type="search"
			autocomplete="off"
			spellcheck="false"
			aria-label="Einträge durchsuchen"
			placeholder="Suchen"
			bind:value={query}
		/>
	</span>
	<fieldset aria-describedby={error ? ids.error : undefined}>
		<legend>{legend}</legend>
		{#if shown.length === 0}
			<p class="hint" role="status">Keine Treffer.</p>
		{:else}
			<ul class="candidates">
				{#each shown as item (item.id)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={chosen.includes(item.id)}
								onchange={(event) => toggle(item.id, event.currentTarget.checked)}
							/>
							<span class="text">
								<span class="title">{item.title}</span>
								<span class="meta">
									{[sourceChannelLabel(item), sourceWhen(item), sourceOrigin(item)]
										.filter((part) => part !== '')
										.join(' · ')}
								</span>
							</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</fieldset>
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
</div>

<style>
	.entries {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.search {
		width: 100%;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.375rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.candidates {
		display: grid;
		gap: 0.25rem;
		max-height: 20rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
		padding: 0.375rem 0.25rem;
		cursor: pointer;
	}

	.text {
		display: grid;
		min-width: 0;
	}

	.title {
		overflow-wrap: anywhere;
	}

	.meta,
	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
</style>
