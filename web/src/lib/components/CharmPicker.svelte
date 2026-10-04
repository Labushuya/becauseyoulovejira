<script lang="ts">
	import { charmMove, charmOf, charmRows, charmSections, searchCharms } from '$lib/domain/charms';
	import CharmIcon from './CharmIcon.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Popover from './overlay/Popover.svelte';

	// Choice of the charm of a ticket or of the template of a rule (ADR-0062): a small button with the
	// current charm and its name, or a neutral "Charm wählen", opens a popover of the kind "panel"
	// (ADR-0025 section 5). In it a search field in the style of the app (UI-1), "Kein Charm" and the
	// charms of the catalog in a grid by group, as a listbox with groups (APG): the search filters by
	// name, search words and group; arrow down goes from the search into the grid, the arrows move
	// through it (up from the first row back to the search), Home and End to the first and last
	// option, Enter and Space choose, a letter goes on in the search, Enter in the search chooses the
	// first match. Choosing closes the popover and the focus goes back to the button; Esc closes
	// without a change. Each option names its charm (screen readers, tooltip, and a line below the
	// grid for the one under the pointer or the focus). On touch screens every target is 44 px high.
	let {
		value,
		onchoose,
		busy = false,
		error = null,
		errorId
	}: {
		/** The stored key; null (or a key the catalog does not know) for none. */
		value: string | null;
		/** A choice: a key, null for "Kein Charm". */
		onchoose: (charm: string | null) => void;
		/** The choice is being saved. */
		busy?: boolean;
		/** Error of the server at the field, below the button. */
		error?: string | null;
		errorId?: string;
	} = $props();

	const uid = $props.id();
	/** Key of the option "Kein Charm" in the grid. */
	const NONE = '';
	const ids = {
		search: `${uid}-search`,
		list: `${uid}-list`,
		count: `${uid}-count`
	};
	const errorElementId = $derived(errorId ?? `${uid}-error`);

	let query = $state('');
	/** The option that is the stop of Tab in the grid (roving tabindex). */
	let active = $state(NONE);
	/** The option under the pointer or with the focus, named below the grid. */
	let pointed = $state<string | null>(null);
	let searchInput = $state<HTMLInputElement>();

	const chosen = $derived(charmOf(value));
	const results = $derived(searchCharms(query));
	const sections = $derived(charmSections(results));
	const rows = $derived(charmRows(sections, NONE));
	const stop = $derived(rows.flat().includes(active) ? active : NONE);
	const searching = $derived(query.trim() !== '');
	const countText = $derived.by(() => {
		if (!searching) return '';
		if (results.length === 0) return `Kein Charm passt zu „${query.trim()}“.`;
		return results.length === 1 ? '1 Charm gefunden.' : `${results.length} Charms gefunden.`;
	});
	const pointedName = $derived(
		pointed === null ? '' : pointed === NONE ? 'Kein Charm' : (charmOf(pointed)?.name ?? '')
	);

	function optionId(key: string): string {
		return `${uid}-option-${key === NONE ? 'none' : key}`;
	}

	function focusOption(key: string) {
		active = key;
		document.getElementById(optionId(key))?.focus();
	}

	function choose(key: string, close: () => void) {
		const next = key === NONE ? null : key;
		close();
		if (next !== (chosen?.key ?? null)) onchoose(next);
	}

	function onopen() {
		query = '';
		pointed = null;
		active = chosen?.key ?? NONE;
	}

	function onsearchkeydown(event: KeyboardEvent, close: () => void) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusOption(searching ? (results[0]?.key ?? NONE) : stop);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const first = results[0];
			if (searching && first !== undefined) choose(first.key, close);
		}
	}

	function onoptionkeydown(event: KeyboardEvent, key: string) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const next = charmMove(rows, key, event.key);
		if (next !== null) {
			event.preventDefault();
			focusOption(next);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			searchInput?.focus();
		} else if (event.key.length === 1 && event.key !== ' ') {
			// A letter goes on in the search, as in the lists of the system.
			event.preventDefault();
			query += event.key;
			searchInput?.focus();
		}
	}
</script>

{#snippet option(key: string, close: () => void)}
	{@const entry = charmOf(key)}
	{@const selected = key === NONE ? chosen === null : chosen?.key === key}
	<button
		class={key === NONE ? 'button-secondary button-small none' : 'button-icon option'}
		class:selected
		type="button"
		role="option"
		id={optionId(key)}
		aria-selected={selected ? 'true' : 'false'}
		tabindex={key === stop ? 0 : -1}
		title={entry?.name}
		data-charm-option={key === NONE ? 'none' : key}
		onclick={() => choose(key, close)}
		onkeydown={(event) => onoptionkeydown(event, key)}
		onfocus={() => {
			active = key;
			pointed = key;
		}}
		onpointerenter={() => (pointed = key)}
		onpointerleave={() => (pointed = null)}
	>
		{#if entry === null}
			<svg class="no-charm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
				<circle cx="12" cy="12" r="8" />
			</svg>
			Kein Charm
		{:else}
			<CharmIcon charm={entry.key} named={false} size="choice" />
			<span class="visually-hidden">{entry.name}</span>
		{/if}
	</button>
{/snippet}

<span class="charm-picker" aria-busy={busy ? 'true' : undefined}>
	<Popover
		kind="panel"
		label="Charm wählen"
		buttonClass="button-secondary button-small charm-trigger"
		buttonLabel={chosen === null ? 'Charm wählen' : `Charm: ${chosen.name}`}
		buttonDescribedby={error ? errorElementId : undefined}
		initialFocus={() => searchInput ?? null}
		{onopen}
	>
		{#snippet button()}
			{#if chosen === null}
				<svg class="no-charm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<circle cx="12" cy="12" r="8" />
				</svg>
				<span>Charm wählen</span>
			{:else}
				<CharmIcon charm={chosen.key} named={false} size="choice" />
				<span>{chosen.name}</span>
			{/if}
		{/snippet}
		{#snippet children({ close })}
			<div class="dialog">
				<span class="search-field">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.25" />
						<path d="M10.25 10.25L13.5 13.5" />
					</svg>
					<input
						id={ids.search}
						type="search"
						autocomplete="off"
						spellcheck="false"
						aria-label="Charm suchen"
						aria-controls={ids.list}
						aria-describedby={countText === '' ? undefined : ids.count}
						placeholder="Suchen, z. B. Geburtstag"
						bind:value={query}
						bind:this={searchInput}
						onkeydown={(event) => onsearchkeydown(event, close)}
					/>
				</span>
				<p class="count" id={ids.count} role="status">{countText}</p>
				<div class="options" role="listbox" id={ids.list} aria-label="Charms">
					{@render option(NONE, close)}
					{#each sections as section (section.group)}
						{@const labelId = `${uid}-group-${section.group}`}
						<div class="group" role="group" aria-labelledby={labelId}>
							<span class="group-label" id={labelId} role="presentation">{section.label}</span>
							{#each section.charms as entry (entry.key)}
								{@render option(entry.key, close)}
							{/each}
						</div>
					{/each}
				</div>
				<p class="pointed" aria-hidden="true">{pointedName}</p>
			</div>
		{/snippet}
	</Popover>
	{#if error}
		<p class="field-error" id={errorElementId}><ErrorIcon /><span>{error}</span></p>
	{/if}
</span>

<style>
	.charm-picker {
		display: inline-grid;
		gap: 0.25rem;
		justify-items: start;
		min-width: 0;
	}

	/* The symbols of the button and of "Kein Charm": the neutral one is a dashed circle. */
	.no-charm {
		flex: none;
		width: 1.125rem;
		height: 1.125rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-dasharray: 3 3;
		color: var(--color-text-muted);
	}

	.dialog {
		display: grid;
		gap: 0.5rem;
		width: max-content;
		max-width: 100%;
	}

	.search-field {
		width: 100%;
	}

	.count:empty {
		display: none;
	}

	.count {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.options {
		display: grid;
		gap: 0.5rem;
	}

	.none {
		justify-content: flex-start;
		width: 100%;
	}

	/* Six columns, each group in its own rows (CHARM_COLUMNS of domain/charms.ts). */
	.group {
		display: grid;
		grid-template-columns: repeat(6, 2rem);
		gap: 0.25rem;
	}

	.group-label {
		grid-column: 1 / -1;
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.option {
		color: var(--color-text);
	}

	/* The chosen charm: the accent surface and a frame, not color alone. */
	.selected.option,
	.selected.none {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.pointed {
		min-height: 1.25rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	/* Touch screens: 44 px targets (UI-1, ADR-0060). */
	@media (pointer: coarse) {
		.group {
			grid-template-columns: repeat(6, var(--control-height-touch));
		}

		.option {
			width: var(--control-height-touch);
			height: var(--control-height-touch);
		}
	}
</style>
