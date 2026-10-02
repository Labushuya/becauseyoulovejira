<script lang="ts">
	import {
		addDraftErrors,
		emptyRepoDraft,
		repoDraftErrors,
		repoDraftOf,
		repoFromDraft,
		repoKey,
		reposFromAddDraft,
		type GitHubRepoDraft,
		type GitHubRepoSettings,
		type GitHubSettings,
		type RepoDraftField
	} from '$lib/domain/github';
	import type { ProjectRef } from '$lib/domain/ticket';
	import type { GitHubRepoListState } from '$lib/stores/github.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import Modal from '../overlay/Modal.svelte';
	import GitHubRepoFields from './GitHubRepoFields.svelte';
	import GitHubRepoPicker from './GitHubRepoPicker.svelte';

	// "Repository hinzufügen …" and "Einstellungen …" of a repository at the card of a GitHub
	// connection (ADR-0050 §7): a modal M with the fields of the repository. Adding shows the
	// repositories the token may read to choose several at once (addendum of 2026-10-02, ADR-0042
	// "aus Listen wählen"); typing "Besitzer/Name" stays the other way, e.g. for public repositories
	// of others, and the only one without a token. Events, paths and target project apply to every
	// chosen repository. Saving writes the settings of the connection whole (the hook checks them);
	// an error of the client or the server stands at its field or above the footer, the dialog stays
	// open. Unsaved input asks before closing (ADR-0025 section 3).
	let {
		label,
		settings,
		repo = null,
		list = null,
		projects = [],
		onrefresh,
		onsave,
		onclose
	}: {
		/** Name of the connection, for the title. */
		label: string;
		/** The settings of the connection now (the other repositories, for duplicates). */
		settings: GitHubSettings;
		/** The repository to change; null adds new ones. */
		repo?: GitHubRepoSettings | null;
		/** Adding: the list of the repositories of the token; null shows no list. */
		list?: GitHubRepoListState | null;
		/** Every project of the catalog, archived ones included (own target project). */
		projects?: readonly ProjectRef[];
		/** Adding: reads the list of the token again. */
		onrefresh?: () => void;
		/** Saves the repositories; resolves to the error of the server, or null once they are saved. */
		onsave: (repos: GitHubRepoSettings[]) => Promise<string | null>;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;

	function initial(): GitHubRepoDraft {
		return repo === null ? emptyRepoDraft() : repoDraftOf(repo);
	}

	const start = JSON.stringify(initial());
	let draft = $state<GitHubRepoDraft>(initial());
	let chosen = $state<string[]>([]);
	let submitted = $state(false);
	let saving = $state(false);
	let serverError = $state<string | null>(null);

	const adding = $derived(repo === null);
	const editing = $derived(repo === null ? null : repoKey(repo.repo));
	/** The list has repositories to choose from: typing is one way among others. */
	const choosing = $derived(
		adding && list?.kind === 'ready' && list.list.repos.some((choice) => choice.state !== 'entered')
	);
	const errorsOf = (): Partial<Record<RepoDraftField, string>> =>
		adding
			? addDraftErrors(draft, chosen, settings, choosing)
			: repoDraftErrors(draft, settings, editing);
	const errors = $derived<Partial<Record<RepoDraftField, string>>>(submitted ? errorsOf() : {});
	const dirty = $derived(JSON.stringify(draft) !== start || chosen.length > 0);
	const title = $derived(
		repo === null ? `Repository zu „${label}“ hinzufügen` : `Repository ${repo.repo} einstellen`
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		serverError = null;
		if (Object.keys(errorsOf()).length > 0) return;
		saving = true;
		try {
			serverError = await onsave(
				adding ? reposFromAddDraft(draft, chosen) : [repoFromDraft(draft)]
			);
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
		{#if adding && list !== null}
			<GitHubRepoPicker {list} bind:chosen {onrefresh} />
		{/if}
		<GitHubRepoFields
			bind:draft
			{errors}
			fixedName={repo !== null}
			nameOptional={choosing}
			{projects}
		/>
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
