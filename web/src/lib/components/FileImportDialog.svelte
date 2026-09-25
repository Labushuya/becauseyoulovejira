<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { sourceDateText } from '$lib/domain/inbox';
	import { IMPORT_KIND_LABELS } from '$lib/domain/keywords';
	import {
		preselectedKeys,
		type FileImportResult,
		type FileSelection,
		type SelectionEntry
	} from '$lib/stores/mail-import';
	import { IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE } from '$lib/stores/import-keywords.svelte';
	import Modal from './overlay/Modal.svelte';

	// Selection view of dropped mail and calendar files (E4 plan, package 21; ADR-0020) on the modal
	// building block (ADR-0025 section 3, size L), after the model of the WhatsApp import: one row
	// per mail and per event with a checkbox. Keyword matches are chosen at first; what is in the
	// inbox already is shown but cannot be chosen. Only the chosen entries are saved; the results
	// per file go back to the drop zone. ×, Escape and "Abbrechen" close without saving.
	let {
		selection,
		onsave,
		onclose
	}: {
		selection: FileSelection;
		onsave: (chosen: ReadonlySet<string>) => Promise<FileImportResult[]>;
		/** Results of the saved files, null when closed without saving. */
		onclose: (results: FileImportResult[] | null) => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		summary: `${uid}-summary`,
		count: `${uid}-count`
	};

	const KIND_TEXT: Readonly<Record<SelectionEntry['kind'], string>> = {
		mail: 'Mail',
		event: 'Termin',
		todo: 'Aufgabe'
	};

	let firstButton = $state<HTMLButtonElement>();
	const chosen = new SvelteSet<string>(untrack(() => preselectedKeys(selection)));
	let pending = $state(false);

	const open = $derived(selection.entries.filter((entry) => entry.blocked === ''));
	const chosenCount = $derived(open.filter((entry) => chosen.has(entry.key)).length);
	const preselected = $derived(preselectedKeys(selection).length);
	const missingLists = $derived(
		selection.withoutKeywords.map((kind) => IMPORT_KIND_LABELS[kind]).join(' und ')
	);

	function countText(count: number): string {
		return count === 1 ? '1 Eintrag' : `${count} Einträge`;
	}

	function when(entry: SelectionEntry): string {
		return sourceDateText({ sourceDate: entry.sourceDate, sourceMeta: { all_day: entry.allDay } });
	}

	/** "Mail · 24.09.2026 10:00 · Absender · datei.eml" */
	function metaLine(entry: SelectionEntry): string {
		return [KIND_TEXT[entry.kind], when(entry), entry.detail, entry.fileName]
			.filter((part) => part !== '')
			.join(' · ');
	}

	function toggle(key: string, checked: boolean) {
		if (checked) chosen.add(key);
		else chosen.delete(key);
	}

	async function save(event: Event) {
		event.preventDefault();
		if (pending || chosenCount === 0) return;
		pending = true;
		const results = await onsave(new Set(chosen));
		pending = false;
		onclose(results);
	}
</script>

<Modal
	open
	size="l"
	title="Dateien übernehmen"
	describedBy={ids.summary}
	busy={pending}
	initialFocus={firstButton}
	onclose={() => onclose(null)}
>
	<div id={ids.summary} class="summary">
		<p class="hint">
			{countText(selection.entries.length)} zur Auswahl. Nur die ausgewählten kommen in den Eingang.
			{#if preselected > 0}
				Treffer deiner Stichwörter sind vorausgewählt.
			{/if}
		</p>
		{#if !selection.keywordsAvailable}
			<p class="notice">
				{IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE} Bis dahin ist nichts vorausgewählt.
			</p>
		{:else if missingLists !== ''}
			<p class="notice">
				Für {missingLists} sind keine Stichwörter festgelegt, deshalb ist dort nichts vorausgewählt.
				<a href={resolve('/einstellungen/datei-importe')}
					>Stichwörter unter „Datei-Importe“ festlegen</a
				>
			</p>
		{/if}
	</div>
	<form id={ids.form} class="form" novalidate onsubmit={save}>
		<div class="choice">
			<button
				class="button-secondary"
				type="button"
				bind:this={firstButton}
				onclick={() => {
					for (const entry of open) chosen.add(entry.key);
				}}
			>
				Alle auswählen
			</button>
			<button class="button-secondary" type="button" onclick={() => chosen.clear()}>
				Auswahl aufheben
			</button>
			<span id={ids.count} class="hint" aria-live="polite">{chosenCount} ausgewählt</span>
		</div>

		<fieldset class="entries">
			<legend class="visually-hidden">Mails und Termine</legend>
			<ul>
				{#each selection.entries as entry (entry.key)}
					<li class:blocked={entry.blocked !== ''}>
						<label>
							<input
								type="checkbox"
								checked={entry.blocked === '' && chosen.has(entry.key)}
								disabled={entry.blocked !== ''}
								onchange={(event) => toggle(entry.key, event.currentTarget.checked)}
							/>
							<span class="title">{entry.title}</span>
							<span class="meta">{metaLine(entry)}</span>
							{#if entry.blocked !== ''}
								<span class="meta">{entry.blocked}</span>
							{:else if entry.keyword !== ''}
								<span class="meta">Stichwort: {entry.keyword}</span>
							{/if}
						</label>
					</li>
				{/each}
			</ul>
		</fieldset>
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={pending || chosenCount === 0 ? 'true' : undefined}
		>
			{pending ? 'Wird übernommen …' : `${countText(chosenCount)} in den Eingang`}
		</button>
	{/snippet}
</Modal>

<style>
	.summary {
		display: grid;
		gap: 0.5rem;
	}

	.form {
		display: grid;
		gap: 0.625rem;
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	/* The content of the modal scrolls; the list has no scroll area of its own. */
	.entries {
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.entries ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entries li + li {
		border-top: 1px solid var(--color-line);
	}

	.entries label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.125rem 0.5rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
	}

	.entries input {
		grid-row: span 3;
		margin-top: 0.125rem;
	}

	.blocked label {
		cursor: default;
	}

	.blocked .title {
		color: var(--color-text-muted);
	}

	.title {
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	.meta {
		grid-column: 2;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.notice {
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-control);
	}

	.notice a {
		color: inherit;
	}
</style>
