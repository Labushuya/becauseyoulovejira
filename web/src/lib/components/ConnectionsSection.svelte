<script lang="ts">
	import { tick } from 'svelte';
	import {
		settingsDraftOf,
		telegramRepliesAnnouncement,
		type Connection,
		type ConnectionSettingsDraft,
		type TelegramRepliesChange
	} from '$lib/domain/connections';
	import { cardAnchorOf } from '$lib/domain/sync-all';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import {
		CONNECTIONS_UNAVAILABLE_MESSAGE,
		type ConnectionsStore
	} from '$lib/stores/connections.svelte';
	import type { FoldersStore } from '$lib/stores/folders.svelte';
	import type { GitHubStore } from '$lib/stores/github.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import ChannelEditModal from './channels/ChannelEditModal.svelte';
	import ConnectionCard from './channels/ConnectionCard.svelte';
	import FolderCard from './channels/FolderCard.svelte';
	import GitHubCard from './channels/GitHubCard.svelte';
	import NotionCard from './channels/NotionCard.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MailboxPicker from './MailboxPicker.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// "Deine Verbindungen" on the page "Kanäle" (E4 plan, packages 10, 15, 20, 22 and 23; ADR-0026
	// section 3, plan EH-3; since the plan kanal-karten KK-2 on the building block ChannelCard): a
	// grid of cards with the state of each connection as lozenge. The card runs a fetch ("Jetzt
	// abrufen", results as flags), opens the mailbox selection, pauses and resumes, and asks before
	// deleting; "Stichwörter und Einstellungen …" opens a modal with keywords and switches that save
	// at once. Access data are Windows user variables; the app stores only their names (ADR-0018).
	// New connections come from the catalog below (ChannelCatalog). A Notion connection (ADR-0041)
	// has its own configuration: it fetches nothing by itself and opens the import dialog. Every
	// card has the target project of its new entries in its details (ADR-0049). A GitHub connection
	// (ADR-0050) keeps its repositories in its card: add, change, remove, the interval. A folder
	// connection (ADR-0051) keeps its folders the same way and takes files of before on request.
	let {
		store,
		notion,
		github,
		folders,
		projects = [],
		onadd,
		onsetup,
		onimport
	}: {
		store: ConnectionsStore;
		/** Notion import (ADR-0041) for the cards of Notion connections. */
		notion: NotionStore;
		/** Details and "Verbindung prüfen" of the cards of GitHub connections (ADR-0050). */
		github: GitHubStore;
		/** Details and the files of before of the cards of folder connections (ADR-0051). */
		folders: FoldersStore;
		/** Every project of the catalog, archived ones included (target projects, ADR-0049). */
		projects?: readonly ProjectRef[];
		/** "Kanal hinzufügen" of the empty state: to the catalog. */
		onadd: () => void;
		/** Shows the setup of the kind of a connection. */
		onsetup: (connection: Connection) => void;
		/** Opens the import dialog of a Notion connection. */
		onimport: (connection: Connection) => void;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	let pendingDelete = $state<Connection | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	/** Error of the last action of a card, by connection. */
	let cardMessage = $state<{ id: string; text: string } | null>(null);
	/** Error of the last switch in the edit modal. */
	let editMessage = $state<string | null>(null);
	let picking = $state<Connection | null>(null);
	let editingId = $state<string | null>(null);

	const editing = $derived(
		editingId === null ? null : (store.connections.find((item) => item.id === editingId) ?? null)
	);
	const countLabel = $derived(
		store.connections.length === 1 ? '1 Verbindung' : `${store.connections.length} Verbindungen`
	);

	// "Zur Karte" in the flag of "Alle Kanäle jetzt abrufen" opens this page with #verbindung-<id>:
	// once the cards are there, that card takes the focus (and scrolls into view), once per address.
	let focusedHash = '';
	$effect(() => {
		if (store.state !== 'ready' || store.connections.length === 0) return;
		const hash = window.location.hash;
		const anchor = cardAnchorOf(hash);
		if (anchor === null || hash === focusedHash) return;
		focusedHash = hash;
		void tick().then(() => document.getElementById(anchor)?.focus());
	});

	function messageOf(connection: Connection): string | null {
		return cardMessage !== null && cardMessage.id === connection.id ? cardMessage.text : null;
	}

	// Every card follows its connection through realtime while the page is open: the progress of
	// the full scan of an inbox shows as the mail helper reports it (ADR-0020, addendum 3), and a
	// name changed in another tab shows at once (ADR-0026, addendum KK-3); no polling (CLAUDE.md
	// §7). One subscription per connection, ended with the page.
	const watchedIds = $derived(store.connections.map((connection) => connection.id).join(','));
	$effect(() => {
		const ids = watchedIds === '' ? [] : watchedIds.split(',');
		const stops = ids.map((id) => store.watch(id));
		return () => {
			for (const stop of stops) stop();
		};
	});

	/** Names of the other connections, for the note about a name that is taken (KK-3). */
	function othersOf(connection: Connection): string[] {
		return store.connections.filter((item) => item.id !== connection.id).map((item) => item.label);
	}

	async function scan(connection: Connection, action: 'start' | 'cancel') {
		cardMessage = null;
		const result = await store.scan(connection.id, action);
		if (!result.ok && result.message !== null)
			cardMessage = { id: connection.id, text: result.message };
	}

	async function setEnabled(connection: Connection, enabled: boolean) {
		cardMessage = null;
		const result = await store.setEnabled(connection.id, enabled);
		if (!result.ok && result.message !== null)
			cardMessage = { id: connection.id, text: result.message };
	}

	async function runNow(connection: Connection) {
		cardMessage = null;
		const result = await store.runNow(connection.id);
		if (!result.ok && result.message !== null)
			cardMessage = { id: connection.id, text: result.message };
	}

	async function saveKeywords(connection: Connection, keywords: string[], announcement: string) {
		const result = await store.saveSettings(
			connection.id,
			{ ...settingsDraftOf(connection), keywords },
			announcement
		);
		if (result.ok) return null;
		return (
			result.message ??
			Object.values(result.fields)[0] ??
			'Die Stichwörter ließen sich nicht speichern.'
		);
	}

	/**
	 * Saves one switch of a connection; an error stays where the switch is: in the edit modal or
	 * at the card (switches of the Telegram answers in its details).
	 */
	async function saveSwitch(
		connection: Connection,
		change: Partial<ConnectionSettingsDraft>,
		announcement: string,
		place: 'modal' | 'card' = 'modal'
	) {
		if (place === 'card') cardMessage = null;
		else editMessage = null;
		const result = await store.saveSettings(
			connection.id,
			{ ...settingsDraftOf(connection), ...change },
			announcement
		);
		if (result.ok) return;
		const text =
			result.message ??
			Object.values(result.fields)[0] ??
			'Die Einstellung ließ sich nicht speichern.';
		if (place === 'card') cardMessage = { id: connection.id, text };
		else editMessage = text;
	}

	/** Telegram: one of the two answers of the bot in the chat (ADR-0016, addendum of 2026-10-01). */
	function saveReplies(
		connection: Connection,
		change: TelegramRepliesChange,
		place: 'modal' | 'card'
	): Promise<void> {
		return saveSwitch(
			connection,
			change,
			telegramRepliesAnnouncement(connection.label, change),
			place
		);
	}

	async function confirmDelete() {
		if (pendingDelete === null) return;
		deleting = true;
		deleteError = null;
		const result = await store.remove(pendingDelete.id);
		deleting = false;
		if (result.ok) pendingDelete = null;
		else deleteError = result.message ?? Object.values(result.fields)[0] ?? null;
	}
</script>

<section class="connections" aria-labelledby={headingId}>
	<div class="head">
		<h3 id={headingId}>
			Deine Verbindungen
			{#if store.state === 'ready' && store.connections.length > 0}
				<span class="count"
					><span aria-hidden="true">{store.connections.length}</span><span class="visually-hidden"
						>({countLabel})</span
					></span
				>
			{/if}
		</h3>
		{#if store.state === 'ready' && store.connections.length > 0}
			<button class="button-subtle" type="button" onclick={() => void store.load()}>
				Aktualisieren
			</button>
		{/if}
	</div>

	{#if store.state === 'loading'}
		<p class="hint" role="status">Verbindungen werden geladen …</p>
		<div class="grid" aria-hidden="true">
			<div class="placeholder"></div>
			<div class="placeholder"></div>
			<div class="placeholder"></div>
		</div>
	{:else if store.state === 'error' && store.error === CONNECTIONS_UNAVAILABLE_MESSAGE}
		<SectionMessage tone="info" title={RESTART_NEEDED.title} live headingLevel={4}>
			{RESTART_NEEDED.text}
		</SectionMessage>
	{:else if store.state === 'error'}
		<SectionMessage tone="error" live>
			{store.error}
			{#snippet actions()}
				<button class="button-secondary" type="button" onclick={() => void store.load()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state === 'ready'}
		{#if store.connections.length === 0}
			<EmptyState
				size="narrow"
				icon="channels"
				headingLevel={4}
				title="Noch kein Kanal verbunden"
				description="Verbinde einen Kalender, einen Telegram-Bot oder ein Postfach, übernimm Listen aus Notion oder beobachte Repositorys auf GitHub und Ordner auf diesem Rechner. Die Einrichtung dauert etwa fünf Minuten."
			>
				{#snippet primary()}
					<button class="button-primary" type="button" onclick={onadd}>Kanal hinzufügen</button>
				{/snippet}
			</EmptyState>
		{:else}
			<p class="hint">
				Solange die App läuft, ruft Google Calendar alle 15 Minuten ab, Telegram jede Minute und ein
				Postfach alle 5 Minuten; „Aktualisieren“ zeigt das Ergebnis. „Jetzt abrufen“ holt sofort ab,
				auch bei einem Postfach. Wie weit ein Posteingang durchsucht ist, zeigt seine Karte von
				selbst. Notion ruft nie von selbst ab: Listen übernimmst du an seiner Karte. GitHub ruft
				alle 15 Minuten ab, Ordner prüft die App alle 5 Minuten; beides stellst du an der Karte ein.
			</p>
			<ul class="grid">
				{#each store.connections as connection (connection.id)}
					<li>
						{#if connection.type === 'notion'}
							<NotionCard
								{connection}
								secretStatus={store.status(connection.id)}
								{notion}
								message={messageOf(connection)}
								onimport={() => onimport(connection)}
								onchanged={() => void store.refresh(connection.id)}
								onpause={(enabled) => void setEnabled(connection, enabled)}
								onsetup={() => onsetup(connection)}
								ondelete={() => {
									deleteError = null;
									pendingDelete = connection;
								}}
								onrename={(label) => store.rename(connection.id, label)}
								ontarget={(project) => store.setTarget(connection.id, project)}
								{projects}
								others={othersOf(connection)}
							/>
						{:else if connection.type === 'github'}
							<GitHubCard
								{connection}
								secretStatus={store.status(connection.id)}
								{github}
								running={store.isRunning(connection.id)}
								lastRun={store.lastRun(connection.id)}
								message={messageOf(connection)}
								onrun={() => void runNow(connection)}
								onpause={(enabled) => void setEnabled(connection, enabled)}
								onsetup={() => onsetup(connection)}
								ondelete={() => {
									deleteError = null;
									pendingDelete = connection;
								}}
								onsave={(settings, announcement) =>
									store.saveGitHub(connection.id, settings, announcement)}
								onrename={(label) => store.rename(connection.id, label)}
								ontarget={(project) => store.setTarget(connection.id, project)}
								{projects}
								others={othersOf(connection)}
							/>
						{:else if connection.type === 'folder'}
							<FolderCard
								{connection}
								{folders}
								running={store.isRunning(connection.id)}
								lastRun={store.lastRun(connection.id)}
								message={messageOf(connection)}
								onrun={() => void runNow(connection)}
								onpause={(enabled) => void setEnabled(connection, enabled)}
								onsetup={() => onsetup(connection)}
								ondelete={() => {
									deleteError = null;
									pendingDelete = connection;
								}}
								onsave={(settings, announcement) =>
									store.saveFolders(connection.id, settings, announcement)}
								onrename={(label) => store.rename(connection.id, label)}
								ontarget={(project) => store.setTarget(connection.id, project)}
								{projects}
								others={othersOf(connection)}
							/>
						{:else}
							<ConnectionCard
								{connection}
								secretStatus={store.status(connection.id)}
								running={store.isRunning(connection.id)}
								helper={store.helper}
								lastRun={store.lastRun(connection.id)}
								message={messageOf(connection)}
								onrun={() => void runNow(connection)}
								onpick={() => (picking = connection)}
								onedit={() => {
									editMessage = null;
									editingId = connection.id;
								}}
								onpause={(enabled) => void setEnabled(connection, enabled)}
								ondelete={() => {
									deleteError = null;
									pendingDelete = connection;
								}}
								onsetup={() => onsetup(connection)}
								onscan={(action) => void scan(connection, action)}
								onreplies={(change) => saveReplies(connection, change, 'card')}
								onrename={(label) => store.rename(connection.id, label)}
								ontarget={(project) => store.setTarget(connection.id, project)}
								{projects}
								others={othersOf(connection)}
							/>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

{#if editing !== null}
	{@const connection = editing}
	<ChannelEditModal
		{connection}
		message={editMessage}
		onkeywords={(next, announcement) => saveKeywords(connection, next, announcement)}
		onreplies={(change) => saveReplies(connection, change, 'modal')}
		onmatchbody={(matchBody) =>
			void saveSwitch(
				connection,
				{ matchBody },
				matchBody
					? `„${connection.label}“ durchsucht Betreff, Absender, Kopfzeilen und Text.`
					: `„${connection.label}“ durchsucht nur Betreff und Absender.`
			)}
		onsetup={() => {
			// Read the connection before closing: the {@const} follows `editing`, which is then null.
			const current = connection;
			editingId = null;
			onsetup(current);
		}}
		onclose={() => (editingId = null)}
	/>
{/if}

{#if picking !== null}
	{@const connection = picking}
	<MailboxPicker
		label={connection.label}
		load={(limit, signal) => store.listMailbox(connection.id, limit, signal)}
		save={(uids) => store.importMailbox(connection.id, uids)}
		onclose={() => (picking = null)}
	/>
{/if}

<ConfirmDialog
	open={pendingDelete !== null}
	title={`Verbindung „${pendingDelete?.label ?? ''}“ löschen?`}
	confirmLabel="Löschen"
	busy={deleting}
	error={deleteError}
	onconfirm={() => void confirmDelete()}
	oncancel={() => {
		if (!deleting) pendingDelete = null;
	}}
>
	{#if pendingDelete?.type === 'folder'}
		<p>
			Die App prüft dann keinen dieser Ordner mehr. Einträge, die schon im Eingang sind, bleiben;
			die Dateien in den Ordnern bleiben unberührt.
		</p>
	{:else}
		<p>
			Die App ruft dann nichts mehr ab. Einträge, die schon im Eingang sind, bleiben. Die
			Windows-Variable löschst du selbst, falls du sie nicht mehr brauchst.
		</p>
	{/if}
</ConfirmDialog>

<style>
	.connections {
		display: grid;
		gap: 0.75rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 1rem;
		font-weight: 600;
	}

	.count {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	/*
	 * The same grid as "Selbst hereinbringen" (plan kanal-karten KK-2): every card keeps its own
	 * height, so opening the details of one does not stretch its neighbours.
	 */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
		gap: 0.75rem;
		align-items: start;
		list-style: none;
	}

	.grid > li {
		display: grid;
		min-width: 0;
	}

	.placeholder {
		height: 11rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
