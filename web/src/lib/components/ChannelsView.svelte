<script lang="ts">
	import { bookmarkletCode } from '$lib/domain/bookmarklet';
	import type { ConnectionsStore } from '$lib/stores/connections.svelte';
	import ConnectionsSection from './ConnectionsSection.svelte';

	// Settings "Kanäle" (E4 plan, T-3 and packages 7, 10, 15 and 17): the bookmarklet, the
	// connections with access data from Windows user environment variables (ADR-0018), how to set
	// them and how to set up Google Calendar and the Telegram bot. The
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
		heading: `${uid}-heading`,
		bookmarklet: `${uid}-bookmarklet`,
		code: `${uid}-code`,
		variables: `${uid}-variables`,
		calendar: `${uid}-calendar`,
		telegram: `${uid}-telegram`
	};

	const code = $derived(bookmarkletCode(captureUrl));
	let status = $state<string | null>(null);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			status = 'Code kopiert.';
		} catch {
			status = 'Kopieren nicht möglich. Bitte den Code im Feld markieren und mit Strg+C kopieren.';
		}
	}
</script>

<section class="channels" aria-labelledby={ids.heading}>
	<h2 id={ids.heading}>Kanäle</h2>

	<section class="card" aria-labelledby={ids.bookmarklet}>
		<h3 id={ids.bookmarklet}>Bookmarklet für Web-Links</h3>
		<p>
			Das Bookmarklet bringt die gerade offene Webseite in den Eingang: Es öffnet die Erfassung in
			einem neuen Tab mit Adresse, Titel und markiertem Text der Seite. Gespeichert wird erst, wenn
			du dort auf „In den Eingang“ klickst.
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
			Ohne Maus: Code kopieren, ein neues Lesezeichen anlegen und den Code als Adresse einfügen. Nur
			http- und https-Seiten werden übernommen. Dieselbe Seite ein zweites Mal meldet, dass sie
			schon im Eingang ist.
		</p>
		<label for={ids.code}>Code des Bookmarklets</label>
		<textarea id={ids.code} rows="3" readonly value={code}></textarea>
		<p>
			<button class="secondary" type="button" onclick={copy}>Code kopieren</button>
		</p>
		<p class="hint" role="status">{status ?? ''}</p>
	</section>

	<ConnectionsSection store={connections} />

	<section class="card" aria-labelledby={ids.variables}>
		<h3 id={ids.variables}>Zugangsdaten als Windows-Variable setzen</h3>
		<p>
			Jede Verbindung liest ihre Zugangsdaten aus einer Umgebungsvariablen deines Windows-Kontos,
			deren Name mit <code>BYL_</code> beginnt (nur Großbuchstaben, Ziffern und _). So landen sie weder
			in der App noch in Sicherungen oder Kopien des Ordners.
		</p>
		<ol>
			<li>
				<strong>Per Eingabeaufforderung:</strong> Windows-Taste, „cmd“ eingeben, Eingabetaste. Dann
				<code>setx NAME "Wert"</code> eingeben, also etwa
				<code>setx BYL_TELEGRAM_TOKEN "123456789:AA…"</code>. Den Wert in Anführungszeichen setzen.
				Die Meldung „Erfolgreich: Der angegebene Wert wurde gespeichert.“ bestätigt es.
			</li>
			<li>
				<strong>Oder per Systemsteuerung:</strong> Windows-Taste, „Umgebungsvariablen“ eingeben und „Umgebungsvariablen
				für dieses Konto bearbeiten“ öffnen. Unter „Benutzervariablen“ auf „Neu…“, Name und Wert eintragen,
				mit „OK“ bestätigen.
			</li>
			<li>
				Danach die App neu starten: <code>stop.bat</code> und dann <code>start.bat</code> im Ordner
				<code>app</code> doppelklicken. Erst dann sieht die App die Variable; die Verbindung zeigt „Zugangsdaten
				gesetzt.“
			</li>
		</ol>
		<p class="hint">
			Ändern geht genauso (<code>setx</code> mit neuem Wert, dann neu starten). Entfernen: in der
			Systemsteuerung die Variable löschen oder <code>reg delete HKCU\Environment /v NAME /f</code>,
			dann neu starten. Auf einem anderen Rechner musst du die Variablen neu anlegen.
		</p>
	</section>

	<section class="card" aria-labelledby={ids.calendar}>
		<h3 id={ids.calendar}>Google Calendar einrichten</h3>
		<p>
			Die App liest deinen Kalender über seine geheime iCal-Adresse. Sie übernimmt Termine von heute
			bis 30 Tage im Voraus alle 15 Minuten in den Eingang, solange die App läuft, und zwar nur
			solche, deren Titel oder Beschreibung ein Stichwort der Verbindung enthält. An Google ändert
			sie nichts.
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
				Ganz unten im Abschnitt „Kalender integrieren“ steht „Privatadresse im iCal-Format“. Mit dem
				Symbol daneben kopieren. Die Adresse beginnt mit
				<code>https://calendar.google.com/calendar/ical/</code> und endet auf
				<code>/basic.ics</code>.
			</li>
			<li>
				In der Eingabeaufforderung <code>setx BYL_GOOGLE_CALENDAR_URL "…"</code> eingeben und statt der
				Punkte die kopierte Adresse einfügen (Rechtsklick).
			</li>
			<li><code>stop.bat</code> und dann <code>start.bat</code> ausführen.</li>
			<li>
				Oben unter „Verbindungen“ die Art „Google Calendar“ mit der Variablen
				<code>BYL_GOOGLE_CALENDAR_URL</code> anlegen.
			</li>
			<li>
				An der Verbindung Stichwörter eintragen (etwa „Vorschläge übernehmen“) und „Jetzt abrufen“
				wählen. Ohne Stichwörter übernimmt sie nichts.
			</li>
		</ol>
		<p class="hint">
			Ein Termin landet nur einmal im Eingang, auch wenn du ihn zusätzlich als .ics-Datei
			hereinziehst. Ändert sich ein Termin, zieht sein Eintrag nach, solange er noch neu ist.
			Verworfene Termine kommen nicht wieder. Die Adresse erlaubt jedem, der sie kennt, den ganzen
			Kalender zu lesen. Gib sie nicht weiter. Widerrufen: in denselben Einstellungen bei
			„Privatadresse im iCal-Format“ auf „Zurücksetzen“, dann die neue Adresse per
			<code>setx</code> eintragen und die App neu starten.
		</p>
	</section>

	<section class="card" aria-labelledby={ids.telegram}>
		<h3 id={ids.telegram}>Telegram-Bot einrichten</h3>
		<p>
			Du legst einen eigenen Bot an und schreibst ihm, was in den Eingang soll. Die App fragt jede
			Minute nach neuen Nachrichten, solange sie läuft. Nur Nachrichten aus freigegebenen Chats mit
			einem Stichwort der Verbindung werden gespeichert; jede beantwortet der Bot mit „Im Eingang
			gespeichert“. Auf Nachrichten ohne Stichwort antwortet er „Kein Stichwort erkannt – nicht
			gespeichert“ (abschaltbar). Text und Bildunterschriften werden übernommen, Bilder und Dateien
			nicht.
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
				Deine ID herausfinden: Richte die Verbindung zunächst mit einer beliebigen Zahl als ID ein
				(nächster Schritt), schreibe dem Bot eine Nachricht und wähle hier „Jetzt abrufen“. Die
				Verbindung zeigt dann „Nachricht aus einem nicht freigegebenen Chat (Chat-ID …)“. Im Chat
				mit dem Bot ist das deine User-ID. Für eine Gruppe den Bot hinzufügen; ihre Chat-ID beginnt
				mit „-100“.
			</li>
			<li>
				<code>setx BYL_TELEGRAM_ALLOWED_IDS "…"</code> mit der ID eingeben, mehrere durch Komma
				getrennt (etwa <code>"424242,-100123456"</code>).
			</li>
			<li>
				<code>stop.bat</code> und dann <code>start.bat</code> ausführen. Oben unter „Verbindungen“
				die Art „Telegram-Bot“ mit <code>BYL_TELEGRAM_TOKEN</code> und
				<code>BYL_TELEGRAM_ALLOWED_IDS</code> anlegen, falls noch nicht geschehen.
			</li>
			<li>
				An der Verbindung Stichwörter eintragen, etwa „todo“ oder „#byl“. Nur Nachrichten mit einem
				davon landen im Eingang.
			</li>
		</ol>
		<p class="hint">
			Telegram hält Nachrichten für den Bot höchstens 24 Stunden bereit. Läuft die App länger nicht,
			gehen sie verloren; fehlt die Antwort „Im Eingang gespeichert“, ist die Nachricht nicht
			angekommen. In Gruppen sieht ein Bot normalerweise nur Befehle und Antworten an ihn; soll er
			alles lesen, bei BotFather <code>/setprivacy</code> auf „Disable“ stellen. Widerrufen: bei
			BotFather <code>/revoke</code> (neuer Token, dann <code>setx</code> und neu starten) oder
			<code>/deletebot</code>.
		</p>
	</section>
</section>

<style>
	.channels {
		display: grid;
		gap: 1rem;
		max-width: 48rem;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.card {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
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

	.secondary {
		padding: 0.5rem 1rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
