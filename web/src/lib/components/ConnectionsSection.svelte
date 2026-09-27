<script lang="ts">
	import { tick } from 'svelte';
	import type { Connection } from '$lib/domain/connections';
	import { cardAnchorOf } from '$lib/domain/sync-all';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import {
		CONNECTIONS_UNAVAILABLE_MESSAGE,
		type ConnectionsStore
	} from '$lib/stores/connections.svelte';
	import ChannelCard from './channels/ChannelCard.svelte';
	import ChannelEditModal from './channels/ChannelEditModal.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MailboxPicker from './MailboxPicker.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// "Deine Verbindungen" on the page "Kanäle" (E4 plan, packages 10, 15, 20, 22 and 23; ADR-0026
	// section 3, plan EH-3): a grid of cards with the state of each connection as lozenge. The card
	// runs a fetch ("Jetzt abrufen", results as flags), opens the mailbox selection, pauses and
	// resumes, and asks before deleting; "Bearbeiten" opens a modal with keywords and switches that
	// save at once. Access data are Windows user variables; the app stores only their names
	// (ADR-0018). New connections come from the catalog below (ChannelCatalog).
	let {
		store,
		onadd,
		onsetup
	}: {
		store: ConnectionsStore;
		/** "Kanal hinzufügen" of the empty state: to the catalog. */
		onadd: () => void;
		/** Shows the setup of the kind of a connection. */
		onsetup: (connection: Connection) => void;
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

	// The cards of mailboxes follow their connection through realtime while the page is open, so
	// the progress of the full scan of the inbox shows as the mail helper reports it (ADR-0020,
	// addendum 3; no polling, CLAUDE.md §7). One subscription per mailbox, ended with the page.
	const mailIds = $derived(
		store.connections
			.filter((connection) => connection.type === 'mail')
			.map((connection) => connection.id)
			.join(',')
	);
	$effect(() => {
		const ids = mailIds === '' ? [] : mailIds.split(',');
		const stops = ids.map((id) => store.watch(id));
		return () => {
			for (const stop of stops) stop();
		};
	});

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
			{ keywords, replyNoMatch: connection.replyNoMatch, matchBody: connection.matchBody },
			announcement
		);
		if (result.ok) return null;
		return (
			result.message ??
			Object.values(result.fields)[0] ??
			'Die Stichwörter ließen sich nicht speichern.'
		);
	}

	async function saveSwitch(
		connection: Connection,
		change: { replyNoMatch?: boolean; matchBody?: boolean },
		announcement: string
	) {
		editMessage = null;
		const result = await store.saveSettings(
			connection.id,
			{
				keywords: connection.keywords,
				replyNoMatch: change.replyNoMatch ?? connection.replyNoMatch,
				matchBody: change.matchBody ?? connection.matchBody
			},
			announcement
		);
		if (!result.ok)
			editMessage =
				result.message ??
				Object.values(result.fields)[0] ??
				'Die Einstellung ließ sich nicht speichern.';
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
				description="Verbinde einen Kalender, einen Telegram-Bot oder ein Postfach. Die Einrichtung dauert etwa fünf Minuten."
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
				selbst.
			</p>
			<ul class="grid">
				{#each store.connections as connection (connection.id)}
					<li>
						<ChannelCard
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
						/>
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
		onreply={(replyNoMatch) =>
			void saveSwitch(
				connection,
				{ replyNoMatch },
				replyNoMatch
					? `„${connection.label}“ antwortet auf Nachrichten ohne Stichwort.`
					: `„${connection.label}“ antwortet nicht mehr auf Nachrichten ohne Stichwort.`
			)}
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
	<p>
		Die App ruft dann nichts mehr ab. Einträge, die schon im Eingang sind, bleiben. Die
		Windows-Variable löschst du selbst, falls du sie nicht mehr brauchst.
	</p>
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
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.625rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 0.75rem;
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
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
