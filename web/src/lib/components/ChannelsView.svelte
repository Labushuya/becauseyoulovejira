<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { bookmarkletCode } from '$lib/domain/bookmarklet';
	import type { Connection, ConnectionType, MailProvider } from '$lib/domain/connections';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import ChannelCatalog, { type CatalogEntry } from './channels/ChannelCatalog.svelte';
	import ChannelIcon from './channels/ChannelIcon.svelte';
	import ChannelsIntro from './channels/ChannelsIntro.svelte';
	import ConnectionCreateDialog from './channels/ConnectionCreateDialog.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 11, 13, 15, 17 and 23; ADR-0026 section 3,
	// plan EH-3 and §3.4), read like an overview: the explanation of the two ways, the cards of the
	// connections, "Selbst hereinbringen" (bookmarklet, files), the catalog "Kanal hinzufügen" and,
	// folded per service until the assistant of EH-5 to EH-7 replaces them, the guides. Until then
	// "Einrichten" in the catalog opens the former form as a modal ("Verbindung anlegen"). The
	// bookmarklet link is dragged to the bookmarks bar; for the keyboard the code can be copied and
	// saved as the address of a new bookmark. A click on the link here does nothing, so the page
	// does not capture itself.
	let {
		captureUrl,
		connections
	}: {
		/** Absolute address of the capture form, e.g. http://127.0.0.1:8090/eingang/neu. */
		captureUrl: string;
		connections: ConnectionsStore;
	} = $props();

	const uid = $props.id();
	const ids = {
		own: `${uid}-own`,
		bookmarklet: `${uid}-bookmarklet`,
		files: `${uid}-files`,
		code: `${uid}-code`,
		guides: `${uid}-guides`,
		calendar: `${uid}-calendar`,
		telegram: `${uid}-telegram`,
		webde: `${uid}-webde`,
		gmail: `${uid}-gmail`,
		proton: `${uid}-proton`
	};
	/** The folded guide of each catalog entry. */
	const GUIDES: Readonly<Record<CatalogEntry, string>> = {
		kalender: `${uid}-guide-calendar`,
		telegram: `${uid}-guide-telegram`,
		webde: `${uid}-guide-webde`,
		gmail: `${uid}-guide-gmail`,
		proton: `${uid}-guide-proton`
	};

	const code = $derived(bookmarkletCode(captureUrl));
	let status = $state<string | null>(null);
	let catalogHeading = $state<HTMLElement>();
	/** Kind of the modal "Verbindung anlegen", null while it is closed. */
	let creating = $state<{ type: ConnectionType; provider: MailProvider } | null>(null);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			status = 'Code kopiert.';
		} catch {
			status = 'Kopieren nicht möglich. Bitte den Code im Feld markieren und mit Strg+C kopieren.';
		}
	}

	/** "Kanal hinzufügen" in the empty state: to the catalog, with the focus on its heading. */
	function focusCatalog() {
		catalogHeading?.scrollIntoView?.({ block: 'start' });
		catalogHeading?.focus();
	}

	/** Opens the folded guide of an entry and moves the focus to its summary. */
	async function openGuide(entry: CatalogEntry) {
		const details = document.getElementById(GUIDES[entry]);
		if (!(details instanceof HTMLDetailsElement)) return;
		details.open = true;
		await tick();
		details.scrollIntoView?.({ block: 'start' });
		details.querySelector<HTMLElement>('summary')?.focus();
	}

	function setup(entry: CatalogEntry) {
		if (entry === 'proton') void openGuide('proton');
		else if (entry === 'kalender') creating = { type: 'calendar', provider: 'webde' };
		else if (entry === 'telegram') creating = { type: 'telegram', provider: 'webde' };
		else creating = { type: 'mail', provider: entry };
	}

	function guideOf(connection: Connection): CatalogEntry {
		if (connection.type === 'calendar') return 'kalender';
		if (connection.type === 'telegram') return 'telegram';
		return connection.mailProvider === 'gmail' ? 'gmail' : 'webde';
	}
</script>

<div class="channels">
	<ChannelsIntro />

	<ConnectionsSection
		store={connections}
		onadd={focusCatalog}
		onsetup={(connection) => void openGuide(guideOf(connection))}
	/>

	<section class="own" aria-labelledby={ids.own}>
		<h3 id={ids.own}>Selbst hereinbringen</h3>
		<div class="own-cards">
			<section class="card" aria-labelledby={ids.bookmarklet}>
				<h4 id={ids.bookmarklet}>Bookmarklet für Web-Links</h4>
				<p>
					Das Bookmarklet bringt die gerade offene Webseite in den Eingang: Es öffnet die Erfassung
					in einem neuen Tab mit Adresse, Titel und markiertem Text der Seite. Gespeichert wird
					erst, wenn du dort auf „In den Eingang“ klickst.
				</p>
				<p class="link-row">
					<!-- eslint-disable svelte/no-navigation-without-resolve -- the bookmarklet itself: a javascript: address meant for the bookmarks bar, not for navigation here -->
					<a
						class="bookmarklet"
						href={code}
						draggable="true"
						onclick={(event) => {
							event.preventDefault();
							status = 'Den Link in die Lesezeichenleiste ziehen; hier bewirkt ein Klick nichts.';
						}}
					>
						In den Eingang
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</p>
				<ol>
					<li>Lesezeichenleiste einblenden (Strg+Umschalt+B).</li>
					<li>Den Link „In den Eingang“ mit der Maus auf die Leiste ziehen.</li>
					<li>
						Auf einer Webseite das Lesezeichen anklicken, im neuen Tab prüfen und „In den Eingang“
						wählen. Ist die App nicht angemeldet, geht es nach der Anmeldung dorthin weiter.
					</li>
				</ol>
				<p class="hint">
					Ohne Maus: Code kopieren, ein neues Lesezeichen anlegen und den Code als Adresse einfügen.
					Nur http- und https-Seiten werden übernommen. Dieselbe Seite ein zweites Mal meldet, dass
					sie schon im Eingang ist.
				</p>
				<label for={ids.code}>Code des Bookmarklets</label>
				<textarea id={ids.code} rows="3" readonly value={code}></textarea>
				<p>
					<button class="button-secondary" type="button" onclick={copy}>Code kopieren</button>
				</p>
				<p class="hint" role="status">{status ?? ''}</p>
			</section>

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
		onsetup={setup}
	/>

	<section class="guides" aria-labelledby={ids.guides}>
		<h3 id={ids.guides}>Anleitungen</h3>
		<p class="hint">
			Schritt für Schritt je Dienst; ein Assistent mit Prüfungen ersetzt sie in den nächsten
			Paketen.
		</p>

		<section class="guide" aria-labelledby={ids.calendar}>
			<details id={GUIDES.kalender}>
				<summary id={ids.calendar}>Google Calendar einrichten</summary>
				<p>
					Die App liest deinen Kalender über seine geheime iCal-Adresse. Sie übernimmt Termine von
					heute bis 30 Tage im Voraus alle 15 Minuten in den Eingang, solange die App läuft, und
					zwar nur solche, deren Titel oder Beschreibung ein Stichwort der Verbindung enthält. An
					Google ändert sie nichts.
				</p>
				<ol>
					<li>
						<a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer"
							>Google Calendar</a
						>
						im Browser öffnen. Links unter „Meine Kalender“ beim gewünschten Kalender auf die drei Punkte
						⋮ und dann „Einstellungen und Freigabe“ klicken.
					</li>
					<li>
						Ganz unten im Abschnitt „Kalender integrieren“ steht „Privatadresse im iCal-Format“. Mit
						dem Symbol daneben kopieren. Die Adresse beginnt mit
						<code>https://calendar.google.com/calendar/ical/</code> und endet auf
						<code>/basic.ics</code>.
					</li>
					<li>
						In der Eingabeaufforderung <code>setx BYL_GOOGLE_CALENDAR_URL "…"</code> eingeben und statt
						der Punkte die kopierte Adresse einfügen (Rechtsklick).
					</li>
					<li><code>stop.bat</code> und dann <code>start.bat</code> ausführen.</li>
					<li>
						Im Katalog „Kanal hinzufügen“ die Art „Google Calendar“ mit der Variablen
						<code>BYL_GOOGLE_CALENDAR_URL</code> anlegen.
					</li>
					<li>
						An der Verbindung Stichwörter eintragen (etwa „Vorschläge übernehmen“) und „Jetzt
						abrufen“ wählen. Ohne Stichwörter übernimmt sie nichts.
					</li>
				</ol>
				<p class="hint">
					Ein Termin landet nur einmal im Eingang, auch wenn du ihn zusätzlich als .ics-Datei
					hereinziehst. Ändert sich ein Termin, zieht sein Eintrag nach, solange er noch neu ist.
					Verworfene Termine kommen nicht wieder. Die Adresse erlaubt jedem, der sie kennt, den
					ganzen Kalender zu lesen. Gib sie nicht weiter. Widerrufen: in denselben Einstellungen bei
					„Privatadresse im iCal-Format“ auf „Zurücksetzen“, dann die neue Adresse per
					<code>setx</code> eintragen und die App neu starten.
				</p>
			</details>
		</section>

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

	.bookmarklet {
		display: inline-block;
		padding: 0.375rem 0.875rem;
		color: var(--color-brand-soft-text);
		text-decoration: none;
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: 0.375rem;
		cursor: grab;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	textarea {
		width: 100%;
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
