<script lang="ts">
	import { tick, untrack } from 'svelte';
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

	// Selection view of dropped mail and calendar files (E4 plan, package 21; ADR-0020) as a native
	// modal <dialog>, after the model of the WhatsApp import: one row per mail and per event with a
	// checkbox. Keyword matches are chosen at first; what is in the inbox already is shown but cannot
	// be chosen. Only the chosen entries are saved; the results per file go back to the drop zone.
	// Escape and "Abbrechen" close without saving, the focus returns to where it was.
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
		heading: `${uid}-heading`,
		summary: `${uid}-summary`,
		count: `${uid}-count`
	};

	const KIND_TEXT: Readonly<Record<SelectionEntry['kind'], string>> = {
		mail: 'Mail',
		event: 'Termin',
		todo: 'Aufgabe'
	};

	let dialog = $state<HTMLDialogElement>();
	let firstButton = $state<HTMLButtonElement>();
	const chosen = new SvelteSet<string>(untrack(() => preselectedKeys(selection)));
	let pending = $state(false);

	const open = $derived(selection.entries.filter((entry) => entry.blocked === ''));
	const chosenCount = $derived(open.filter((entry) => chosen.has(entry.key)).length);
	const preselected = $derived(preselectedKeys(selection).length);
	const missingLists = $derived(
		selection.withoutKeywords.map((kind) => IMPORT_KIND_LABELS[kind]).join(' und ')
	);

	$effect(() => {
		const element = dialog;
		if (element === undefined) return;
		const previous = document.activeElement;
		if (!element.open) element.showModal();
		void tick().then(() => firstButton?.focus());
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

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

	function cancel() {
		if (!pending) onclose(null);
	}
</script>

<dialog
	class="files"
	bind:this={dialog}
	aria-labelledby={ids.heading}
	aria-describedby={ids.summary}
	oncancel={(event) => {
		event.preventDefault();
		cancel();
	}}
>
	<h2 id={ids.heading}>Dateien übernehmen</h2>
	<div id={ids.summary} class="summary">
		<p class="hint">
			{countText(selection.entries.length)} zur Auswahl. Nur die ausgewählten kommen in den Eingang.
			{#if preselected > 0}
				Treffer deiner Stichwörter sind vorausgewählt.
			{/if}
		</p>
		{#if !selection.keywordsAvailable}
			<p class="notice">
				Stichwörter für Datei-Importe gibt es nach dem nächsten Start der App (stop.bat, dann
				start.bat). Bis dahin ist nichts vorausgewählt.
			</p>
		{:else if missingLists !== ''}
			<p class="notice">
				Für {missingLists} sind keine Stichwörter festgelegt, deshalb ist dort nichts vorausgewählt.
				<a href={resolve('/einstellungen/kanaele')}>Stichwörter unter „Kanäle“ festlegen</a>
			</p>
		{/if}
	</div>
	<form class="form" novalidate onsubmit={save}>
		<div class="choice">
			<button
				class="secondary"
				type="button"
				bind:this={firstButton}
				onclick={() => {
					for (const entry of open) chosen.add(entry.key);
				}}
			>
				Alle auswählen
			</button>
			<button class="secondary" type="button" onclick={() => chosen.clear()}>
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

		<div class="buttons">
			<button class="secondary" type="button" onclick={cancel}>Abbrechen</button>
			<button
				class="button-primary"
				type="submit"
				aria-disabled={pending || chosenCount === 0 ? 'true' : undefined}
			>
				{pending ? 'Wird übernommen …' : `${countText(chosenCount)} in den Eingang`}
			</button>
		</div>
	</form>
</dialog>

<style>
	.files {
		width: min(44rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		margin: auto;
		padding: 1.25rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.files::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		margin-bottom: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.summary {
		display: grid;
		gap: 0.5rem;
	}

	.form {
		display: grid;
		gap: 0.625rem;
		margin-top: 0.75rem;
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.entries {
		max-height: 22rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
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
		border-radius: 0.375rem;
	}

	.notice a {
		color: inherit;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.5rem 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}
</style>
