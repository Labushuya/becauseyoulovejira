<script lang="ts">
	import type { Connection } from '$lib/domain/connections';
	import {
		EMPTY_FOLDER_SETTINGS,
		FOLDER_LIMITS,
		emptyFolderDraft,
		folderDraftErrors,
		folderFromDraft,
		folderKey,
		typesText,
		withFolder,
		type FolderDraft,
		type FolderDraftField,
		type FolderPlatform,
		type FolderSettings
	} from '$lib/domain/folders';
	import ErrorIcon from '../ErrorIcon.svelte';
	import FolderFields from './FolderFields.svelte';

	// Step "Ordner" of the assistant once the folder connection exists (ADR-0051 §7): the folders it
	// watches and a form for one more. The assistant is a modal, so the form stands inline (no
	// dialog from a dialog, ADR-0025 section 3); removing a folder is a matter of the card. Every
	// change saves the settings whole at once (`onsave`), the server checks a new folder on the
	// disk; an error stays here.
	let {
		connection,
		platform,
		onsave
	}: {
		connection: Connection;
		/** System of the paths of the server. */
		platform: FolderPlatform;
		/** Saves interval and folders whole; resolves to the error text or null. */
		onsave: (settings: FolderSettings, announcement: string) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const settings = $derived(connection.folders ?? EMPTY_FOLDER_SETTINGS);
	let draft = $state<FolderDraft>(emptyFolderDraft());
	let submitted = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const errors = $derived<Partial<Record<FolderDraftField, string>>>(
		submitted ? folderDraftErrors(draft, platform, settings, null) : {}
	);
	const full = $derived(settings.folders.length >= FOLDER_LIMITS.folders);

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		error = null;
		if (Object.keys(folderDraftErrors(draft, platform, settings, null)).length > 0) return;
		const folder = folderFromDraft(draft, platform);
		saving = true;
		try {
			error = await onsave(
				withFolder(settings, folder),
				`„${folder.path}“ zu „${connection.label}“ hinzugefügt.`
			);
		} finally {
			saving = false;
		}
		if (error === null) {
			draft = emptyFolderDraft();
			submitted = false;
		}
	}
</script>

<section class="folders" aria-labelledby={headingId}>
	<h4 id={headingId}>Beobachtete Ordner</h4>
	{#if settings.folders.length === 0}
		<p class="note">Noch kein Ordner eingetragen.</p>
	{:else}
		<ul>
			{#each settings.folders as folder (folderKey(folder.path))}
				<li>
					<span class="name">{folder.path}</span>
					<span class="types">Dateitypen: {typesText(folder.types)}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if full}
		<p class="note">Mehr als {FOLDER_LIMITS.folders} Ordner je Verbindung gehen nicht.</p>
	{:else}
		<form class="add" novalidate onsubmit={add} aria-busy={saving ? 'true' : undefined}>
			<h5>Weiterer Ordner</h5>
			<FolderFields bind:draft {errors} {platform} />
			{#if error !== null}
				<p class="alert-error" role="alert"><ErrorIcon /><span>{error}</span></p>
			{/if}
			<div>
				<button
					class="button-secondary"
					type="submit"
					aria-disabled={saving ? 'true' : undefined}
					aria-busy={saving ? 'true' : undefined}
				>
					{saving ? 'Wird gespeichert …' : 'Ordner hinzufügen'}
				</button>
			</div>
		</form>
	{/if}
</section>

<style>
	.folders,
	.add {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	h4,
	h5 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		min-width: 0;
	}

	.name {
		font-size: var(--font-size-body);
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.types,
	.note {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
