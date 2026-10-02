<script lang="ts">
	import { connectionTypeOf, type SetupKind } from '$lib/domain/channel-setup';
	import {
		connectionDraftErrors,
		emptyConnectionDraft,
		freeVariableName,
		usesSecret,
		withMailProvider,
		type Connection,
		type ConnectionDraft
	} from '$lib/domain/connections';
	import {
		EMPTY_FOLDER_SETTINGS,
		emptyFolderDraft,
		folderDraftErrors,
		folderFromDraft,
		folderPlatformOf,
		type FolderDraft,
		type FolderDraftField
	} from '$lib/domain/folders';
	import {
		EMPTY_GITHUB_SETTINGS,
		emptyRepoDraft,
		repoDraftErrors,
		repoFromDraft,
		type GitHubRepoDraft,
		type RepoDraftField
	} from '$lib/domain/github';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import FolderFields from './FolderFields.svelte';
	import GitHubRepoFields from './GitHubRepoFields.svelte';

	// Step "Verbinden" of the assistant (ADR-0026 section 4, plan EH-5 §3.7): name of the connection
	// and the names of its variables, preset for the service; never a value (ADR-0018). Creating
	// saves at once, so there is nothing to discard; field errors of the client and the server stand
	// at the field. It replaces the former modal "Verbindung anlegen". The variable is preset to a
	// name no connection uses yet, like the steps before (ADR-0041, addendum of 2026-10-01). GitHub
	// (ADR-0050 §7) creates its connection with the first repository, so the step asks for it too.
	// A folder connection (ADR-0051 §7) has no variable and comes with its first folder, whose path
	// follows the system of the server (the server checks it on the disk).
	let {
		kind,
		store,
		oncreated
	}: {
		kind: SetupKind;
		store: ConnectionsStore;
		oncreated: (connection: Connection) => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		label: `${uid}-label`,
		secret: `${uid}-secret`,
		allowlist: `${uid}-allowlist`,
		user: `${uid}-user`
	};

	function initialDraft(): ConnectionDraft {
		const { type, provider } = connectionTypeOf(kind);
		const empty = emptyConnectionDraft(type);
		const draft = type === 'mail' && provider !== '' ? withMailProvider(empty, provider) : empty;
		if (!usesSecret(type)) return draft;
		const taken = store.connections.map((connection) => connection.secretEnv);
		return { ...draft, secretEnv: freeVariableName(draft.secretEnv, taken) };
	}

	const host = findHostStore();
	const platform = $derived(folderPlatformOf(host?.platform ?? DEFAULT_HOST_PLATFORM));

	let draft = $state<ConnectionDraft>(initialDraft());
	/** GitHub: the first repository. */
	let repo = $state<GitHubRepoDraft>(emptyRepoDraft());
	/** Folders: the first folder. */
	let folder = $state<FolderDraft>(emptyFolderDraft());
	let submitted = $state(false);
	let saving = $state(false);
	let serverFields = $state<Record<string, string>>({});
	let formMessage = $state<string | null>(null);

	const github = $derived(draft.type === 'github');
	const folders = $derived(draft.type === 'folder');
	const repoErrors = $derived<Partial<Record<RepoDraftField, string>>>(
		submitted && github ? repoDraftErrors(repo, EMPTY_GITHUB_SETTINGS, null) : {}
	);
	const folderErrors = $derived<Partial<Record<FolderDraftField, string>>>(
		submitted && folders ? folderDraftErrors(folder, platform, EMPTY_FOLDER_SETTINGS, null) : {}
	);
	const clientErrors = $derived(submitted ? connectionDraftErrors(draft) : {});
	const errors = $derived({
		label: clientErrors.label ?? serverFields.label,
		secretEnv: clientErrors.secretEnv ?? serverFields.secret_env,
		allowlistEnv:
			clientErrors.allowlistEnv ?? (draft.type === 'telegram' ? serverFields.settings : undefined),
		mailUser: clientErrors.mailUser ?? (draft.type === 'mail' ? serverFields.settings : undefined)
	});
	const secretLabel = $derived(
		draft.type === 'calendar'
			? 'Name der Variablen für die iCal-Adresse'
			: draft.type === 'mail'
				? 'Name der Variablen für das Passwort'
				: draft.type === 'notion' || draft.type === 'github'
					? 'Name der Variablen für das Token'
					: 'Name der Variablen für das Bot-Token'
	);

	async function create(event: Event) {
		event.preventDefault();
		if (saving) return;
		submitted = true;
		formMessage = null;
		serverFields = {};
		if (Object.keys(connectionDraftErrors(draft)).length > 0) return;
		if (github && Object.keys(repoDraftErrors(repo, EMPTY_GITHUB_SETTINGS, null)).length > 0) {
			return;
		}
		if (
			folders &&
			Object.keys(folderDraftErrors(folder, platform, EMPTY_FOLDER_SETTINGS, null)).length > 0
		) {
			return;
		}
		saving = true;
		const result = await store.create(
			github
				? { ...draft, githubRepo: repoFromDraft(repo) }
				: folders
					? { ...draft, folder: folderFromDraft(folder, platform) }
					: draft
		);
		saving = false;
		if (result.ok) {
			oncreated(result.connection);
			return;
		}
		serverFields = { ...result.fields };
		// GitHub and folders: a refused repository or folder (a path that is not there, patterns)
		// comes as an error of the settings.
		formMessage = result.message ?? (github || folders ? (result.fields.settings ?? null) : null);
	}
</script>

{#snippet fieldError(id: string, text: string | undefined)}
	{#if text}
		<p id={`${id}-error`} class="field-error"><ErrorIcon /><span>{text}</span></p>
	{/if}
{/snippet}

<form class="form" novalidate onsubmit={create} aria-busy={saving}>
	<div class="field">
		<label for={ids.label}>Bezeichnung (Pflichtfeld)</label>
		<input
			id={ids.label}
			type="text"
			maxlength="100"
			aria-required="true"
			aria-invalid={errors.label ? 'true' : undefined}
			aria-describedby={errors.label ? `${ids.label}-error` : undefined}
			bind:value={draft.label}
		/>
		{@render fieldError(ids.label, errors.label)}
	</div>
	{#if draft.type === 'mail'}
		<div class="field">
			<label for={ids.user}>E-Mail-Adresse des Postfachs (Pflichtfeld)</label>
			<input
				id={ids.user}
				type="text"
				maxlength="254"
				spellcheck="false"
				autocomplete="off"
				aria-required="true"
				aria-invalid={errors.mailUser ? 'true' : undefined}
				aria-describedby={errors.mailUser ? `${ids.user}-error` : undefined}
				bind:value={draft.mailUser}
			/>
			{@render fieldError(ids.user, errors.mailUser)}
		</div>
	{/if}
	{#if !folders}
		<div class="field">
			<label for={ids.secret}>{secretLabel} (Pflichtfeld)</label>
			<input
				id={ids.secret}
				type="text"
				maxlength="64"
				spellcheck="false"
				autocomplete="off"
				aria-required="true"
				aria-invalid={errors.secretEnv ? 'true' : undefined}
				aria-describedby={errors.secretEnv ? `${ids.secret}-error` : undefined}
				bind:value={draft.secretEnv}
			/>
			{@render fieldError(ids.secret, errors.secretEnv)}
		</div>
	{/if}
	{#if draft.type === 'telegram'}
		<div class="field">
			<label for={ids.allowlist}>Name der Variablen für die erlaubten IDs (Pflichtfeld)</label>
			<input
				id={ids.allowlist}
				type="text"
				maxlength="64"
				spellcheck="false"
				autocomplete="off"
				aria-required="true"
				aria-invalid={errors.allowlistEnv ? 'true' : undefined}
				aria-describedby={errors.allowlistEnv ? `${ids.allowlist}-error` : undefined}
				bind:value={draft.allowlistEnv}
			/>
			{@render fieldError(ids.allowlist, errors.allowlistEnv)}
		</div>
	{/if}
	{#if github}
		<p class="note">
			Ohne Token liest die App nur öffentliche Repositorys; die Variable kannst du später setzen.
		</p>
		<GitHubRepoFields bind:draft={repo} errors={repoErrors} />
	{/if}
	{#if folders}
		<FolderFields bind:draft={folder} errors={folderErrors} {platform} />
	{/if}
	{#if formMessage !== null}
		<p class="alert-error" role="alert"><ErrorIcon /><span>{formMessage}</span></p>
	{/if}
	<div>
		<button class="button-secondary" type="submit" aria-disabled={saving}>
			{saving ? 'Wird angelegt …' : 'Verbindung anlegen'}
		</button>
	</div>
</form>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input {
		width: 100%;
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
