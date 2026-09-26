<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		ASSISTED_KINDS,
		setupKindOf,
		type SetupKind,
		type SetupTarget
	} from '$lib/domain/channel-setup';
	import type { Connection, ConnectionType, MailProvider } from '$lib/domain/connections';
	import { IMPORT_KINDS, type ImportKind } from '$lib/domain/keywords';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import type { ImportKeywordsStore } from '$lib/stores/import-keywords.svelte';
	import { channelSetupHref } from '$lib/ticket-links';
	import BookmarkletCard from './channels/BookmarkletCard.svelte';
	import ChannelCatalog, { type CatalogEntry } from './channels/ChannelCatalog.svelte';
	import ChannelIcon from './channels/ChannelIcon.svelte';
	import ChannelSetup from './channels/ChannelSetup.svelte';
	import ChannelsIntro from './channels/ChannelsIntro.svelte';
	import ConnectionCreateDialog from './channels/ConnectionCreateDialog.svelte';
	import ProtonGuide from './channels/ProtonGuide.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 11, 13, 15, 17 and 23; ADR-0026 section 3,
	// plan EH-3 and §3.4), read like an overview: the explanation of the two ways, the cards of the
	// connections, "Selbst hereinbringen" (the bookmarklet card, the files card with the number of
	// keywords per kind of file), the catalog "Kanal hinzufügen" and, until EH-6, the folded guide of
	// Telegram. The setup opens in the app (EH-5, EH-7): the assistant (modal L, ChannelSetup) for
	// Google Calendar, Web.de and Gmail, the guide modal for Proton; the catalog links to them, the
	// cards and the edit modal open them for their connection, and the owner keeps them in the
	// address (`setup`, `onsetupchange`). Until EH-6 Telegram keeps the modal "Verbindung anlegen".
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
	const ids = {
		own: `${uid}-own`,
		files: `${uid}-files`,
		guides: `${uid}-guides`,
		telegram: `${uid}-telegram`
	};
	/** The folded guide of each service without an assistant. */
	const GUIDES: Readonly<Partial<Record<CatalogEntry, string>>> = {
		telegram: `${uid}-guide-telegram`
	};
	/** Short names of the kinds of file on the files card. */
	const FILE_NAMES: Readonly<Record<ImportKind, string>> = {
		eml: 'Mail',
		ics: 'Kalender',
		whatsapp: 'WhatsApp'
	};

	const assisted = (kind: SetupKind) => ASSISTED_KINDS.includes(kind);
	/** The assistant of the address, if its service has one. */
	const shownSetup = $derived(setup !== null && assisted(setup.kind) ? setup : null);
	const fileKeywords = $derived(
		importKeywords?.state === 'ready'
			? IMPORT_KINDS.map(
					(kind) => `${FILE_NAMES[kind]} ${importKeywords.settings[kind].keywords.length}`
				).join(' · ')
			: null
	);

	let catalogHeading = $state<HTMLElement>();
	/** Kind of the modal "Verbindung anlegen", null while it is closed. */
	let creating = $state<{ type: ConnectionType; provider: MailProvider } | null>(null);

	/** "Kanal hinzufügen" in the empty state: to the catalog, with the focus on its heading. */
	function focusCatalog() {
		catalogHeading?.scrollIntoView?.({ block: 'start' });
		catalogHeading?.focus();
	}

	/** Opens the folded guide of an entry and moves the focus to its summary. */
	async function openGuide(entry: CatalogEntry) {
		const id = GUIDES[entry];
		const details = id === undefined ? null : document.getElementById(id);
		if (!(details instanceof HTMLDetailsElement)) return;
		details.open = true;
		await tick();
		details.scrollIntoView?.({ block: 'start' });
		details.querySelector<HTMLElement>('summary')?.focus();
	}

	/** "Einrichten" of a service without an assistant (Telegram until EH-6): the former modal. */
	function startSetup(entry: CatalogEntry) {
		if (assisted(entry)) onsetupchange({ kind: entry, connectionId: null });
		else creating = { type: 'telegram', provider: 'webde' };
	}

	/** "Einrichtung fortsetzen" and "Einrichtung ansehen" of a card or the edit modal. */
	function showSetup(connection: Connection) {
		const kind = setupKindOf(connection);
		if (assisted(kind)) onsetupchange({ kind, connectionId: connection.id });
		else void openGuide(kind);
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
		hrefOf={(entry) =>
			assisted(entry) ? channelSetupHref({ kind: entry, connectionId: null }) : null}
		onsetup={startSetup}
	/>

	<section class="guides" aria-labelledby={ids.guides}>
		<h3 id={ids.guides}>Anleitungen</h3>
		<p class="hint">
			Google Calendar, Web.de, Gmail und Proton richtest du über den Katalog ein; für Telegram folgt
			der Assistent im nächsten Paket.
		</p>

		<section class="guide" aria-labelledby={ids.telegram}>
			<details id={GUIDES.telegram}>
				<summary id={ids.telegram}>Telegram-Bot einrichten</summary>
				<p>
					Du legst einen eigenen Bot an und schreibst ihm, was in den Eingang soll. Die App fragt
					jede Minute nach neuen Nachrichten, solange sie läuft. Nur Nachrichten aus freigegebenen
					Chats mit einem Stichwort der Verbindung werden gespeichert; jede beantwortet der Bot mit
					„Im Eingang gespeichert“. Auf Nachrichten ohne Stichwort antwortet er „Kein Stichwort
					erkannt – nicht gespeichert“ (abschaltbar). Text und Bildunterschriften werden übernommen,
					Bilder und Dateien nicht.
				</p>
				<ol>
					<li>
						In Telegram den Chat mit <strong>@BotFather</strong> öffnen (blauer Haken),
						<code>/newbot</code>
						senden, einen Namen und einen Benutzernamen wählen, der auf „bot“ endet.
					</li>
					<li>
						BotFather antwortet mit dem Token (etwa <code>123456789:AA…</code>). In der
						Eingabeaufforderung <code>setx BYL_TELEGRAM_TOKEN "…"</code> mit dem Token eingeben.
					</li>
					<li>
						Deine ID herausfinden: Richte die Verbindung zunächst mit einer beliebigen Zahl als ID
						ein (nächster Schritt), schreibe dem Bot eine Nachricht und wähle hier „Jetzt abrufen“.
						Die Verbindung zeigt dann „Nachricht aus einem nicht freigegebenen Chat (Chat-ID …)“. Im
						Chat mit dem Bot ist das deine User-ID. Für eine Gruppe den Bot hinzufügen; ihre Chat-ID
						beginnt mit „-100“.
					</li>
					<li>
						<code>setx BYL_TELEGRAM_ALLOWED_IDS "…"</code> mit der ID eingeben, mehrere durch Komma
						getrennt (etwa <code>"424242,-100123456"</code>).
					</li>
					<li>
						<code>stop.bat</code> und dann <code>start.bat</code> ausführen. Im Katalog „Kanal
						hinzufügen“ die Art „Telegram-Bot“ mit <code>BYL_TELEGRAM_TOKEN</code> und
						<code>BYL_TELEGRAM_ALLOWED_IDS</code> anlegen, falls noch nicht geschehen.
					</li>
					<li>
						An der Verbindung Stichwörter eintragen, etwa „todo“ oder „#byl“. Nur Nachrichten mit
						einem davon landen im Eingang.
					</li>
				</ol>
				<p class="hint">
					Telegram hält Nachrichten für den Bot höchstens 24 Stunden bereit. Läuft die App länger
					nicht, gehen sie verloren; fehlt die Antwort „Im Eingang gespeichert“, ist die Nachricht
					nicht angekommen. In Gruppen sieht ein Bot normalerweise nur Befehle und Antworten an ihn;
					soll er alles lesen, bei BotFather <code>/setprivacy</code> auf „Disable“ stellen.
					Widerrufen: bei BotFather <code>/revoke</code> (neuer Token, dann <code>setx</code> und
					neu starten) oder
					<code>/deletebot</code>.
				</p>
			</details>
		</section>
	</section>
</div>

{#if creating !== null}
	<ConnectionCreateDialog
		store={connections}
		type={creating.type}
		provider={creating.provider}
		onclose={() => (creating = null)}
	/>
{/if}

{#if shownSetup !== null}
	{#if shownSetup.kind === 'proton'}
		<ProtonGuide onclose={() => onsetupchange(null)} />
	{:else}
		{#key shownSetup.kind}
			<ChannelSetup
				kind={shownSetup.kind}
				connectionId={shownSetup.connectionId}
				store={connections}
				onconnection={(id) =>
					onsetupchange({ kind: shownSetup?.kind ?? 'kalender', connectionId: id })}
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

	.own,
	.guides {
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

	/* Folded guide of Telegram (until its assistant, EH-6): one line, open on demand. */
	.guide {
		padding: 0.625rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.guide details {
		display: grid;
		gap: 0.75rem;
	}

	.guide details[open] > :global(:not(summary)) {
		margin-top: 0.75rem;
	}

	.guide summary {
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
	}

	.guide p,
	.guide ol {
		font-size: 0.875rem;
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
