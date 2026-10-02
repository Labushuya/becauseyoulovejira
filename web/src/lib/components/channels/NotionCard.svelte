<script lang="ts">
	import { untrack } from 'svelte';
	import { minuteClock } from '$lib/clock.svelte';
	import { notionInfo } from '$lib/domain/channel-card';
	import { channelHealth } from '$lib/domain/channel-health';
	import type { Connection, SecretStatus } from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		NOTION_SOURCE_TYPE_LABELS,
		refetchProgressText,
		sourceResultText,
		type NotionImportedSource
	} from '$lib/domain/notion';
	import { connectionAnchor } from '$lib/domain/sync-all';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { helpHref } from '$lib/settings-sections';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import CardTargetProject from './CardTargetProject.svelte';
	import ChannelCard, { type CardAction, type CardRename } from './ChannelCard.svelte';

	// Card of a Notion connection (ADR-0041 §9, plan notion-import NI-2; since the plan kanal-karten
	// KK-2 a configuration of the building block ChannelCard): Notion fetches nothing by itself, so
	// the main button opens the import dialog ("Listen übernehmen …"). "Verbindung prüfen" asks
	// Notion with the token (menu "•••"). The details list the sources taken over so far (from the
	// inbox, no request to Notion), each with "Erneut abrufen", which takes only entries that are
	// not in the inbox yet, and the result of its last "Erneut abrufen" on this page. "Alle erneut
	// abrufen" (menu, ADR-0041 addendum of 2026-10-01) does that for every source, one after the
	// other: the info line names the source with a bar, the main button stops after the current
	// block. No "Pausieren" and no keywords: the user chooses what comes in. With `onrename` the
	// menu offers "Umbenennen …" in the card (ADR-0026, addendum KK-3), with `ontarget` the details
	// hold "Zielprojekt" for the entries of the next imports and the menu leads there (ADR-0049).
	let {
		connection,
		secretStatus,
		notion,
		message = null,
		onimport,
		onchanged,
		onpause,
		onsetup,
		ondelete,
		onrename,
		ontarget,
		projects = [],
		others = []
	}: {
		connection: Connection;
		/** State of the variable; null while unknown. */
		secretStatus: SecretStatus | null;
		notion: NotionStore;
		/** Error of the last action of this card (inline, ADR-0009). */
		message?: string | null;
		/** Opens the import dialog of this connection. */
		onimport: () => void;
		/** A request to Notion changed the state of the connection on the server (last run, error). */
		onchanged: () => void;
		/** Resumes a paused connection (paused only outside the app). */
		onpause: (enabled: boolean) => void;
		onsetup: () => void;
		ondelete: () => void;
		/** Saves a new name; resolves to the error text or null (KK-3). Without it, no renaming. */
		onrename?: (label: string) => Promise<string | null>;
		/** Saves the target project of new entries (ADR-0049); without it, the card has no setting. */
		ontarget?: (project: ProjectRef | null) => Promise<string | null>;
		/** Every project of the catalog, archived ones included (the target project). */
		projects?: readonly ProjectRef[];
		/** Names of the other connections, for the note about a name that is taken. */
		others?: readonly string[];
	} = $props();

	const uid = $props.id();
	const targetId = `${uid}-target`;
	let card = $state<ReturnType<typeof ChannelCard>>();
	const rename = $derived<CardRename | null>(
		onrename === undefined ? null : { others, save: onrename }
	);
	const clock = minuteClock();
	const connectionId = $derived(connection.id);
	// The sources taken over so far come with the card, from the inbox of the server.
	$effect(() => {
		const id = connectionId;
		const controller = new AbortController();
		untrack(() => void notion.loadImports(id, { signal: controller.signal }));
		return () => controller.abort();
	});

	const checking = $derived(notion.isChecking(connection.id));
	const refetching = $derived(notion.refetching(connection.id));
	const progress = $derived(notion.refetchProgress(connection.id));
	const stopping = $derived(notion.isStopping(connection.id));
	const busy = $derived(checking || refetching !== null);
	const health = $derived(channelHealth(connection, secretStatus, busy));
	const imports = $derived(notion.imports(connection.id));
	const info = $derived(
		progress === null
			? notionInfo(imports, connection.lastRunAt, clock.now)
			: refetchProgressText(progress.index, progress.total, progress.title)
	);
	const lastRunText = $derived(
		connection.lastRunAt === null ? 'noch nie' : formatBerlinDateTime(connection.lastRunAt)
	);

	let refetchError = $state<string | null>(null);

	async function check() {
		refetchError = null;
		await notion.check(connection.id, connection.label);
		onchanged();
	}

	async function refetch(source: NotionImportedSource) {
		if (busy) return;
		refetchError = null;
		refetchError = await notion.refetch(connection.id, source);
		onchanged();
	}

	/** Errors stand at their source and in the flag, so the card keeps no message of its own. */
	async function refetchAll() {
		if (busy) return;
		refetchError = null;
		await notion.refetchAll(connection.id);
		onchanged();
	}

	function sourceMeta(source: NotionImportedSource): string {
		const entries = source.count === 1 ? '1 Eintrag' : `${source.count} Einträge`;
		const last = source.last === null ? '' : ` · zuletzt ${formatBerlinDateTime(source.last)}`;
		return `${NOTION_SOURCE_TYPE_LABELS[source.type]} · ${entries}${last}`;
	}

	const primary = $derived.by((): CardAction => {
		if (progress !== null) {
			return stopping
				? { label: 'Hält nach diesem Block an …', busy: true }
				: {
						label: 'Nach diesem Block anhalten',
						onselect: () => notion.stopRefetch(connection.id)
					};
		}
		if (health.action === 'none') {
			return { label: checking ? 'Wird geprüft …' : 'Wird abgerufen …', busy: true };
		}
		if (health.action === 'resume') return { label: 'Fortsetzen', onselect: () => onpause(true) };
		if (health.action === 'setup')
			return { label: 'Einrichtung fortsetzen', onselect: () => onsetup() };
		return { label: 'Listen übernehmen …', dialog: true, onselect: () => onimport() };
	});

	const menu = $derived.by((): CardAction[] => {
		const entries: CardAction[] = [];
		if (health.action === 'run') {
			entries.push({ label: 'Verbindung prüfen', onselect: () => void check() });
			if (imports !== null && imports.length > 0) {
				entries.push({ label: 'Alle erneut abrufen', onselect: () => void refetchAll() });
			}
		}
		if (ontarget !== undefined && connection.targetReady !== false) {
			entries.push({ label: 'Zielprojekt …', onselect: () => void card?.showDetails(targetId) });
		}
		if (rename !== null) {
			entries.push({ label: 'Umbenennen …', onselect: () => void card?.startRename() });
		}
		if (health.action !== 'setup') {
			entries.push({ label: 'Einrichtung ansehen', onselect: () => onsetup() });
		}
		entries.push({ label: 'Hilfe', href: helpHref('notion') });
		entries.push({ label: 'Löschen …', dialog: true, separated: true, onselect: () => ondelete() });
		return entries;
	});
</script>

<ChannelCard
	bind:this={card}
	icon="notion"
	title={connection.label}
	subtitle="Notion · Listen übernehmen, nur lesend"
	status={checking ? { ...health, label: 'Wird geprüft' } : health}
	{info}
	progress={progress === null ? null : { value: progress.index - 1, max: progress.total }}
	busy={progress !== null}
	hint={health.hint}
	message={message ?? refetchError}
	{primary}
	{menu}
	{rename}
	anchor={connectionAnchor(connection.id)}
>
	{#snippet details()}
		<dl>
			<div>
				<dt>Letzter Abruf</dt>
				<dd>{lastRunText}</dd>
			</div>
		</dl>
		{#if ontarget !== undefined}
			<CardTargetProject
				id={targetId}
				name={connection.label}
				entries="Einträge der nächsten Übernahmen"
				value={connection.targetProjectId ?? null}
				{projects}
				ready={connection.targetReady !== false}
				onsave={ontarget}
			/>
		{/if}
		{#if imports === null}
			<p class="note">Übernommene Listen werden geladen …</p>
		{:else if imports.length === 0}
			<p class="note">Noch nichts übernommen.</p>
		{:else}
			<section class="imports" aria-label="Bisher übernommen">
				<h5>Bisher übernommen</h5>
				<ul>
					{#each imports as source (source.id)}
						{@const result = notion.refetchResult(connection.id, source.id)}
						<li>
							<div class="source">
								<ExternalLink href={source.url}>{source.title}</ExternalLink>
								<span class="source-meta">{sourceMeta(source)}</span>
								{#if result !== null}
									<span class="source-result" class:failed={result.error !== null}>
										{#if result.error !== null}<ErrorIcon />{/if}
										<span>Erneut abgerufen: {sourceResultText(result)}</span>
									</span>
								{/if}
							</div>
							<button
								class="button-subtle"
								type="button"
								aria-busy={refetching === source.id ? 'true' : undefined}
								aria-disabled={busy || health.action !== 'run' ? 'true' : undefined}
								onclick={() => {
									if (health.action === 'run') void refetch(source);
								}}
							>
								{refetching === source.id ? 'Wird abgerufen …' : 'Erneut abrufen'}<span
									class="visually-hidden">: {source.title}</span
								>
							</button>
						</li>
					{/each}
				</ul>
				<p class="note">„Erneut abrufen“ übernimmt nur Einträge, die noch nicht im Eingang sind.</p>
			</section>
		{/if}
	{/snippet}
</ChannelCard>

<style>
	.imports {
		display: grid;
		gap: 0.5rem;
	}

	h5 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.imports ul {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.imports li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		justify-content: space-between;
	}

	.source {
		display: grid;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.source-meta,
	.source-result {
		font-size: var(--font-size-small);
	}

	.source-result {
		display: inline-flex;
		gap: 0.25rem;
		align-items: flex-start;
	}

	.note,
	.source-meta,
	.source-result {
		color: var(--color-text-muted);
	}

	.source-result.failed {
		color: var(--color-danger);
	}
</style>
