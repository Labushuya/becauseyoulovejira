<script lang="ts">
	import { untrack } from 'svelte';
	import { channelHealth } from '$lib/domain/channel-health';
	import type { Connection, SecretStatus } from '$lib/domain/connections';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import {
		NOTION_SOURCE_TYPE_LABELS,
		importedSummary,
		type NotionImportedSource
	} from '$lib/domain/notion';
	import { connectionAnchor } from '$lib/domain/sync-all';
	import { helpHref } from '$lib/settings-sections';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import Lozenge from '../guidance/Lozenge.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import Popover from '../overlay/Popover.svelte';
	import ChannelIcon from './ChannelIcon.svelte';

	// Card of a Notion connection (ADR-0041 §9, plan notion-import NI-2): like the other cards
	// (ADR-0026 section 3) with state as lozenge, but Notion fetches nothing by itself. The main
	// action opens the import dialog ("Listen übernehmen …"); "Verbindung prüfen" asks Notion with
	// the token. Below, the sources taken over so far (from the inbox, no request to Notion) with
	// "Erneut abrufen", which takes only entries that are not in the inbox yet. No "Pausieren" and
	// no keywords: the user chooses what comes in.
	let {
		connection,
		secretStatus,
		notion,
		message = null,
		onimport,
		onchanged,
		onpause,
		onsetup,
		ondelete
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
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-name`;
	const listId = `${uid}-imports`;

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
	const busy = $derived(checking || refetching !== null);
	const health = $derived(channelHealth(connection, secretStatus, busy));
	const imports = $derived(notion.imports(connection.id));
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

	function sourceMeta(source: NotionImportedSource): string {
		const entries = source.count === 1 ? '1 Eintrag' : `${source.count} Einträge`;
		const last = source.last === null ? '' : ` · zuletzt ${formatBerlinDateTime(source.last)}`;
		return `${NOTION_SOURCE_TYPE_LABELS[source.type]} · ${entries}${last}`;
	}
</script>

<article
	class="channel-card"
	id={connectionAnchor(connection.id)}
	tabindex="-1"
	aria-labelledby={headingId}
	data-state={health.state}
>
	<header class="head">
		<ChannelIcon kind="notion" />
		<div class="names">
			<h4 id={headingId}>{connection.label}</h4>
			<p class="kind">Notion · Listen übernehmen, nur lesend</p>
		</div>
		<Lozenge label={health.label} icon={health.icon} tone={health.tone} />
	</header>

	<dl class="meta">
		<div>
			<dt>Letzter Abruf</dt>
			<dd>{lastRunText}</dd>
		</div>
		<div>
			<dt>Übernommen</dt>
			<dd>{imports === null ? 'wird geladen …' : importedSummary(imports)}</dd>
		</div>
	</dl>

	{#if health.hint !== null}
		<SectionMessage tone={health.hint.tone} compact>{health.hint.text}</SectionMessage>
	{/if}
	{#if message !== null}
		<SectionMessage tone="error" compact live>{message}</SectionMessage>
	{/if}

	{#if imports !== null && imports.length > 0}
		<section class="imports" aria-labelledby={listId}>
			<h5 id={listId}>Bisher übernommen</h5>
			<ul>
				{#each imports as source (source.id)}
					<li>
						<div class="source">
							<ExternalLink href={source.url}>{source.title}</ExternalLink>
							<span class="source-meta">{sourceMeta(source)}</span>
						</div>
						<button
							class="button-subtle"
							type="button"
							aria-busy={refetching === source.id}
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
	{#if refetchError !== null}
		<SectionMessage tone="error" compact live>{refetchError}</SectionMessage>
	{/if}
	<p class="note"><a href={helpHref('notion')}>So geht’s</a></p>

	<footer class="actions">
		{#if health.action === 'resume'}
			<button class="button-secondary" type="button" onclick={() => onpause(true)}>
				Fortsetzen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else if health.action === 'setup'}
			<button class="button-secondary" type="button" onclick={onsetup}>
				Einrichtung fortsetzen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else if health.action === 'run'}
			<button class="button-secondary" type="button" aria-haspopup="dialog" onclick={onimport}>
				Listen übernehmen …<span class="visually-hidden">: {connection.label}</span>
			</button>
			<button class="button-secondary" type="button" onclick={() => void check()}>
				Verbindung prüfen<span class="visually-hidden">: {connection.label}</span>
			</button>
		{:else}
			<button class="button-secondary" type="button" aria-disabled="true" aria-busy="true">
				{checking ? 'Wird geprüft …' : 'Wird abgerufen …'}<span class="visually-hidden"
					>: {connection.label}</span
				>
			</button>
		{/if}
		<span class="more">
			<Popover
				kind="menu"
				label={`Weitere Aktionen für ${connection.label}`}
				placement="bottom-end"
				buttonClass="button-icon"
				buttonLabel={`Weitere Aktionen für ${connection.label}`}
			>
				{#snippet button()}
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
						<circle cx="3.5" cy="8" r="1.1" />
						<circle cx="8" cy="8" r="1.1" />
						<circle cx="12.5" cy="8" r="1.1" />
					</svg>
				{/snippet}
				{#snippet children({ close })}
					<button
						type="button"
						role="menuitem"
						tabindex="-1"
						onclick={() => {
							close();
							onsetup();
						}}
					>
						Einrichtung ansehen
					</button>
					<div role="separator"></div>
					<button
						type="button"
						role="menuitem"
						tabindex="-1"
						aria-haspopup="dialog"
						onclick={() => {
							close();
							ondelete();
						}}
					>
						Löschen …
					</button>
				{/snippet}
			</Popover>
		</span>
	</footer>
</article>

<style>
	.channel-card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.names {
		flex: 1;
		min-width: 0;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h5 {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.kind,
	.source-meta,
	.note,
	dt {
		color: var(--color-text-muted);
	}

	.kind,
	.meta,
	.note {
		font-size: var(--font-size-control);
	}

	.meta {
		display: grid;
		gap: 0.25rem;
	}

	.meta div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	dd {
		overflow-wrap: anywhere;
	}

	.imports {
		display: grid;
		gap: 0.5rem;
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
		font-size: var(--font-size-control);
		overflow-wrap: anywhere;
	}

	.source-meta {
		font-size: var(--font-size-small);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-end;
		align-self: end;
	}

	.note a {
		color: var(--color-brand-text);
	}

	.more {
		display: inline-flex;
		margin-left: auto;
	}

	.more svg {
		fill: currentColor;
	}
</style>
