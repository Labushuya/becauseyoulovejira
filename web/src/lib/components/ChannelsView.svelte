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
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import { channelSetupHref } from '$lib/ticket-links';
	import BookmarkletCard from './channels/BookmarkletCard.svelte';
	import ChannelCatalog, { type CatalogEntry } from './channels/ChannelCatalog.svelte';
	import ChannelIcon from './channels/ChannelIcon.svelte';
	import ChannelSetup from './channels/ChannelSetup.svelte';
	import ChannelsIntro from './channels/ChannelsIntro.svelte';
	import ConnectionCreateDialog from './channels/ConnectionCreateDialog.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 11, 13, 15, 17 and 23; ADR-0026 section 3,
	// plan EH-3 and §3.4), read like an overview: the explanation of the two ways, the cards of the
	// connections, "Selbst hereinbringen" (the bookmarklet card of EH-4, files), the catalog "Kanal
	// hinzufügen" and the guides of the services that have no assistant yet, folded. Since EH-5 the
	// setup assistant (modal L, ChannelSetup) serves Google Calendar: the catalog links to it, the
	// cards and the edit modal open it for their connection, and the owner keeps it in the address
	// (`setup`, `onsetupchange`). Until EH-6 and EH-7 the other services keep the modal "Verbindung
	// anlegen" and their folded guide.
	let {
		captureUrl,
		connections,
		setup = null,
		onsetupchange
	}: {
		/** Absolute address of the capture form, e.g. http://127.0.0.1:8090/eingang/neu. */
		captureUrl: string;
		connections: ConnectionsStore;
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
		telegram: `${uid}-telegram`,
		webde: `${uid}-webde`,
		gmail: `${uid}-gmail`,
		proton: `${uid}-proton`
	};
	/** The folded guide of each service without an assistant. */
	const GUIDES: Readonly<Partial<Record<CatalogEntry, string>>> = {
		telegram: `${uid}-guide-telegram`,
		webde: `${uid}-guide-webde`,
		gmail: `${uid}-guide-gmail`,
		proton: `${uid}-guide-proton`
	};

	const assisted = (kind: SetupKind) => ASSISTED_KINDS.includes(kind);
	/** The assistant of the address, if its service has one. */
	const shownSetup = $derived(setup !== null && assisted(setup.kind) ? setup : null);

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

	/** "Einrichten" of a service without an assistant: the modal or the guide as before. */
	function startSetup(entry: CatalogEntry) {
		if (assisted(entry)) onsetupchange({ kind: entry, connectionId: null });
		else if (entry === 'proton') void openGuide('proton');
		else if (entry === 'kalender') creating = { type: 'calendar', provider: 'webde' };
		else if (entry === 'telegram') creating = { type: 'telegram', provider: 'webde' };
		else creating = { type: 'mail', provider: entry };
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
			Schritt für Schritt je Dienst. Google Calendar richtest du mit dem Assistenten im Katalog ein;
			für die übrigen Dienste folgt er in den nächsten Paketen.
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

		<section class="guide" aria-labelledby={ids.webde}>
			<details id={GUIDES.webde}>
				<summary id={ids.webde}>Web.de-Postfach einrichten</summary>
				<p>
					Den Posteingang holt der Mail-Hilfsprozess <code>byl-mail.exe</code> aus dem Ordner
					<code>app</code> alle 5 Minuten ab, solange die App läuft. Er liest nur: Gelesen-Status, Markierungen
					und Ordner bleiben, wie sie sind, und er verschickt nichts. In den Eingang kommen nur Mails,
					die nach der Einrichtung ankommen und deren Betreff ein Stichwort der Verbindung enthält (auf
					Wunsch auch die ersten 500 Zeichen des Textes).
				</p>
				<ol>
					<li>
						Bei Web.de anmelden, oben auf deine Initialen und dann „E-Mail-Einstellungen“ klicken.
						Unter „E-Mail empfangen“ auf „POP3/IMAP“ und den Schalter „POP3- und IMAP-Zugriff
						erlauben“ einschalten; die Sicherheitsabfrage bestätigen.
					</li>
					<li>
						Nutzt du die Zwei-Faktor-Anmeldung: unter „Account verwalten“ → „Login & Sicherheit“ →
						„Anwendungsspezifische Passwörter verwalten“ ein neues Passwort erstellen (Name etwa
						„becauseyoulovejira“). Es wird nur einmal angezeigt. Ohne Zwei-Faktor-Anmeldung gilt
						dein normales Web.de-Passwort.
					</li>
					<li>
						In der Eingabeaufforderung <code>setx BYL_WEBDE_PASSWORD "…"</code> mit diesem Passwort eingeben.
					</li>
					<li>
						Im Katalog „Kanal hinzufügen“ die Art „Postfach (IMAP)“ mit Anbieter „Web.de“, deiner
						E-Mail-Adresse als Benutzername und der Variablen <code>BYL_WEBDE_PASSWORD</code> anlegen
						und Stichwörter eintragen.
					</li>
					<li>
						<code>stop.bat</code> und dann <code>start.bat</code> ausführen. <code>start.bat</code>
						legt beim ersten Mal den Zugang zwischen App und Hilfsprozess an (Variable
						<code>BYL_INGEST_TOKEN</code>, nichts zu tun) und startet <code>byl-mail.exe</code>,
						sobald eine eingeschaltete Postfach-Verbindung besteht.
					</li>
					<li>
						Nach spätestens 5 Minuten zeigt die Verbindung „Letzter Abruf“ und den Hinweis „Erster
						Abruf“. Ab dann kommen neue Mails mit Stichwort in den Eingang.
					</li>
				</ol>
				<p>
					Ältere Mails und Mails ohne Stichwort holst du mit „Aus dem Postfach wählen“ an der
					Verbindung: Die Ansicht zeigt die letzten 50 (bis 200) Mails des Posteingangs, Mails mit
					Stichwort sind vorausgewählt, und nur die ausgewählten kommen in den Eingang.
				</p>
				<p class="hint">
					Web.de schaltet den Abruf aus, wenn er längere Zeit nicht genutzt wird. Dann meldet die
					Verbindung „Anmeldung bei Web.de abgelehnt.“ mit einem Hinweis; den Schalter wieder
					einschalten, die App muss nicht neu starten. Beim ersten Start von <code
						>byl-mail.exe</code
					>
					können SmartScreen oder ein Virenscanner nachfragen, weil die Datei nicht signiert ist. Das
					Protokoll steht in
					<code>app\logs\byl-mail.log</code>, ohne Zugangsdaten und ohne Inhalte der Mails.
					Widerrufen: das anwendungsspezifische Passwort unter „Login & Sicherheit“ löschen bzw. den
					Abruf ausschalten und die Variable <code>BYL_WEBDE_PASSWORD</code> entfernen.
				</p>
			</details>
		</section>

		<section class="guide" aria-labelledby={ids.gmail}>
			<details id={GUIDES.gmail}>
				<summary id={ids.gmail}>Gmail einrichten</summary>
				<p>
					Gmail holt derselbe Hilfsprozess <code>byl-mail.exe</code> ab wie Web.de, mit denselben Regeln:
					nur der Posteingang, nur Mails nach der Einrichtung mit Stichwort, nur lesend. IMAP ist bei
					Gmail immer eingeschaltet. Die Anmeldung geht nur mit einem App-Passwort, nicht mit deinem normalen
					Google-Passwort, und ein App-Passwort gibt es nur mit der Bestätigung in zwei Schritten.
				</p>
				<ol>
					<li>
						Unter <code>myaccount.google.com</code> → „Sicherheit“ prüfen, ob die „Bestätigung in zwei
						Schritten“ (2-Faktor-Authentifizierung) eingeschaltet ist; sonst dort einschalten.
					</li>
					<li>
						<a
							href="https://myaccount.google.com/apppasswords"
							target="_blank"
							rel="noopener noreferrer">myaccount.google.com/apppasswords</a
						> öffnen, einen Namen wie „becauseyoulovejira“ eingeben und „Erstellen“ klicken. Das App-Passwort
						(16 Zeichen) wird nur einmal angezeigt.
					</li>
					<li>
						In der Eingabeaufforderung <code>setx BYL_GMAIL_PASSWORD "…"</code> mit diesem App-Passwort
						eingeben (die 16 Buchstaben ohne die Leerzeichen zwischen den Vierergruppen).
					</li>
					<li>
						Im Katalog „Kanal hinzufügen“ die Art „Postfach (IMAP)“ mit Anbieter „Gmail“, deiner
						Gmail-Adresse als Benutzername und der Variablen <code>BYL_GMAIL_PASSWORD</code> anlegen und
						Stichwörter eintragen.
					</li>
					<li>
						<code>stop.bat</code> und dann <code>start.bat</code> ausführen. Nach spätestens 5 Minuten
						zeigt die Verbindung „Letzter Abruf“ und den Hinweis „Erster Abruf“. Ältere Mails holst du
						mit „Aus dem Postfach wählen“.
					</li>
				</ol>
				<p class="hint">
					Meldet die Verbindung „Anmeldung bei Gmail abgelehnt.“ mit dem Hinweis „App-Passwort nötig
					(Bestätigung in zwei Schritten)“, steht in der Variablen das normale Google-Passwort oder
					ein widerrufenes App-Passwort. Mit „Erweitertem Schutz“ oder nur mit Sicherheitsschlüssel
					bietet Google keine App-Passwörter an; dann bleibt der Weg über <code>.eml</code>-Dateien.
					Widerrufen: unter <code>myaccount.google.com/apppasswords</code> das App-Passwort
					entfernen und die Variable
					<code>BYL_GMAIL_PASSWORD</code> löschen. Ändert sich dein Google-Passwort, verfallen alle App-Passwörter.
				</p>
			</details>
		</section>
		<section class="guide" aria-labelledby={ids.proton}>
			<details id={GUIDES.proton}>
				<summary id={ids.proton}>Proton Mail per Datei übernehmen</summary>
				<p>
					Proton Mail hat im Free-Tarif keinen automatischen Abruf (Proton Mail Bridge setzt einen
					bezahlten Tarif voraus). Mails aus Proton kommen deshalb als Datei in den Eingang.
				</p>
				<ol>
					<li>
						<a href="https://mail.proton.me" target="_blank" rel="noopener noreferrer"
							>mail.proton.me</a
						> öffnen und die Mail öffnen.
					</li>
					<li>
						Unter den Absenderangaben auf das Symbol mit den drei Punkten („Mehr“) klicken und
						„Exportieren“ wählen.
					</li>
					<li>
						Die .eml-Datei speichern und in den <a href={resolve('/eingang')}>Eingang</a> ziehen.
						Mails mit einem
						<a href={resolve('/einstellungen/datei-importe')}>Stichwort für Mail-Dateien</a> sind in der
						Auswahl schon markiert.
					</li>
				</ol>
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

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
	}

	.links a {
		color: var(--color-brand-text);
	}

	/* Folded guides (until the assistant, EH-5 to EH-7): one line each, open on demand. */
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
