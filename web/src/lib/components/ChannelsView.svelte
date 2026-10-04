<script lang="ts">
	import type { ExtensionInfo } from '$lib/data/extension';
	import { setupKindOf, type SetupTarget } from '$lib/domain/channel-setup';
	import type { Connection } from '$lib/domain/connections';
	import type { ProjectRef } from '$lib/domain/ticket';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { FoldersStore } from '$lib/stores/folders.svelte';
	import type { GitHubStore } from '$lib/stores/github.svelte';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import type { InboxKeysStore } from '$lib/stores/inbox-keys.svelte';
	import type { InboxTargetsStore } from '$lib/stores/inbox-targets.svelte';
	import type { NotionStore } from '$lib/stores/notion.svelte';
	import { channelSetupHref } from '$lib/ticket-links';
	import BookmarkletCard from './channels/BookmarkletCard.svelte';
	import ChannelCatalog from './channels/ChannelCatalog.svelte';
	import ChannelSetup from './channels/ChannelSetup.svelte';
	import ChannelsIntro from './channels/ChannelsIntro.svelte';
	import FilesCard from './channels/FilesCard.svelte';
	import NotionImportDialog from './channels/NotionImportDialog.svelte';
	import OwnInboxCard from './channels/OwnInboxCard.svelte';
	import ProtonGuide from './channels/ProtonGuide.svelte';
	import WhatsAppWebCard from './channels/WhatsAppWebCard.svelte';
	import WhatsAppWebSetup from './channels/WhatsAppWebSetup.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 11, 13, 15, 17 and 23; ADR-0026 section 3,
	// plan EH-3 and §3.4), read like an overview: the explanation of the two ways, the cards of the
	// connections, "Selbst hereinbringen" (the bookmarklet card, the files card with the number of
	// keywords per kind of file) and the catalog "Kanal hinzufügen". Every setup opens in the app
	// (EH-5 to EH-7): the assistant (modal L, ChannelSetup) for Google Calendar, Telegram, Web.de,
	// Gmail and Notion, the guide modal for Proton. The catalog links to them, the cards and the edit modal open
	// them for their connection, and the owner keeps them in the address (`setup`, `onsetupchange`).
	// Since EI-1 and EI-3 (ADR-0038) "Selbst hereinbringen" holds the own inbox with its keys and
	// WhatsApp Web with its assistant (WhatsAppWebSetup, ?einrichten=whatsapp-web). Since NI-2
	// (ADR-0041) the import dialog of Notion opens from its card or, after "Verbindung prüfen", from
	// the last step of its assistant: the assistant closes first, no dialog from a dialog. Since the
	// plan kanal-karten KK-2 every card of the page stands on the building block ChannelCard. Every
	// card that brings entries has their target project in its details and the assistants ask for
	// it in an optional step (ADR-0049): connections keep it themselves, the own inbox, WhatsApp
	// Web and the files per user (`inboxTargets`). GitHub (ADR-0050) has its assistant (ChannelSetup)
	// and its card with the repositories, their details and "Verbindung prüfen" (`github`). Folders
	// (ADR-0051) have their assistant too and a card with the folders, their details and the files of
	// before (`folders`). In the household area (E7-3, ADR-0059 §5) connections, the own inbox and
	// WhatsApp Web stay private: their cards and assistants are not offered, the catalog says
	// "Nur im privaten Bereich"; the bookmarklet, the clipboard and the files work there.
	let {
		captureUrl,
		connections,
		notion,
		github,
		folders,
		importKeywords = null,
		inboxKeys = null,
		inboxTargets = null,
		projects = [],
		extension = null,
		setup = null,
		admin = true,
		household = false,
		onsetupchange
	}: {
		/** Absolute address of the capture form, e.g. http://127.0.0.1:8090/eingang/neu. */
		captureUrl: string;
		connections: ConnectionsStore;
		/** Notion import (ADR-0041): check, sources, preview, import, "Erneut abrufen". */
		notion: NotionStore;
		/** GitHub (ADR-0050): details of the cards and "Verbindung prüfen". */
		github: GitHubStore;
		/** Folders (ADR-0051): details of the cards and "Vorhandene Dateien übernehmen". */
		folders: FoldersStore;
		/**
		 * Keywords of the file imports, for the numbers on the files card, and of the channels of the
		 * own inbox (ADR-0038).
		 */
		importKeywords?: ImportKeywordsStore | null;
		/**
		 * Access keys of the own inbox (ADR-0038); without them the cards of the own inbox and of
		 * WhatsApp Web are not shown.
		 */
		inboxKeys?: InboxKeysStore | null;
		/** Target projects of the own inbox, WhatsApp Web and the files (ADR-0049). */
		inboxTargets?: InboxTargetsStore | null;
		/** Every project of the catalog, archived ones included (target projects, ADR-0049). */
		projects?: readonly ProjectRef[];
		/** Folder of the built extension for WhatsApp Web, null while unknown. */
		extension?: ExtensionInfo | null;
		/** Assistant in the address, null without one. */
		setup?: SetupTarget | null;
		/**
		 * The signed-in account is the administrator of the app (ADR-0056 §5): only it sets up
		 * channels with access data and folders; another account gets the guide of Proton and
		 * WhatsApp Web only, and an assistant of another kind in the address stays closed.
		 */
		admin?: boolean;
		/** The tab shows the household area (E7-3): only the ways without a connection are offered. */
		household?: boolean;
		/** Opens, moves or closes the assistant (the owner changes the address). */
		onsetupchange: (next: SetupTarget | null) => void;
	} = $props();

	/** The assistant of the address, if this account may use it in this area. */
	const shownSetup = $derived.by(() => {
		if (setup === null) return null;
		if (household) return setup.kind === 'proton' ? setup : null;
		return admin || setup.kind === 'proton' || setup.kind === 'whatsapp-web' ? setup : null;
	});

	const uid = $props.id();
	const ownId = `${uid}-own`;

	let catalogHeading = $state<HTMLElement>();

	/** "Kanal hinzufügen" in the empty state: to the catalog, with the focus on its heading. */
	function focusCatalog() {
		catalogHeading?.scrollIntoView?.({ block: 'start' });
		catalogHeading?.focus();
	}

	/** "Einrichtung fortsetzen" and "Einrichtung ansehen" of a card or the edit modal. */
	function showSetup(connection: Connection) {
		onsetupchange({ kind: setupKindOf(connection), connectionId: connection.id });
	}

	/** The Notion connection whose import dialog is open, null while it is closed. */
	let importing = $state<Connection | null>(null);

	function closeImport() {
		const id = importing?.id ?? null;
		importing = null;
		// The import asked Notion; the card shows the new last run and error.
		if (id !== null) void connections.refresh(id);
	}
</script>

<div class="channels">
	<ChannelsIntro />

	{#if !household}
		<ConnectionsSection
			store={connections}
			{notion}
			{github}
			{folders}
			{projects}
			onadd={focusCatalog}
			onsetup={showSetup}
			onimport={(connection) => (importing = connection)}
		/>
	{/if}

	<section class="own" aria-labelledby={ownId}>
		<h3 id={ownId}>Selbst hereinbringen</h3>
		<div class="own-cards">
			<BookmarkletCard {captureUrl} />
			<!-- The target project of the files is a private project (ADR-0049 §7): not in a household. -->
			<FilesCard {importKeywords} inboxTargets={household ? null : inboxTargets} {projects} />
			{#if inboxKeys !== null && !household}
				<OwnInboxCard store={inboxKeys} {importKeywords} {inboxTargets} {projects} />
				<WhatsAppWebCard
					{importKeywords}
					{inboxKeys}
					{inboxTargets}
					{projects}
					{extension}
					setupHref={channelSetupHref({ kind: 'whatsapp-web', connectionId: null })}
				/>
			{/if}
		</div>
	</section>

	<ChannelCatalog
		connections={connections.connections}
		bind:heading={catalogHeading}
		hrefOf={(entry) => channelSetupHref({ kind: entry, connectionId: null })}
		{admin}
		{household}
	/>
</div>

{#if shownSetup !== null}
	{#if shownSetup.kind === 'proton'}
		<ProtonGuide onclose={() => onsetupchange(null)} />
	{:else if shownSetup.kind === 'whatsapp-web'}
		{#if inboxKeys !== null}
			<WhatsAppWebSetup
				{inboxKeys}
				{importKeywords}
				{inboxTargets}
				{projects}
				{extension}
				appUrl={new URL(captureUrl).origin}
				onclose={() => onsetupchange(null)}
			/>
		{/if}
	{:else}
		{#key shownSetup.kind}
			<ChannelSetup
				kind={shownSetup.kind}
				connectionId={shownSetup.connectionId}
				store={connections}
				{notion}
				{github}
				{projects}
				onconnection={(id) => onsetupchange({ kind: setup?.kind ?? 'kalender', connectionId: id })}
				onimport={(connection) => {
					onsetupchange(null);
					importing = connection;
				}}
				onclose={() => onsetupchange(null)}
			/>
		{/key}
	{/if}
{/if}

{#if importing !== null}
	<NotionImportDialog
		connectionId={importing.id}
		label={importing.label}
		{notion}
		onclose={closeImport}
	/>
{/if}

<style>
	/* Full width like the views (ADR-0026 section 1); running text keeps its line length. */
	.channels {
		display: grid;
		gap: 1.75rem;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.own {
		display: grid;
		gap: 0.75rem;
	}

	/* The same grid as "Deine Verbindungen"; every card keeps its own height. */
	.own-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
		gap: 0.75rem;
		align-items: start;
	}
</style>
