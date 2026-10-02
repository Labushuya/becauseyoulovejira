<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		existingStateText,
		fileSizeText,
		type ExistingFile,
		type ExistingFiles
	} from '$lib/domain/folders';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import type { FoldersStore } from '$lib/stores/folders.svelte';
	import EmptyState from '../guidance/EmptyState.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Vorhandene Dateien übernehmen …" of a folder (ADR-0051 §3) on the modal building block (size
	// L), after the model of the mailbox selection: the files the first run found in the folder,
	// each with a checkbox; files that have an entry already are shown but cannot be chosen. Nothing
	// is chosen at first: the first run took no file on purpose, so only what the user picks comes
	// into the inbox, as references without a copy. The chosen files go to the server in blocks
	// (with the progress in the button); a failed block keeps the rest chosen and says why. The list
	// comes from what the runs stored, so a file deleted since is skipped and counted.
	let {
		connectionId,
		folderId,
		label,
		folders,
		onclose
	}: {
		connectionId: string;
		/** ID of the folder in the routes of the card. */
		folderId: string;
		/** Name of the connection, for the flag of the result. */
		label: string;
		folders: FoldersStore;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		summary: `${uid}-summary`,
		filter: `${uid}-filter`
	};

	type View =
		| { kind: 'loading' }
		| { kind: 'ready'; list: ExistingFiles }
		| { kind: 'error'; message: string };

	let view = $state<View>({ kind: 'loading' });
	let filter = $state('');
	let pending = $state(false);
	let done = $state(0);
	let total = $state(0);
	let saveError = $state<string | null>(null);
	const chosen = new SvelteSet<string>();
	let controller: AbortController | null = null;

	const list = $derived(view.kind === 'ready' ? view.list : null);
	const files = $derived(list?.files ?? []);
	const needle = $derived(filter.trim().toLowerCase());
	const shown = $derived(
		needle === '' ? files : files.filter((file) => file.path.toLowerCase().includes(needle))
	);
	const open = $derived(shown.filter((file) => file.state === ''));
	const chosenPaths = $derived(
		files.filter((file) => chosen.has(file.path)).map((file) => file.path)
	);
	const title = $derived(
		list === null || list.name === ''
			? 'Vorhandene Dateien übernehmen'
			: `Vorhandene Dateien aus „${list.name}“ übernehmen`
	);

	// A request still running when the dialog goes away is aborted.
	$effect(() => () => controller?.abort());

	$effect(() => {
		const id = connectionId;
		const folder = folderId;
		untrack(() => void load(id, folder));
	});

	async function load(id: string, folder: string) {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		view = { kind: 'loading' };
		chosen.clear();
		const state = await folders.loadExisting(id, folder, { signal: current.signal });
		if (controller !== current) return;
		controller = null;
		if (state === null) return;
		view = state.kind === 'ready' ? { kind: 'ready', list: state.list } : state;
	}

	function countText(count: number): string {
		return count === 1 ? '1 Datei' : `${count} Dateien`;
	}

	function metaLine(file: ExistingFile): string {
		return [
			file.modified === '' ? '' : `geändert ${formatBerlinDateTime(file.modified)}`,
			fileSizeText(file.size)
		]
			.filter((part) => part !== '')
			.join(' · ');
	}

	function toggle(path: string, checked: boolean) {
		if (checked) chosen.add(path);
		else chosen.delete(path);
	}

	async function submit(event: Event) {
		event.preventDefault();
		if (pending || chosenPaths.length === 0) return;
		const paths = chosenPaths;
		pending = true;
		saveError = null;
		done = 0;
		total = paths.length;
		const outcome = await folders.adopt(connectionId, folderId, paths, label, (count) => {
			done = count;
		});
		pending = false;
		if (outcome === null) return;
		for (const path of paths.slice(0, done)) chosen.delete(path);
		if (outcome.error !== null) {
			saveError = outcome.error;
			return;
		}
		onclose();
	}
</script>

<Modal open size="l" {title} describedBy={ids.summary} busy={pending} onclose={() => onclose()}>
	<p id={ids.summary} class="hint">
		Der erste Lauf hat den Stand des Ordners nur gemerkt. Hier wählst du Dateien von vorher, die als
		Verweis in den Eingang kommen sollen; die Dateien bleiben, wo sie sind.
	</p>

	{#if view.kind === 'loading'}
		<p class="hint" role="status">Die Liste wird geladen …</p>
	{:else if view.kind === 'error'}
		<SectionMessage tone="error" live>
			{view.message}
			{#snippet actions()}
				<button
					class="button-subtle"
					type="button"
					onclick={() => void load(connectionId, folderId)}
				>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{/if}

	<form id={ids.form} class="form" novalidate onsubmit={submit}>
		{#if list !== null}
			{#if !list.base}
				<SectionMessage tone="info">
					Der Ordner ist noch nicht erfasst. Erst „Jetzt prüfen“ an der Karte, danach stehen seine
					Dateien hier.
				</SectionMessage>
			{:else if files.length === 0}
				<EmptyState size="compact" title="Keine Dateien im Ordner" headingLevel={3} />
			{:else}
				<span class="search-field filter">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.25" />
						<path d="M10.25 10.25L13.5 13.5" />
					</svg>
					<input
						id={ids.filter}
						type="search"
						autocomplete="off"
						spellcheck="false"
						aria-label="Filtern"
						placeholder="Dateien filtern"
						bind:value={filter}
					/>
				</span>
				<div class="choice">
					<button
						class="button-secondary"
						type="button"
						disabled={pending}
						onclick={() => {
							for (const file of open) chosen.add(file.path);
						}}
					>
						{needle === '' ? 'Alle auswählen' : 'Alle gefilterten auswählen'}
					</button>
					<button
						class="button-secondary"
						type="button"
						disabled={pending}
						onclick={() => chosen.clear()}
					>
						Auswahl aufheben
					</button>
					<span class="hint" aria-live="polite">{chosenPaths.length} ausgewählt</span>
				</div>
				{#if shown.length === 0}
					<p class="hint">Keine Datei passt zum Filter.</p>
				{:else}
					<fieldset class="entries">
						<legend class="visually-hidden">Dateien des Ordners</legend>
						<ul>
							{#each shown as file (file.path)}
								{@const blocked = existingStateText(file.state)}
								<li class:blocked={blocked !== ''}>
									<label>
										<input
											type="checkbox"
											checked={blocked === '' && chosen.has(file.path)}
											disabled={blocked !== '' || pending}
											onchange={(event) => toggle(file.path, event.currentTarget.checked)}
										/>
										<span class="title">{file.path}</span>
										<span class="meta">{metaLine(file)}</span>
										{#if blocked !== ''}
											<span class="meta">{blocked}</span>
										{/if}
									</label>
								</li>
							{/each}
						</ul>
					</fieldset>
				{/if}
			{/if}
		{/if}

		{#if saveError !== null}
			<SectionMessage tone="error" live>{saveError}</SectionMessage>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		{#if list !== null && list.base && files.length > 0}
			<button
				class="button-primary"
				type="submit"
				form={ids.form}
				aria-disabled={pending || chosenPaths.length === 0 ? 'true' : undefined}
				aria-busy={pending ? 'true' : undefined}
			>
				{pending
					? `Wird übernommen … (${done} von ${total})`
					: `${countText(chosenPaths.length)} übernehmen`}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.filter {
		width: 100%;
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
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.meta {
		grid-column: 2;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
