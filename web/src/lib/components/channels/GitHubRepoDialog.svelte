<script lang="ts">
	import {
		emptyRepoDraft,
		repoDraftErrors,
		repoDraftOf,
		repoFromDraft,
		repoKey,
		type GitHubRepoDraft,
		type GitHubRepoSettings,
		type GitHubSettings,
		type RepoDraftField
	} from '$lib/domain/github';
	import type { ProjectRef } from '$lib/domain/ticket';
	import ErrorIcon from '../ErrorIcon.svelte';
	import Modal from '../overlay/Modal.svelte';
	import GitHubRepoFields from './GitHubRepoFields.svelte';

	// "Repository hinzufügen …" and "Einstellungen …" of a repository at the card of a GitHub
	// connection (ADR-0050 §7): a modal M with the fields of the repository. Saving writes the
	// settings of the connection whole (the hook checks them); an error of the client or the server
	// stands at its field or above the footer, the dialog stays open. Unsaved input asks before
	// closing (ADR-0025 section 3).
	let {
		label,
		settings,
		repo = null,
		projects = [],
		onsave,
		onclose
	}: {
		/** Name of the connection, for the title. */
		label: string;
		/** The settings of the connection now (the other repositories, for duplicates). */
		settings: GitHubSettings;
		/** The repository to change; null adds a new one. */
		repo?: GitHubRepoSettings | null;
		/** Every project of the catalog, archived ones included (own target project). */
		projects?: readonly ProjectRef[];
		/** Saves the repository; resolves to the error of the server, or null once it is saved. */
		onsave: (repo: GitHubRepoSettings) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;

	function initial(): GitHubRepoDraft {
		return repo === null ? emptyRepoDraft() : repoDraftOf(repo);
	}

	const start = JSON.stringify(initial());
	let draft = $state<GitHubRepoDraft>(initial());
	let submitted = $state(false);
	let saving = $state(false);
	let serverError = $state<string | null>(null);

	const editing = $derived(repo === null ? null : repoKey(repo.repo));
	const errors = $derived<Partial<Record<RepoDraftField, string>>>(
		submitted ? repoDraftErrors(draft, settings, editing) : {}
	);
	const dirty = $derived(JSON.stringify(draft) !== start);
	const title = $derived(
		repo === null ? `Repository zu „${label}“ hinzufügen` : `Repository ${repo.repo} einstellen`
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		serverError = null;
		if (Object.keys(repoDraftErrors(draft, settings, editing)).length > 0) return;
		saving = true;
		try {
			serverError = await onsave(repoFromDraft(draft));
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
		<GitHubRepoFields bind:draft {errors} fixedName={repo !== null} {projects} />
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
			{saving ? 'Wird gespeichert …' : repo === null ? 'Hinzufügen' : 'Speichern'}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}
</style>
