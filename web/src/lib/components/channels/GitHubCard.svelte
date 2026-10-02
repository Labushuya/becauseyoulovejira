<script lang="ts">
	import { untrack } from 'svelte';
	import { minuteClock } from '$lib/clock.svelte';
	import { githubInfo } from '$lib/domain/channel-card';
	import { channelHealth } from '$lib/domain/channel-health';
	import {
		lastResultText,
		type Connection,
		type RunResult,
		type SecretStatus
	} from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		AUTO_HINT,
		AUTO_TOKEN_NEEDED,
		EMPTY_GITHUB_SETTINGS,
		GITHUB_INTERVALS,
		GITHUB_LIMITS,
		accessText,
		addMaxMessage,
		autoChangeText,
		autoText,
		eventsText,
		filesText,
		intervalText,
		lastChangeText,
		openPullsText,
		rateText,
		releaseText,
		repoKey,
		withExcluded,
		withRepos,
		withoutExcluded,
		withoutRepo,
		type GitHubRepoSettings,
		type GitHubRepoSummary,
		type GitHubSettings
	} from '$lib/domain/github';
	import { projectChoiceLabel } from '$lib/domain/project-tree';
	import { connectionAnchor } from '$lib/domain/sync-all';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { helpHref } from '$lib/settings-sections';
	import type { GitHubStore } from '$lib/stores/github.svelte';
	import ChipList from '../ChipList.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import Lozenge from '../guidance/Lozenge.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import ChannelCard, { type CardAction, type CardRename } from './ChannelCard.svelte';
	import GitHubRepoDialog from './GitHubRepoDialog.svelte';

	// Card of a GitHub connection (ADR-0050 §7; a configuration of the building block ChannelCard,
	// ADR-0026 KK-2): watched repositories, read only. The main button is "Jetzt abrufen", without a
	// repository "Repository hinzufügen …". The menu holds adding a repository, "Verbindung prüfen"
	// (asks GitHub in the server), the target project, pausing, renaming (KK-3), the setup, the help
	// and deleting. The details say the last run, the access (with or without token), the rate limit
	// of GitHub and the interval (a select that saves at once), the switch "Alle meine Repositorys
	// beobachten" (addendum of 2026-10-02, saves at once), and per watched repository the last change
	// of a watched file, the open pull requests, the last release, the last run, the events, the
	// target project and the watched paths (ChipList, ADR-0026 KL); its actions stand at the
	// repository: "Einstellungen …" and removing for an entered one, "Anpassen …" and "Ausschließen
	// …" for one of "Alle meine Repositorys". Excluded ones can come back. The details come from
	// what the runs stored (no request to GitHub) and load again after every run; "Repository
	// hinzufügen …" offers the repositories of the token as a list.
	let {
		connection,
		secretStatus,
		github,
		running,
		lastRun = null,
		message = null,
		projects = [],
		others = [],
		onrun,
		onpause,
		onsetup,
		ondelete,
		onsave,
		onrename,
		ontarget
	}: {
		connection: Connection;
		/** State of the variable; null while unknown. */
		secretStatus: SecretStatus | null;
		github: GitHubStore;
		/** "Jetzt abrufen" is running. */
		running: boolean;
		/** Answer of the last "Jetzt abrufen" on this page, or null. */
		lastRun?: RunResult | null;
		/** Error of the last action of this card (inline, ADR-0009). */
		message?: string | null;
		/** Every project of the catalog, archived ones included (target projects). */
		projects?: readonly ProjectRef[];
		/** Names of the other connections, for the note about a name that is taken. */
		others?: readonly string[];
		onrun: () => void;
		/** Pauses (false) or resumes (true) the connection. */
		onpause: (enabled: boolean) => void;
		onsetup: () => void;
		ondelete: () => void;
		/** Saves interval and repositories whole; resolves to the error text or null. */
		onsave: (settings: GitHubSettings, announcement: string) => Promise<string | null>;
		/** Saves a new name; resolves to the error text or null (KK-3). */
		onrename?: (label: string) => Promise<string | null>;
		/** Saves the target project of the connection (ADR-0049); resolves to the error or null. */
		ontarget?: (project: ProjectRef | null) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const targetId = `${uid}-target`;
	const intervalId = `${uid}-interval`;
	const autoHintId = `${uid}-auto-hint`;
	let card = $state<ReturnType<typeof ChannelCard>>();
	const rename = $derived<CardRename | null>(
		onrename === undefined ? null : { others, save: onrename }
	);
	const clock = minuteClock();

	const settings = $derived(connection.github ?? EMPTY_GITHUB_SETTINGS);
	const repos = $derived(settings.repos);
	const checking = $derived(github.isChecking(connection.id));
	const health = $derived(channelHealth(connection, secretStatus, running || checking));
	const detailsState = $derived(github.details(connection.id));
	const loaded = $derived(detailsState?.kind === 'ready' ? detailsState.details : null);
	const info = $derived(
		githubInfo(connection, lastRun, clock.now, loaded === null ? null : loaded.repos.length)
	);
	const result = $derived(lastResultText(connection, lastRun));
	const lastRunText = $derived(
		connection.lastRunAt === null ? 'noch nie' : formatBerlinDateTime(connection.lastRunAt)
	);
	const lastOk = $derived(
		connection.lastOkAt !== null && connection.lastOkAt !== connection.lastRunAt
			? formatBerlinDateTime(connection.lastOkAt)
			: null
	);
	const summaries = $derived(
		new Map((loaded?.repos ?? []).map((summary) => [summary.key, summary] as const))
	);

	/** A watched repository of the card: entered (own settings) or of "Alle meine Repositorys". */
	interface Entry {
		key: string;
		repo: GitHubRepoSettings;
		auto: boolean;
	}

	/**
	 * The entered repositories, then those "Alle meine Repositorys" watches (from the details; one
	 * that was entered or excluded just now leaves before the details load again).
	 */
	const entries = $derived.by((): Entry[] => {
		const entered = repos.map((repo) => ({ key: repoKey(repo.repo), repo, auto: false }));
		if (!settings.auto) return entered;
		const taken = new Set([...entered.map((entry) => entry.key), ...settings.exclude.map(repoKey)]);
		const automatic = (loaded?.repos ?? [])
			.filter((summary) => summary.auto && !taken.has(summary.key))
			.map((summary) => ({
				key: summary.key,
				repo: {
					repo: summary.repo,
					paths: summary.paths,
					events: summary.events,
					target: null
				},
				auto: true
			}));
		return [...entered, ...automatic];
	});

	// The details come with the card and again after every run (the stored state changed).
	const connectionId = $derived(connection.id);
	const stamp = $derived(`${connection.lastRunAt ?? ''}|${connection.updated}`);
	$effect(() => {
		const id = connectionId;
		void stamp;
		const controller = new AbortController();
		untrack(() => void github.loadDetails(id, { signal: controller.signal }));
		return () => controller.abort();
	});

	/** Error of the last action in the details (interval, removing); the card shows it. */
	let actionError = $state<string | null>(null);
	/** The dialog of a repository: new ones (`repo` null) or the one to change. */
	let dialog = $state<{ repo: GitHubRepoSettings | null } | null>(null);
	/** The question before removing an entered or excluding an automatic repository. */
	let removing = $state<Entry | null>(null);
	let removingBusy = $state(false);
	let removeError = $state<string | null>(null);
	let savingAuto = $state(false);

	const canAdd = $derived(repos.length < GITHUB_LIMITS.repos);

	function openAdd() {
		actionError = null;
		dialog = { repo: null };
		void github.loadRepoList(connection.id);
	}

	async function saveRepos(added: GitHubRepoSettings[], isNew: boolean): Promise<string | null> {
		const first = added[0]?.repo ?? '';
		const error = await onsave(
			withRepos(settings, added),
			!isNew
				? `Einstellungen von „${first}“ gespeichert.`
				: added.length === 1
					? `„${first}“ zu „${connection.label}“ hinzugefügt.`
					: `${added.length} Repositorys zu „${connection.label}“ hinzugefügt.`
		);
		// The first run after adding sets the starting point, so the card shows the repository at once.
		if (error === null && isNew && health.action === 'run') onrun();
		return error;
	}

	async function saveInterval(value: string) {
		const interval = Number(value);
		if (!Number.isInteger(interval) || interval === settings.interval) return;
		actionError = await onsave(
			{ ...settings, interval },
			`„${connection.label}“ ruft jetzt ${intervalText(interval)} ab.`
		);
	}

	/** "Alle meine Repositorys beobachten": saves at once; switched on, one run reads the list. */
	async function saveAuto(input: HTMLInputElement) {
		const on = input.checked;
		if (on === settings.auto || savingAuto) return;
		savingAuto = true;
		actionError = await onsave(
			{ ...settings, auto: on },
			on
				? `„${connection.label}“ beobachtet jetzt alle deine Repositorys.`
				: `„${connection.label}“ beobachtet nur noch die eingetragenen Repositorys.`
		);
		savingAuto = false;
		// A refusal leaves the switch where the saved value is.
		if (actionError !== null) input.checked = settings.auto;
		else if (on && health.action === 'run') onrun();
	}

	async function includeAgain(name: string) {
		actionError = await onsave(
			withoutExcluded(settings, repoKey(name)),
			`„${name}“ gehört wieder zu „Alle meine Repositorys“.`
		);
	}

	async function confirmRemove() {
		if (removing === null || removingBusy) return;
		removingBusy = true;
		removeError = null;
		const entry = removing;
		const error = entry.auto
			? await onsave(
					withExcluded(settings, entry.repo.repo),
					`„${entry.repo.repo}“ wird nicht mehr automatisch beobachtet.`
				)
			: await onsave(
					withoutRepo(settings, entry.key),
					`„${entry.repo.repo}“ aus „${connection.label}“ entfernt.`
				);
		removingBusy = false;
		if (error === null) removing = null;
		else removeError = error;
	}

	function targetText(repo: GitHubRepoSettings): string {
		if (repo.target === null) return 'wie die Verbindung';
		const project = projects.find((entry) => entry.id === repo.target);
		if (project === undefined) return 'gelöscht, Einträge kommen ohne Zielprojekt';
		return project.archived
			? `${projectChoiceLabel(project)}, archiviert`
			: projectChoiceLabel(project);
	}

	function summaryOf(key: string): GitHubRepoSummary | null {
		return summaries.get(key) ?? null;
	}

	const run: CardAction = { label: 'Jetzt abrufen', onselect: () => onrun() };
	const add: CardAction = { label: 'Repository hinzufügen …', dialog: true, onselect: openAdd };

	const primary = $derived.by((): CardAction => {
		if (health.action === 'none') {
			return { label: checking ? 'Wird geprüft …' : 'Wird abgerufen …', busy: true };
		}
		if (health.action === 'resume') return { label: 'Fortsetzen', onselect: () => onpause(true) };
		if (health.action === 'setup')
			return { label: 'Einrichtung fortsetzen', onselect: () => onsetup() };
		return repos.length === 0 && !settings.auto ? add : run;
	});

	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (health.action === 'run' && primary !== run && (repos.length > 0 || settings.auto)) {
			entries.push(run);
		}
		if (primary !== add && canAdd) entries.push(add);
		if (health.action === 'run') {
			entries.push({
				label: 'Verbindung prüfen',
				onselect: () => void github.check(connection.id, connection.label)
			});
		}
		if (ontarget !== undefined && connection.targetReady !== false) {
			entries.push({ label: 'Zielprojekt …', onselect: () => void card?.showDetails(targetId) });
		}
		if (connection.enabled) entries.push({ label: 'Pausieren', onselect: () => onpause(false) });
		if (rename !== null) {
			entries.push({ label: 'Umbenennen …', onselect: () => void card?.startRename() });
		}
		if (health.action !== 'setup') {
			entries.push({ label: 'Einrichtung ansehen', onselect: () => onsetup() });
		}
		entries.push({ label: 'Hilfe', href: helpHref('github') });
		entries.push({ label: 'Löschen …', dialog: true, separated: true, onselect: () => ondelete() });
		return entries;
	});
</script>

<ChannelCard
	bind:this={card}
	icon="github"
	title={connection.label}
	subtitle="GitHub · Repositorys beobachten, nur lesend"
	status={checking ? { ...health, label: 'Wird geprüft' } : health}
	{info}
	hint={health.hint}
	message={message ?? actionError}
	{primary}
	{menu}
	{rename}
	anchor={connectionAnchor(connection.id)}
>
	{#snippet details()}
		<dl>
			<div>
				<dt>Letzter Abruf</dt>
				<dd>
					{lastRunText}{#if lastOk !== null}, zuletzt erfolgreich {lastOk}{/if}
				</dd>
			</div>
			{#if result !== null}
				<div>
					<dt>Ergebnis</dt>
					<dd>{result}</dd>
				</div>
			{/if}
			{#if loaded !== null}
				<div>
					<dt>Zugang</dt>
					<dd>{accessText(loaded.authenticated, connection.secretEnv)}</dd>
				</div>
				<div>
					<dt>Anfragelimit</dt>
					<dd>{rateText(loaded)}</dd>
				</div>
			{/if}
			<div>
				<dt><label for={intervalId}>Abruf</label></dt>
				<dd>
					<select
						id={intervalId}
						value={String(settings.interval)}
						onchange={(event) => void saveInterval(event.currentTarget.value)}
					>
						{#each GITHUB_INTERVALS as minutes (minutes)}
							<option value={String(minutes)}>{intervalText(minutes)}</option>
						{/each}
						{#if !GITHUB_INTERVALS.includes(settings.interval)}
							<option value={String(settings.interval)}>{intervalText(settings.interval)}</option>
						{/if}
					</select>
				</dd>
			</div>
			{#if connection.lastError !== ''}
				<div>
					<dt>Letzter Fehler</dt>
					<dd>{connection.lastError}</dd>
				</div>
			{/if}
		</dl>
		{#if loaded?.auto}
			{@const auto = loaded.auto}
			{@const locked = !loaded.authenticated && !settings.auto}
			{@const change = autoChangeText(auto)}
			<div class="auto">
				<label class="setting">
					<span>Alle meine Repositorys beobachten</span>
					<input
						type="checkbox"
						role="switch"
						checked={settings.auto}
						aria-describedby={autoHintId}
						aria-disabled={locked ? 'true' : undefined}
						aria-busy={savingAuto ? 'true' : undefined}
						onclick={(event) => {
							if (locked || savingAuto) event.preventDefault();
						}}
						onchange={(event) => void saveAuto(event.currentTarget)}
					/>
				</label>
				<p class="hint" id={autoHintId}>{locked ? AUTO_TOKEN_NEEDED : AUTO_HINT}</p>
				{#if settings.auto}
					<p>{autoText(auto)}</p>
					{#if change !== null}
						<p class="hint">Zuletzt geändert {change}</p>
					{/if}
					{#if auto.error !== ''}
						<p class="repo-error"><ErrorIcon /><span>{auto.error}</span></p>
					{/if}
				{/if}
			</div>
		{/if}
		{#if ontarget !== undefined}
			<CardTargetProject
				id={targetId}
				name={connection.label}
				entries="Neue Einträge dieser Verbindung"
				value={connection.targetProjectId ?? null}
				{projects}
				ready={connection.targetReady !== false}
				onsave={ontarget}
			/>
		{/if}
		<section class="repos" aria-label={`Repositorys von „${connection.label}“`}>
			<h5>Repositorys</h5>
			{#if detailsState?.kind === 'error'}
				<SectionMessage tone="info" compact>{detailsState.message}</SectionMessage>
			{/if}
			{#if entries.length === 0}
				<p class="note">
					{settings.auto
						? 'Noch keins: Der nächste Abruf holt die Liste deiner Repositorys.'
						: 'Noch kein Repository. „Repository hinzufügen …“ trägt eins ein.'}
				</p>
			{:else}
				<ul>
					{#each entries as entry (entry.key)}
						{@const repo = entry.repo}
						{@const summary = summaryOf(entry.key)}
						<li>
							<div class="repo-head">
								<ExternalLink href={summary?.url ?? `https://github.com/${repo.repo}`}>
									{summary?.repo ?? repo.repo}
								</ExternalLink>
								{#if summary?.private}
									<Lozenge label="Privat" icon="info" tone="muted" />
								{/if}
								{#if entry.auto}
									<Lozenge label="Automatisch" icon="info" tone="muted" />
								{/if}
							</div>
							{#if summary !== null && summary.error !== ''}
								<p class="repo-error"><ErrorIcon /><span>{summary.error}</span></p>
							{/if}
							<dl>
								{#if repo.events.files}
									<div>
										<dt>Zuletzt geändert</dt>
										<dd>
											{#if summary?.lastChange && summary.lastChange.url !== ''}
												<ExternalLink href={summary.lastChange.url}
													>{lastChangeText(summary.lastChange)}</ExternalLink
												>
											{:else}
												{lastChangeText(summary?.lastChange ?? null)}
											{/if}
										</dd>
									</div>
								{/if}
								{#if repo.events.pulls}
									<div>
										<dt>Offene PRs</dt>
										<dd>{summary === null ? 'noch nicht abgerufen' : openPullsText(summary)}</dd>
									</div>
								{/if}
								{#if repo.events.releases}
									<div>
										<dt>Letztes Release</dt>
										<dd>{releaseText(summary?.lastRelease ?? null)}</dd>
									</div>
								{/if}
								<div>
									<dt>Abgerufen</dt>
									<dd>
										{summary?.checkedAt ? formatBerlinDateTime(summary.checkedAt) : 'noch nie'}
									</dd>
								</div>
								<div>
									<dt>Ereignisse</dt>
									<dd>{eventsText(repo.events)}</dd>
								</div>
								<div>
									<dt>Zielprojekt</dt>
									<dd>{targetText(repo)}</dd>
								</div>
								{#if repo.events.files}
									<div>
										<dt>Pfade</dt>
										<dd>
											<ChipList
												items={repo.paths}
												label={`Beobachtete Pfade von ${repo.repo}`}
												noun="Muster"
												emptyText="keine"
											/>
										</dd>
									</div>
									{#if summary?.checkedAt}
										<div>
											<dt>Dateien</dt>
											<dd>{filesText(summary)}</dd>
										</div>
									{/if}
								{/if}
							</dl>
							<div class="repo-actions">
								<button
									class="button-subtle"
									type="button"
									aria-haspopup="dialog"
									aria-disabled={entry.auto && !canAdd ? 'true' : undefined}
									title={entry.auto && !canAdd ? addMaxMessage(0) : undefined}
									onclick={() => {
										if (entry.auto && !canAdd) return;
										actionError = null;
										dialog = { repo };
									}}
								>
									{entry.auto ? 'Anpassen …' : 'Einstellungen …'}<span class="visually-hidden"
										>: {repo.repo}</span
									>
								</button>
								<button
									class="button-icon"
									type="button"
									aria-haspopup="dialog"
									aria-label={`${repo.repo} ${entry.auto ? 'ausschließen' : 'entfernen'} …`}
									title={`${repo.repo} ${entry.auto ? 'ausschließen' : 'entfernen'} …`}
									onclick={() => {
										removeError = null;
										removing = entry;
									}}
								>
									<svg
										viewBox="0 0 16 16"
										width="16"
										height="16"
										aria-hidden="true"
										focusable="false"
									>
										<path d="M4 4l8 8M12 4l-8 8" />
									</svg>
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#if settings.exclude.length > 0}
				<div class="excluded">
					<h6>Ausgeschlossen</h6>
					<ul>
						{#each settings.exclude as name (repoKey(name))}
							<li>
								<span class="name">{name}</span>
								<button class="button-subtle" type="button" onclick={() => void includeAgain(name)}>
									Wieder aufnehmen<span class="visually-hidden">: {name}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	{/snippet}
</ChannelCard>

{#if dialog !== null}
	{@const editing = dialog.repo}
	<GitHubRepoDialog
		label={connection.label}
		{settings}
		repo={editing}
		list={editing === null ? github.repoList(connection.id) : null}
		{projects}
		onrefresh={() => void github.loadRepoList(connection.id, { refresh: true })}
		onsave={(added) => saveRepos(added, editing === null)}
		onclose={() => (dialog = null)}
	/>
{/if}

<ConfirmDialog
	open={removing !== null}
	title={removing?.auto
		? `${removing.repo.repo} nicht mehr automatisch beobachten?`
		: `${removing?.repo.repo ?? ''} nicht mehr beobachten?`}
	confirmLabel={removing?.auto ? 'Ausschließen' : 'Entfernen'}
	busy={removingBusy}
	error={removeError}
	onconfirm={() => void confirmRemove()}
	oncancel={() => {
		if (!removingBusy) removing = null;
	}}
>
	{#if removing?.auto}
		<p>
			Die App nimmt es aus „Alle meine Repositorys“ heraus und ruft es nicht mehr ab. Einträge, die
			schon im Eingang sind, bleiben. Unter „Ausgeschlossen“ holst du es zurück.
		</p>
	{:else}
		<p>
			Die App ruft das Repository dann nicht mehr ab. Einträge, die schon im Eingang sind, bleiben;
			ihre Statusanzeige ändert sich nicht mehr.{#if settings.auto}
				Ist es eines deiner eigenen, beobachtet „Alle meine Repositorys“ es danach mit den
				Standard-Einstellungen; ganz heraus nimmt es „Ausschließen …“.{/if}
		</p>
	{/if}
</ConfirmDialog>

<style>
	.repos {
		display: grid;
		gap: 0.5rem;
	}

	h5,
	h6 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.repos ul {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.repos li {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
	}

	.repo-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.repo-error {
		display: inline-flex;
		gap: 0.25rem;
		align-items: flex-start;
		color: var(--color-danger);
	}

	.repo-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		justify-content: flex-end;
	}

	.repo-actions svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.note,
	.hint {
		color: var(--color-text-muted);
	}

	/* "Alle meine Repositorys": a setting row, the name left, the switch right (like "Glas-Effekt"). */
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
		cursor: pointer;
	}

	.setting input {
		flex: none;
	}

	.excluded {
		display: grid;
		gap: 0.25rem;
	}

	.excluded li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		justify-content: space-between;
		padding-top: 0.25rem;
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	select {
		width: 100%;
		padding: 0.25rem 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}
</style>
