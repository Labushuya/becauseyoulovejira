<script lang="ts">
	import { withConnectionName } from '$lib/domain/connections';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { matchesSourceWords, noEntryMatchText, searchHitsText } from '$lib/domain/source-search';
	import { sourceChannelLabel, sourceOrigin, sourceWhen } from '$lib/domain/sources';
	import { searchWords } from '$lib/domain/ticket-picker';
	import { findConnectionNames } from '$lib/stores/connection-names.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import ListSearch from './ListSearch.svelte';

	// Choosing new entries of the inbox as sources of a ticket (ADR-0031 section 7): a search and one
	// checkbox per entry with its channel (with the name of its connection), date and origin. One
	// building block for "Quelle hinzufügen …" of a ticket and "Neues Ticket" (NT-1). `chosen` is
	// replaced as a whole on every change.
	// Since QS-2 (ADR-0031 addendum N) the search compares like every search of the app (the words
	// and the normalisation of the ticket picker, `matchesSourceWords`): title, channel and
	// connection, date, sender, chat and address, without case, accents and umlaut dots, every word
	// somewhere. The new entries are all loaded (InboxStore, in full like the open tickets) and
	// follow realtime, so the search sees every one of them and no request is added. It says "3 von
	// 12" next to the field and once typing pauses; Escape empties it first. Chosen entries stay
	// chosen while a search hides them.
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
	const ids = { list: `${uid}-list`, error: `${uid}-error` };
	/** Names of the connections (ADR-0026, addendum KK-3); outside the (app) layout none. */
	const connectionNames = findConnectionNames();

	let query = $state('');

	const words = $derived(searchWords(query));
	const shown = $derived(
		words.length === 0
			? candidates
			: candidates.filter((item) => matchesSourceWords(item, words, nameOf(item)))
	);
	const count = $derived(
		words.length > 0 && shown.length > 0 ? searchHitsText(shown.length, candidates.length) : ''
	);
	const announcement = $derived(
		words.length === 0 ? '' : shown.length > 0 ? count : noEntryMatchText(query)
	);

	function nameOf(item: InboxItemSummary): string | null {
		return connectionNames?.nameOf(item.connectionId) ?? null;
	}

	function toggle(id: string, on: boolean) {
		chosen = on
			? [...chosen.filter((entry) => entry !== id), id]
			: chosen.filter((entry) => entry !== id);
		onchange();
	}
</script>

<div class="entries">
	<ListSearch
		bind:query
		label="Einträge durchsuchen"
		placeholder="Titel, Absender, Kanal oder Datum"
		{count}
		{announcement}
		controls={ids.list}
	/>
	<fieldset aria-describedby={error ? ids.error : undefined}>
		<legend>{legend}</legend>
		{#if words.length > 0 && shown.length === 0}
			<p class="hint">{noEntryMatchText(query)}</p>
		{/if}
		<!-- Always there, also empty, so the field can name the list it narrows. -->
		<ul class="candidates" id={ids.list}>
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
								{[
									withConnectionName(sourceChannelLabel(item), nameOf(item)),
									sourceWhen(item),
									sourceOrigin(item)
								]
									.filter((part) => part !== '')
									.join(' · ')}
							</span>
						</span>
					</label>
				</li>
			{/each}
		</ul>
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
