<script lang="ts">
	import { resolve } from '$app/paths';
	import { setupKindOf, type SetupTarget } from '$lib/domain/channel-setup';
	import type { Connection } from '$lib/domain/connections';
	import { IMPORT_KINDS, type ImportKind } from '$lib/domain/keywords';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import { channelSetupHref } from '$lib/ticket-links';
	import BookmarkletCard from './channels/BookmarkletCard.svelte';
	import ChannelCatalog from './channels/ChannelCatalog.svelte';
	import ChannelIcon from './channels/ChannelIcon.svelte';
	import ChannelSetup from './channels/ChannelSetup.svelte';
	import ChannelsIntro from './channels/ChannelsIntro.svelte';
	import ProtonGuide from './channels/ProtonGuide.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 11, 13, 15, 17 and 23; ADR-0026 section 3,
	// plan EH-3 and §3.4), read like an overview: the explanation of the two ways, the cards of the
	// connections, "Selbst hereinbringen" (the bookmarklet card, the files card with the number of
	// keywords per kind of file) and the catalog "Kanal hinzufügen". Every setup opens in the app
	// (EH-5 to EH-7): the assistant (modal L, ChannelSetup) for Google Calendar, Telegram, Web.de and
	// Gmail, the guide modal for Proton. The catalog links to them, the cards and the edit modal open
	// them for their connection, and the owner keeps them in the address (`setup`, `onsetupchange`).
	let {
		captureUrl,
		connections,
		importKeywords = null,
		setup = null,
		onsetupchange
	}: {
		/** Absolute address of the capture form, e.g. http://127.0.0.1:8090/eingang/neu. */
		captureUrl: string;
		connections: ConnectionsStore;
		/** Keywords of the file imports, for the numbers on the files card. */
		importKeywords?: ImportKeywordsStore | null;
		/** Assistant in the address, null without one. */
		setup?: SetupTarget | null;
		/** Opens, moves or closes the assistant (the owner changes the address). */
		onsetupchange: (next: SetupTarget | null) => void;
	} = $props();

	const uid = $props.id();
	const ids = { own: `${uid}-own`, files: `${uid}-files` };
	/** Short names of the kinds of file on the files card. */
	const FILE_NAMES: Readonly<Record<ImportKind, string>> = {
		eml: 'Mail',
		ics: 'Kalender',
		whatsapp: 'WhatsApp'
	};

	const fileKeywords = $derived(
		importKeywords?.state === 'ready'
			? IMPORT_KINDS.map(
					(kind) => `${FILE_NAMES[kind]} ${importKeywords.settings[kind].keywords.length}`
				).join(' · ')
			: null
	);

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
</script>

<div class="channels">
	<ChannelsIntro />

	<ConnectionsSection store={connections} onadd={focusCatalog} onsetup={showSetup} />

	<section class="own" aria-labelledby={ids.own}>
		<h3 id={ids.own}>Selbst hereinbringen</h3>
		<div class="own-cards">
			<BookmarkletCard {captureUrl} />

			<section class="card files" aria-labelledby={ids.files}>
				<div class="files-head">
					<ChannelIcon kind="files" />
					<h4 id={ids.files}>Dateien hereinziehen</h4>
				</div>
				<p>
					Mail-Dateien (.eml, auch aus Proton), Kalenderdateien (.ics) und WhatsApp-Exporte ziehst
					du in den Eingang oder wählst sie dort mit „Datei wählen“. Treffer deiner Stichwörter sind
					in der Auswahl schon markiert.
				</p>
				{#if fileKeywords !== null}
					<p class="meta">Stichwörter: {fileKeywords}</p>
				{/if}
				<p class="links">
					<a href={resolve('/einstellungen/datei-importe')}>Stichwörter bearbeiten</a>
					<a href={resolve('/eingang')}>Zum Eingang</a>
				</p>
			</section>
		</div>
	</section>

	<ChannelCatalog
		connections={connections.connections}
		bind:heading={catalogHeading}
		hrefOf={(entry) => channelSetupHref({ kind: entry, connectionId: null })}
	/>
</div>

{#if setup !== null}
	{#if setup.kind === 'proton'}
		<ProtonGuide onclose={() => onsetupchange(null)} />
	{:else}
		{#key setup.kind}
			<ChannelSetup
				kind={setup.kind}
				connectionId={setup.connectionId}
				store={connections}
				onconnection={(id) => onsetupchange({ kind: setup?.kind ?? 'kalender', connectionId: id })}
				onclose={() => onsetupchange(null)}
			/>
		{/key}
	{/if}
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

	h4 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.own {
		display: grid;
		gap: 0.75rem;
	}

	.own-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 0.75rem;
		align-items: start;
	}

	.card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.files-head {
		display: flex;
		gap: 0.625rem;
		align-items: center;
	}

	.files p {
		font-size: 0.875rem;
	}

	.files .meta {
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
	}

	.links a {
		color: var(--color-brand-text);
	}
</style>
