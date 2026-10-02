<script lang="ts">
	import {
		emptyFolderDraft,
		folderDraftErrors,
		folderDraftOf,
		folderFromDraft,
		folderKey,
		folderName,
		type FolderConfig,
		type FolderDraft,
		type FolderDraftField,
		type FolderPlatform,
		type FolderSettings
	} from '$lib/domain/folders';
	import type { ProjectRef } from '$lib/domain/ticket';
	import ErrorIcon from '../ErrorIcon.svelte';
	import Modal from '../overlay/Modal.svelte';
	import FolderFields from './FolderFields.svelte';

	// "Ordner hinzufügen …" and "Einstellungen …" of a folder at the card of a folder connection
	// (ADR-0051 §7): a modal M with the fields of the folder. Saving writes the settings of the
	// connection whole; the hook checks them and a new folder also on the disk (exists, readable, no
	// link, not the app). An error of the client or the server stands at its field or above the
	// footer, the dialog stays open. Unsaved input asks before closing (ADR-0025 section 3).
	let {
		label,
		settings,
		folder = null,
		platform,
		projects = [],
		onsave,
		onclose
	}: {
		/** Name of the connection, for the title. */
		label: string;
		/** The settings of the connection now (the other folders, for duplicates and the limit). */
		settings: FolderSettings;
		/** The folder to change; null adds a new one. */
		folder?: FolderConfig | null;
		/** System of the paths of the server. */
		platform: FolderPlatform;
		/** Every project of the catalog, archived ones included (own target project). */
		projects?: readonly ProjectRef[];
		/** Saves the folder; resolves to the error of the server, or null once it is saved. */
		onsave: (folder: FolderConfig) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;

	function initial(): FolderDraft {
		return folder === null ? emptyFolderDraft() : folderDraftOf(folder);
	}

	const start = JSON.stringify(initial());
	let draft = $state<FolderDraft>(initial());
	let submitted = $state(false);
	let saving = $state(false);
	let serverError = $state<string | null>(null);

	const editing = $derived(folder === null ? null : folderKey(folder.path));
	const errors = $derived<Partial<Record<FolderDraftField, string>>>(
		submitted ? folderDraftErrors(draft, platform, settings, editing) : {}
	);
	const dirty = $derived(JSON.stringify(draft) !== start);
	const title = $derived(
		folder === null
			? `Ordner zu „${label}“ hinzufügen`
			: `Ordner „${folderName(folder.path)}“ einstellen`
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		serverError = null;
		if (Object.keys(folderDraftErrors(draft, platform, settings, editing)).length > 0) return;
		saving = true;
		try {
			serverError = await onsave(folderFromDraft(draft, platform));
		} finally {
			saving = false;
		}
		if (serverError === null) onclose();
	}
</script>

<Modal open size="m" {title} busy={saving} {dirty} onclose={() => onclose()}>
	<form
		id={formId}
		class="form"
		novalidate
		onsubmit={submit}
		aria-busy={saving ? 'true' : undefined}
	>
		<FolderFields bind:draft {errors} {platform} fixedPath={folder !== null} {projects} />
		{#if serverError !== null}
			<p class="alert-error" role="alert"><ErrorIcon /><span>{serverError}</span></p>
		{/if}
	</form>
	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={saving ? 'true' : undefined}
			aria-busy={saving ? 'true' : undefined}
		>
			{saving ? 'Wird gespeichert …' : folder === null ? 'Hinzufügen' : 'Speichern'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}
</style>
