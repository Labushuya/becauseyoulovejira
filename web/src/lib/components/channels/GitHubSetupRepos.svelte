<script lang="ts">
	import type { Connection } from '$lib/domain/connections';
	import {
		EMPTY_GITHUB_SETTINGS,
		GITHUB_LIMITS,
		emptyRepoDraft,
		eventsText,
		repoDraftErrors,
		repoFromDraft,
		repoKey,
		withRepo,
		withoutRepo,
		type GitHubRepoDraft,
		type GitHubRepoSettings,
		type GitHubSettings,
		type RepoDraftField
	} from '$lib/domain/github';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import GitHubRepoFields from './GitHubRepoFields.svelte';

	// Step "Repositorys" of the assistant once the GitHub connection exists (ADR-0050 §7): the
	// repositories it watches, each removable, and a form for one more. The assistant is a modal, so
	// the form and the question before removing stand inline (no dialog from a dialog, ADR-0025
	// section 3). Every change saves the settings whole at once (`onsave`); an error stays here.
	let {
		connection,
		onsave
	}: {
		connection: Connection;
		/** Saves interval and repositories whole; resolves to the error text or null. */
		onsave: (settings: GitHubSettings, announcement: string) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const settings = $derived(connection.github ?? EMPTY_GITHUB_SETTINGS);
	let draft = $state<GitHubRepoDraft>(emptyRepoDraft());
	let submitted = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let removing = $state<GitHubRepoSettings | null>(null);
	let removeError = $state<string | null>(null);

	const errors = $derived<Partial<Record<RepoDraftField, string>>>(
		submitted ? repoDraftErrors(draft, settings, null) : {}
	);
	const full = $derived(settings.repos.length >= GITHUB_LIMITS.repos);

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		error = null;
		if (Object.keys(repoDraftErrors(draft, settings, null)).length > 0) return;
		const repo = repoFromDraft(draft);
		saving = true;
		try {
			error = await onsave(
				withRepo(settings, repo),
				`„${repo.repo}“ zu „${connection.label}“ hinzugefügt.`
			);
		} finally {
			saving = false;
		}
		if (error === null) {
			draft = emptyRepoDraft();
			submitted = false;
		}
	}

	async function confirmRemove() {
		if (removing === null || saving) return;
		const repo = removing;
		saving = true;
		removeError = null;
		try {
			removeError = await onsave(
				withoutRepo(settings, repoKey(repo.repo)),
				`„${repo.repo}“ aus „${connection.label}“ entfernt.`
			);
		} finally {
			saving = false;
		}
		if (removeError === null) removing = null;
	}
</script>

<section class="repos" aria-labelledby={headingId}>
	<h4 id={headingId}>Beobachtete Repositorys</h4>
	{#if settings.repos.length === 0}
		<p class="note">Noch kein Repository eingetragen.</p>
	{:else}
		<ul>
			{#each settings.repos as repo (repoKey(repo.repo))}
				<li>
					<span class="name">{repo.repo}</span>
					<span class="events">{eventsText(repo.events)}</span>
					<button
						class="button-icon"
						type="button"
						aria-label={`${repo.repo} entfernen …`}
						title={`${repo.repo} entfernen …`}
						onclick={() => {
							removeError = null;
							removing = repo;
						}}
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<ConfirmDialog
		open={removing !== null}
		title={`${removing?.repo ?? ''} nicht mehr beobachten?`}
		confirmLabel="Entfernen"
		busy={saving}
		error={removeError}
		onconfirm={() => void confirmRemove()}
		oncancel={() => {
			if (!saving) removing = null;
		}}
	>
		<p>Die App ruft das Repository dann nicht mehr ab. Einträge im Eingang bleiben.</p>
	</ConfirmDialog>

	{#if full}
		<p class="note">Mehr als {GITHUB_LIMITS.repos} Repositorys je Verbindung gehen nicht.</p>
	{:else}
		<form class="add" novalidate onsubmit={add} aria-busy={saving ? 'true' : undefined}>
			<h5>Weiteres Repository</h5>
			<GitHubRepoFields bind:draft {errors} />
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
					{saving ? 'Wird gespeichert …' : 'Repository hinzufügen'}
				</button>
			</div>
		</form>
	{/if}
</section>

<style>
	.repos,
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

	.events,
	.note {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	li .button-icon {
		margin-left: auto;
	}

	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
</style>
