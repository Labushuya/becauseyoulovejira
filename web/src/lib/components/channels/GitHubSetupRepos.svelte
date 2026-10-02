<script lang="ts">
	import { untrack } from 'svelte';
	import type { Connection } from '$lib/domain/connections';
	import {
		AUTO_HINT,
		EMPTY_GITHUB_SETTINGS,
		GITHUB_LIMITS,
		addDraftErrors,
		emptyRepoDraft,
		eventsText,
		isAutoUnknown,
		repoKey,
		reposFromAddDraft,
		withRepos,
		withoutRepo,
		type GitHubRepoDraft,
		type GitHubRepoSettings,
		type GitHubSettings,
		type RepoDraftField
	} from '$lib/domain/github';
	import { GITHUB_AUTO_UNAVAILABLE_MESSAGE, type GitHubStore } from '$lib/stores/github.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import GitHubRepoFields from './GitHubRepoFields.svelte';
	import GitHubRepoPicker from './GitHubRepoPicker.svelte';

	// Step "Repositorys" of the assistant once the GitHub connection exists (ADR-0050 §7): the
	// repositories it watches, each removable, the switch "Alle meine Repositorys beobachten" and a
	// form for more, chosen from the repositories of the token or typed (addendum of 2026-10-02).
	// The assistant is a modal, so the form and the question before removing stand inline (no
	// dialog from a dialog, ADR-0025 section 3). Every change saves the settings whole at once
	// (`onsave`); an error stays here.
	let {
		connection,
		github,
		onsave
	}: {
		connection: Connection;
		/** The list of the repositories of the token; without it the form only takes a name. */
		github?: GitHubStore;
		/** Saves interval and repositories whole; resolves to the error text or null. */
		onsave: (settings: GitHubSettings, announcement: string) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	const autoHintId = `${uid}-auto-hint`;

	const settings = $derived(connection.github ?? EMPTY_GITHUB_SETTINGS);
	const list = $derived(github === undefined ? null : github.repoList(connection.id));
	let draft = $state<GitHubRepoDraft>(emptyRepoDraft());
	let chosen = $state<string[]>([]);
	let submitted = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let removing = $state<GitHubRepoSettings | null>(null);
	let removeError = $state<string | null>(null);

	const choosing = $derived(
		list?.kind === 'ready' && list.list.repos.some((choice) => choice.state !== 'entered')
	);
	const errors = $derived<Partial<Record<RepoDraftField, string>>>(
		submitted ? addDraftErrors(draft, chosen, settings, choosing) : {}
	);
	const full = $derived(settings.repos.length >= GITHUB_LIMITS.repos);

	// The list of the token comes with the step (the server reads GitHub at most hourly).
	const connectionId = $derived(connection.id);
	$effect(() => {
		const id = connectionId;
		if (github === undefined) return;
		const store = github;
		const controller = new AbortController();
		untrack(() => void store.loadRepoList(id, { signal: controller.signal }));
		return () => controller.abort();
	});

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		error = null;
		if (Object.keys(addDraftErrors(draft, chosen, settings, choosing)).length > 0) return;
		const repos = reposFromAddDraft(draft, chosen);
		saving = true;
		try {
			error = await onsave(
				withRepos(settings, repos),
				repos.length === 1
					? `„${repos[0]?.repo ?? ''}“ zu „${connection.label}“ hinzugefügt.`
					: `${repos.length} Repositorys zu „${connection.label}“ hinzugefügt.`
			);
		} finally {
			saving = false;
		}
		if (error === null) {
			draft = emptyRepoDraft();
			chosen = [];
			submitted = false;
			if (github !== undefined) void github.loadRepoList(connection.id);
		}
	}

	async function saveAuto(input: HTMLInputElement) {
		const on = input.checked;
		if (saving || on === settings.auto) return;
		saving = true;
		error = null;
		try {
			error = await onsave(
				{ ...settings, auto: on },
				on
					? `„${connection.label}“ beobachtet jetzt alle deine Repositorys.`
					: `„${connection.label}“ beobachtet nur noch die eingetragenen Repositorys.`
			);
		} finally {
			saving = false;
		}
		if (isAutoUnknown(error, on)) error = GITHUB_AUTO_UNAVAILABLE_MESSAGE;
		if (error !== null) input.checked = settings.auto;
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
	<div class="auto">
		<label class="setting">
			<span>Alle meine Repositorys beobachten</span>
			<input
				type="checkbox"
				role="switch"
				checked={settings.auto}
				aria-describedby={autoHintId}
				aria-busy={saving ? 'true' : undefined}
				onclick={(event) => {
					if (saving) event.preventDefault();
				}}
				onchange={(event) => void saveAuto(event.currentTarget)}
			/>
		</label>
		<p class="note" id={autoHintId}>{AUTO_HINT} Braucht ein Token.</p>
	</div>
	{#if settings.repos.length === 0}
		<p class="note">
			{settings.auto
				? 'Kein Repository eingetragen; die App beobachtet alle deine eigenen.'
				: 'Noch kein Repository eingetragen.'}
		</p>
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
			<h5>Weitere Repositorys</h5>
			{#if github !== undefined}
				<GitHubRepoPicker
					{list}
					bind:chosen
					onrefresh={() => void github?.loadRepoList(connection.id, { refresh: true })}
				/>
			{/if}
			<GitHubRepoFields bind:draft {errors} nameOptional={choosing} />
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

	/* "Alle meine Repositorys": a setting row, the name left, the switch right. */
	.auto {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.setting input {
		flex: none;
	}
</style>
