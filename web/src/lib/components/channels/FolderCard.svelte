<script lang="ts">
	import { untrack } from 'svelte';
	import { minuteClock } from '$lib/clock.svelte';
	import { folderInfo } from '$lib/domain/channel-card';
	import { channelHealth } from '$lib/domain/channel-health';
	import { lastResultText, type Connection, type RunResult } from '$lib/domain/connections';
	import {
		EMPTY_FOLDER_SETTINGS,
		FOLDER_INTERVALS,
		FOLDER_LIMITS,
		filesText,
		folderIntervalText,
		folderKey,
		folderName,
		folderPlatformOf,
		lastChangeText,
		withFolder,
		withoutFolder,
		type FolderConfig,
		type FolderSettings,
		type FolderSummary
	} from '$lib/domain/folders';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { projectChoiceLabel } from '$lib/domain/project-tree';
	import { connectionAnchor } from '$lib/domain/sync-all';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { helpHref } from '$lib/settings-sections';
	import type { FoldersStore } from '$lib/stores/folders.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import ChipList from '../ChipList.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ConfirmDialog from '../overlay/ConfirmDialog.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import ChannelCard, { type CardAction, type CardRename } from './ChannelCard.svelte';
	import FolderDialog from './FolderDialog.svelte';
	import FolderExistingDialog from './FolderExistingDialog.svelte';

	// Card of a folder connection (ADR-0051 §7; a configuration of the building block ChannelCard,
	// ADR-0026 KK-2): watched folders of this machine, read only. The main button is "Jetzt prüfen",
	// without a folder "Ordner hinzufügen …". The menu holds adding a folder, the target project,
	// renaming (KK-3), pausing, the help and deleting. The details say the last check, its result,
	// the interval (a select that saves at once) and per folder its path, the files watched, the last
	// change, the last check, a problem (neutral: a folder that is not reachable keeps its files),
	// subfolders, types and exclusions (ChipList, ADR-0026 KL), the target project and whether
	// changes are reported; its actions "Einstellungen …", "Vorhandene Dateien übernehmen …" and
	// removing stand at the folder. The details come from what the runs stored (nothing reads a
	// folder for them) and load again after every run. Folders have no access data, so there is no
	// state of a variable and no setup to continue.
	let {
		connection,
		folders,
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
		folders: FoldersStore;
		/** "Jetzt prüfen" is running. */
		running: boolean;
		/** Answer of the last "Jetzt prüfen" on this page, or null. */
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
		/** Saves interval and folders whole; resolves to the error text or null. */
		onsave: (settings: FolderSettings, announcement: string) => Promise<string | null>;
		/** Saves a new name; resolves to the error text or null (KK-3). */
		onrename?: (label: string) => Promise<string | null>;
		/** Saves the target project of the connection (ADR-0049); resolves to the error or null. */
		ontarget?: (project: ProjectRef | null) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	const targetId = `${uid}-target`;
	const intervalId = `${uid}-interval`;
	let card = $state<ReturnType<typeof ChannelCard>>();
	const rename = $derived<CardRename | null>(
		onrename === undefined ? null : { others, save: onrename }
	);
	const clock = minuteClock();
	const host = findHostStore();

	const settings = $derived(connection.folders ?? EMPTY_FOLDER_SETTINGS);
	const list = $derived(settings.folders);
	const health = $derived(channelHealth(connection, null, running));
	const info = $derived(folderInfo(connection, lastRun, clock.now));
	const result = $derived(lastResultText(connection, lastRun));
	const lastRunText = $derived(
		connection.lastRunAt === null ? 'noch nie' : formatBerlinDateTime(connection.lastRunAt)
	);
	const lastOk = $derived(
		connection.lastOkAt !== null && connection.lastOkAt !== connection.lastRunAt
			? formatBerlinDateTime(connection.lastOkAt)
			: null
	);
	const detailsState = $derived(folders.details(connection.id));
	const loaded = $derived(detailsState?.kind === 'ready' ? detailsState.details : null);
	const summaries = $derived(
		new Map((loaded?.folders ?? []).map((summary) => [summary.key, summary] as const))
	);
	/** The paths follow the system of the server: its own answer, else the platform it reports. */
	const platform = $derived(
		loaded?.platform ?? folderPlatformOf(host?.platform ?? DEFAULT_HOST_PLATFORM)
	);
	const limit = $derived(loaded?.limit ?? FOLDER_LIMITS.files);

	// The details come with the card and again after every run (the stored state changed).
	const connectionId = $derived(connection.id);
	const stamp = $derived(`${connection.lastRunAt ?? ''}|${connection.updated}`);
	$effect(() => {
		const id = connectionId;
		void stamp;
		const controller = new AbortController();
		untrack(() => void folders.loadDetails(id, { signal: controller.signal }));
		return () => controller.abort();
	});

	/** Error of the last action in the details (interval); the card shows it. */
	let actionError = $state<string | null>(null);
	/** The dialog of a folder: a new one (`folder` null) or the one to change. */
	let dialog = $state<{ folder: FolderConfig | null } | null>(null);
	/** The folder whose files of before are chosen ("Vorhandene Dateien übernehmen …"). */
	let existing = $state<FolderSummary | null>(null);
	let removing = $state<FolderConfig | null>(null);
	let removingBusy = $state(false);
	let removeError = $state<string | null>(null);

	const canAdd = $derived(list.length < FOLDER_LIMITS.folders);

	function openAdd() {
		actionError = null;
		dialog = { folder: null };
	}

	async function saveFolder(folder: FolderConfig, added: boolean): Promise<string | null> {
		const error = await onsave(
			withFolder(settings, folder),
			added
				? `„${folderName(folder.path)}“ zu „${connection.label}“ hinzugefügt.`
				: `Einstellungen von „${folderName(folder.path)}“ gespeichert.`
		);
		// The first check after adding takes the base, so the card shows the folder at once.
		if (error === null && added && health.action === 'run') onrun();
		return error;
	}

	async function saveInterval(value: string) {
		const interval = Number(value);
		if (!Number.isInteger(interval) || interval === settings.interval) return;
		actionError = await onsave(
			{ ...settings, interval },
			`„${connection.label}“ prüft jetzt ${folderIntervalText(interval)}.`
		);
	}

	async function confirmRemove() {
		if (removing === null || removingBusy) return;
		removingBusy = true;
		removeError = null;
		const folder = removing;
		const error = await onsave(
			withoutFolder(settings, folderKey(folder.path)),
			`„${folderName(folder.path)}“ aus „${connection.label}“ entfernt.`
		);
		removingBusy = false;
		if (error === null) removing = null;
		else removeError = error;
	}

	function targetText(folder: FolderConfig): string {
		if (folder.target === null) return 'wie die Verbindung';
		const project = projects.find((entry) => entry.id === folder.target);
		if (project === undefined) return 'gelöscht, Einträge kommen ohne Zielprojekt';
		return project.archived
			? `${projectChoiceLabel(project)}, archiviert`
			: projectChoiceLabel(project);
	}

	function summaryOf(folder: FolderConfig): FolderSummary | null {
		return summaries.get(folderKey(folder.path)) ?? null;
	}

	function checkedText(summary: FolderSummary | null): string {
		if (summary === null || summary.baseAt === '') return 'noch nie';
		if (summary.pending) return 'steht aus, der letzte Lauf kam nicht bis zu diesem Ordner';
		return lastRunText;
	}

	const run: CardAction = { label: 'Jetzt prüfen', onselect: () => onrun() };
	const add: CardAction = { label: 'Ordner hinzufügen …', dialog: true, onselect: openAdd };

	const primary = $derived.by((): CardAction => {
		if (health.action === 'none') return { label: 'Wird geprüft …', busy: true };
		if (health.action === 'resume') return { label: 'Fortsetzen', onselect: () => onpause(true) };
		if (health.action === 'setup')
			return { label: 'Einrichtung fortsetzen', onselect: () => onsetup() };
		return list.length === 0 ? add : run;
	});

	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (primary !== add && canAdd) entries.push(add);
		if (health.action === 'run' && primary !== run && list.length > 0) entries.push(run);
		if (ontarget !== undefined && connection.targetReady !== false) {
			entries.push({ label: 'Zielprojekt …', onselect: () => void card?.showDetails(targetId) });
		}
		if (rename !== null) {
			entries.push({ label: 'Umbenennen …', onselect: () => void card?.startRename() });
		}
		if (connection.enabled) entries.push({ label: 'Pausieren', onselect: () => onpause(false) });
		entries.push({ label: 'Hilfe', href: helpHref('ordner') });
		entries.push({ label: 'Löschen …', dialog: true, separated: true, onselect: () => ondelete() });
		return entries;
	});
</script>

<ChannelCard
	bind:this={card}
	icon="folder"
	title={connection.label}
	subtitle="Ordner · Dateien beobachten, nur lesend"
	status={health}
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
				<dt>Letzte Prüfung</dt>
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
			<div>
				<dt><label for={intervalId}>Prüfen</label></dt>
				<dd>
					<select
						id={intervalId}
						value={String(settings.interval)}
						onchange={(event) => void saveInterval(event.currentTarget.value)}
					>
						{#each FOLDER_INTERVALS as minutes (minutes)}
							<option value={String(minutes)}>{folderIntervalText(minutes)}</option>
						{/each}
						{#if !FOLDER_INTERVALS.includes(settings.interval)}
							<option value={String(settings.interval)}>
								{folderIntervalText(settings.interval)}
							</option>
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
		<section class="folders" aria-label={`Ordner von „${connection.label}“`}>
			<h5>Ordner</h5>
			{#if detailsState?.kind === 'error'}
				<SectionMessage tone="info" compact>{detailsState.message}</SectionMessage>
			{/if}
			{#if list.length === 0}
				<p class="note">Noch kein Ordner. „Ordner hinzufügen …“ trägt einen ein.</p>
			{:else}
				<ul>
					{#each list as folder (folderKey(folder.path))}
						{@const summary = summaryOf(folder)}
						{@const name = folderName(folder.path)}
						<li>
							<p class="folder-path">{folder.path}</p>
							{#if summary !== null && summary.error !== ''}
								<SectionMessage tone="warning" compact>{summary.error}</SectionMessage>
							{/if}
							<dl>
								<div>
									<dt>Dateien</dt>
									<dd>{summary === null ? 'noch nicht erfasst' : filesText(summary, limit)}</dd>
								</div>
								<div>
									<dt>Zuletzt geändert</dt>
									<dd>{lastChangeText(summary?.lastChange ?? null)}</dd>
								</div>
								<div>
									<dt>Geprüft</dt>
									<dd>{checkedText(summary)}</dd>
								</div>
								<div>
									<dt>Unterordner</dt>
									<dd>{folder.subfolders ? 'einbezogen' : 'nicht einbezogen'}</dd>
								</div>
								<div>
									<dt>Dateitypen</dt>
									<dd>
										<ChipList
											items={folder.types}
											label={`Dateitypen von ${name}`}
											noun="Dateitypen"
											emptyText="alle"
										/>
									</dd>
								</div>
								<div>
									<dt>Ausschlüsse</dt>
									<dd>
										<ChipList
											items={folder.exclude}
											label={`Ausschlüsse von ${name}`}
											noun="Muster"
											emptyText="keine"
										/>
									</dd>
								</div>
								<div>
									<dt>Zielprojekt</dt>
									<dd>{targetText(folder)}</dd>
								</div>
								<div>
									<dt>Änderungen</dt>
									<dd>{folder.reportChanges ? 'werden gemeldet' : 'nur in der Statusanzeige'}</dd>
								</div>
							</dl>
							<div class="folder-actions">
								<button
									class="button-subtle"
									type="button"
									aria-haspopup="dialog"
									onclick={() => {
										actionError = null;
										dialog = { folder };
									}}
								>
									Einstellungen …<span class="visually-hidden">: {name}</span>
								</button>
								{#if summary !== null && summary.baseAt !== ''}
									<button
										class="button-subtle"
										type="button"
										aria-haspopup="dialog"
										onclick={() => (existing = summary)}
									>
										Vorhandene Dateien übernehmen …<span class="visually-hidden">: {name}</span>
									</button>
								{/if}
								<button
									class="button-icon"
									type="button"
									aria-haspopup="dialog"
									aria-label={`${name} entfernen …`}
									title={`${name} entfernen …`}
									onclick={() => {
										removeError = null;
										removing = folder;
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
		</section>
	{/snippet}
</ChannelCard>

{#if dialog !== null}
	{@const editing = dialog.folder}
	<FolderDialog
		label={connection.label}
		{settings}
		folder={editing}
		{platform}
		{projects}
		onsave={(folder) => saveFolder(folder, editing === null)}
		onclose={() => (dialog = null)}
	/>
{/if}

{#if existing !== null}
	<FolderExistingDialog
		connectionId={connection.id}
		folderId={existing.id}
		label={connection.label}
		{folders}
		onclose={() => (existing = null)}
	/>
{/if}

<ConfirmDialog
	open={removing !== null}
	title={`„${removing === null ? '' : folderName(removing.path)}“ nicht mehr beobachten?`}
	confirmLabel="Entfernen"
	busy={removingBusy}
	error={removeError}
	onconfirm={() => void confirmRemove()}
	oncancel={() => {
		if (!removingBusy) removing = null;
	}}
>
	<p>
		Die App prüft den Ordner dann nicht mehr. Einträge, die schon im Eingang sind, bleiben; ihre
		Statusanzeige ändert sich nicht mehr. Die Dateien im Ordner bleiben unberührt.
	</p>
</ConfirmDialog>

<style>
	.folders {
		display: grid;
		gap: 0.5rem;
	}

	h5 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.folders ul {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.folders li {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
	}

	.folder-path {
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.folder-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		justify-content: flex-end;
	}

	.folder-actions svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.note {
		color: var(--color-text-muted);
	}

	select {
		width: 100%;
		padding: 0.25rem 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}
</style>
