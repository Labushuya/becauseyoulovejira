<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { MAIL_MAX_MB } from '$lib/domain/inbox-mail';
	import { importCounts, type FileImportResult } from '$lib/stores/mail-import';
	import ErrorIcon from './ErrorIcon.svelte';

	// Drop zone of the inbox view (E4 plan, packages 8, 14 and 16): mail files (.eml), calendar files
	// (.ics) and WhatsApp exports (.txt, .zip; they open the selection view) by drag and drop or, for the keyboard, with "Datei wählen"; several at once. Each file
	// gets its own result: "neu" and "schon vorhanden" with a link, the counts of a calendar file,
	// or an error with icon and reason.
	let {
		busy = false,
		results = [],
		onfiles,
		itemHref,
		ticketHref
	}: {
		/** A previous import still runs; new files wait for it. */
		busy?: boolean;
		results?: readonly FileImportResult[];
		onfiles: (files: File[]) => void;
		itemHref: (id: string) => ResolvedPathname;
		ticketHref: (id: string) => ResolvedPathname;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;

	let picker = $state<HTMLInputElement>();
	let active = $state(false);

	function hasFiles(event: DragEvent): boolean {
		return [...(event.dataTransfer?.types ?? [])].includes('Files');
	}

	function ondragover(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
		active = true;
	}

	function ondrop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		event.stopPropagation();
		active = false;
		const files = [...(event.dataTransfer?.files ?? [])];
		if (!busy && files.length > 0) onfiles(files);
	}

	function onpick(event: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		if (!busy && files.length > 0) onfiles(files);
	}
</script>

<div
	class="drop-zone"
	class:active
	role="group"
	aria-label="Dateien übernehmen"
	aria-describedby={hintId}
	aria-busy={busy ? 'true' : undefined}
	{ondragover}
	ondragleave={() => (active = false)}
	{ondrop}
>
	<p id={hintId}>
		Mail-Dateien (.eml; über {MAIL_MAX_MB} MB ohne Originaldatei), Kalenderdateien (.ics) und WhatsApp-Chatexporte
		(.txt, .zip; je höchstens 20 MB) hierher ziehen. Bilder und Links der Mail werden nicht geladen.
	</p>
	<button
		class="pick"
		type="button"
		aria-disabled={busy ? 'true' : undefined}
		onclick={() => {
			if (!busy) picker?.click();
		}}
	>
		{busy ? 'Wird übernommen …' : 'Datei wählen'}
	</button>
	<input
		class="visually-hidden"
		type="file"
		accept=".eml,message/rfc822,.ics,text/calendar,.txt,.zip"
		multiple
		tabindex="-1"
		aria-hidden="true"
		bind:this={picker}
		onchange={onpick}
	/>
</div>

<div aria-live="polite">
	{#if results.length > 0}
		<ul class="results">
			{#each results as result, index (index)}
				<li>
					{#if result.kind === 'created'}
						<span class="name">{result.name}:</span> neu –
						<a href={itemHref(result.itemId)}>{result.title}</a>
					{:else if result.kind === 'calendar'}
						<span class="name">{result.name}:</span>
						{importCounts(result)}
						{#if result.itemId !== ''}
							<a href={itemHref(result.itemId)}>Eintrag ansehen</a>
						{/if}
					{:else if result.kind === 'duplicate'}
						<span class="name">{result.name}:</span> schon vorhanden ({result.message})
						{#if result.ticketId !== ''}
							<a href={ticketHref(result.ticketId)}>Ticket ansehen</a>
						{:else if result.itemId !== ''}
							<a href={itemHref(result.itemId)}>Eintrag ansehen</a>
						{/if}
					{:else}
						<span class="failure">
							<ErrorIcon /><span><span class="name">{result.name}:</span> {result.message}</span>
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.drop-zone {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		border: 1px dashed var(--color-line);
		border-radius: var(--radius-surface);
	}

	.drop-zone.active {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.pick {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-brand-text);
		background: var(--color-surface);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	/* Files are being taken over (ADR-0026, addendum of 2026-09-30). */
	.drop-zone[aria-busy='true'] .pick {
		cursor: progress;
	}

	.results {
		display: grid;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
		padding: 0;
		font-size: 0.875rem;
		list-style: none;
	}

	.name {
		font-weight: 500;
	}

	.results a {
		color: var(--color-brand-text);
	}

	.failure {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		color: var(--color-danger);
	}
</style>
