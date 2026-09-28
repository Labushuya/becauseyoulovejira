<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import { KEY_PLACEHOLDER, ingestExamples } from '$lib/domain/inbox-keys';
	import HostPlatformNote from '$lib/components/guidance/HostPlatformNote.svelte';
	import RecurrenceHelp from '$lib/components/help/RecurrenceHelp.svelte';
	import ShortcutList from '$lib/components/help/ShortcutList.svelte';
	import { PRIORITY_NUMBERS, PRIORITY_WORDS } from '$lib/domain/quick-syntax';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { HELP_SECTIONS } from '$lib/settings-sections';
	import { trashHref } from '$lib/ticket-links';

	// Settings "Hilfe" (ADR-0026 section 7, plan EH-9 §3.10): jump links, the keyboard shortcuts from
	// the one source, the short syntax of the quick entry, how the access data work (moved here from
	// the explanation on "Kanäle"), frequent questions as <details> and the operation of the app.
	// Shortcuts and tokens are description lists, not tables: no data list with a panel, and nothing
	// scrolls sideways (table-columns.test.ts stays for the real tables). The section IDs are the
	// anchors of helpHref(), used by the shortcuts modal, the quick entry and "Kanäle". The section
	// "Wiederholungen" (plan "Wiederholungen verständlich machen") explains rules with examples the
	// engine computes; the form, the overview and the rule panel link to it.

	// Examples of the own inbox (ADR-0038) with the address of this app and the key as placeholder.
	const examples = $derived(ingestExamples(page.url.origin));
	const EXAMPLE_PLACEHOLDERS = { [KEY_PLACEHOLDER]: { label: 'Zugangsschlüssel', secret: false } };

	const priorityWords = Object.keys(PRIORITY_WORDS).map((word) => `!${word}`);
	const priorityNumbers = Object.keys(PRIORITY_NUMBERS).map((number) => `!${number}`);
	const EXAMPLE = 'Zahnarzt anrufen @HAUS !hoch #anruf';
</script>

<svelte:head>
	<title>Hilfe · Einstellungen · becauseyoulovejira</title>
</svelte:head>

<div class="help">
	<nav class="jump" aria-label="Auf dieser Seite">
		<ul>
			{#each HELP_SECTIONS as section (section.id)}
				<li><a href={`#${section.id}`}>{section.label}</a></li>
			{/each}
		</ul>
	</nav>

	<section id="tastaturkuerzel" aria-labelledby="tastaturkuerzel-title">
		<h3 id="tastaturkuerzel-title">Tastaturkürzel</h3>
		<p>
			Mit <kbd>?</kbd> öffnest du die wichtigsten Tasten überall in der App, außer beim Tippen in einem
			Feld.
		</p>
		<ShortcutList headingLevel={4} />
	</section>

	<section id="kurzsyntax" aria-labelledby="kurzsyntax-title">
		<h3 id="kurzsyntax-title">Kurzsyntax</h3>
		<p>
			In der Schnellerfassung (<kbd>c</kbd>) schreibst du ein Ticket in eine Zeile. Erkannte Zeichen
			setzen Projekt, Priorität und Tags; alles andere wird der Titel.
		</p>
		<CodeBlock code={EXAMPLE} label="Beispiel" copyable={false} />
		<dl class="tokens">
			<div class="row">
				<dt><code>@CODE</code></dt>
				<dd>
					Projekt mit diesem Code (2 bis 6 Buchstaben). Nur aktive Projekte; ein archiviertes bleibt
					im Titel, und die Vorschau sagt es.
				</dd>
			</div>
			<div class="row">
				<dt>
					{#each priorityWords as word (word)}<code>{word}</code>{/each}
				</dt>
				<dd>Priorität, Groß- und Kleinschreibung egal.</dd>
			</div>
			<div class="row">
				<dt>
					{#each priorityNumbers as number (number)}<code>{number}</code>{/each}
				</dt>
				<dd>Dasselbe als Zahl: <code>!1</code> ist niedrig, <code>!4</code> dringend.</dd>
			</div>
			<div class="row">
				<dt><code>#tag</code></dt>
				<dd>Tag; einen neuen Namen legt die App beim Speichern an. Mehrere Tags gehen.</dd>
			</div>
			<div class="row">
				<dt>Übriger Text</dt>
				<dd>
					Wird der Titel. Unbekannte Zeichen bleiben darin; von Projekt und Priorität gilt jeweils
					das erste.
				</dd>
			</div>
			<div class="row">
				<dt><kbd>Enter</kbd> / <kbd>Alt</kbd>+<kbd>Enter</kbd></dt>
				<dd>Ticket anlegen bzw. die Zeile in den Eingang legen.</dd>
			</div>
		</dl>
	</section>

	<section id="wiederholungen" aria-labelledby="wiederholungen-title">
		<h3 id="wiederholungen-title">Wiederholungen</h3>
		<RecurrenceHelp />
	</section>

	<section id="zugangsdaten" aria-labelledby="zugangsdaten-title">
		<h3 id="zugangsdaten-title">Kanäle und Zugangsdaten</h3>
		<p>
			Kanäle richtest du unter <a href={resolve('/einstellungen/kanaele')}>Kanäle</a> mit einem
			Assistenten ein. Jede Verbindung liest ihre Zugangsdaten aus einer Umgebungsvariablen deines
			Windows-Kontos, deren Name mit <code>BYL_</code> beginnt (nur Großbuchstaben, Ziffern und _). So
			landen sie weder in der App noch in Sicherungen oder Kopien des Ordners.
		</p>
		<HostPlatformNote headingLevel={4} />
		<h4>Zugangsdaten als Windows-Variable setzen</h4>
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
				<code>app</code> doppelklicken. Erst dann sieht die App die Variable, und die Karte der Verbindung
				steht nicht mehr auf „Nicht eingerichtet“.
			</li>
		</ol>
		<p class="note">
			Ändern geht genauso (<code>setx</code> mit neuem Wert, dann neu starten). Entfernen: in der
			Systemsteuerung die Variable löschen oder
			<code>reg delete HKCU\Environment /v NAME /f</code>, dann neu starten. Auf einem anderen
			Rechner musst du die Variablen neu anlegen.
		</p>
	</section>

	<section id="eigener-eingang" aria-labelledby="eigener-eingang-title">
		<h3 id="eigener-eingang-title">Eigener Eingang (API)</h3>
		<p>
			Eigene Skripte und die Erweiterung für WhatsApp Web legen Einträge über eine einfache Adresse
			in deinen Eingang. Dafür erzeugst du unter
			<a href={resolve('/einstellungen/kanaele')}>Kanäle</a> auf der Karte „Eigener Eingang (API)“ einen
			Zugangsschlüssel. Er wird genau einmal angezeigt; kopiere ihn dann. Ein Schlüssel kann nur Einträge
			in deinen Eingang legen, nichts lesen, ändern oder löschen, und du kannst ihn jederzeit widerrufen.
		</p>
		<p>
			Die Adresse ist nur auf diesem Rechner erreichbar (<code>127.0.0.1</code>), nicht aus dem Netz
			oder dem Internet. Anfragen aus Webseiten lehnt die App ab.
		</p>
		<h4>Beispiel für PowerShell</h4>
		<CodeBlock
			code={examples.powershell}
			label="Beispiel für PowerShell"
			placeholders={EXAMPLE_PLACEHOLDERS}
			wrap
		/>
		<h4>Beispiel für die Eingabeaufforderung (curl)</h4>
		<CodeBlock
			code={examples.curl}
			label="Beispiel für die Eingabeaufforderung"
			placeholders={EXAMPLE_PLACEHOLDERS}
			wrap
		/>
		<h4>Felder</h4>
		<dl class="tokens">
			<div class="row">
				<dt><code>mode</code> (Pflicht)</dt>
				<dd>
					<code>manual</code>: kommt immer an. <code>auto</code>: kommt nur an, wenn ein Stichwort
					des Kanals in Titel oder Text steht (Groß- und Kleinschreibung egal); sonst antwortet die
					App mit „gefiltert“ und speichert nichts.
				</dd>
			</div>
			<div class="row">
				<dt><code>text</code> (Pflicht)</dt>
				<dd>Reiner Text, höchstens 100.000 Zeichen.</dd>
			</div>
			<div class="row">
				<dt><code>external_id</code> (Pflicht)</dt>
				<dd>
					Deine eigene Kennung des Eintrags (höchstens 200 Zeichen). Dieselbe Kennung kommt nur
					einmal an, auch wenn du den Eintrag verworfen hast.
				</dd>
			</div>
			<div class="row">
				<dt><code>title</code></dt>
				<dd>Titel; ohne ihn gilt die erste Zeile des Textes.</dd>
			</div>
			<div class="row">
				<dt><code>channel</code></dt>
				<dd>
					<code>api</code> (Standard) oder <code>whatsapp-web</code>; jeder Kanal hat eigene
					Stichwörter.
				</dd>
			</div>
			<div class="row">
				<dt><code>url</code>, <code>sender</code>, <code>chat</code></dt>
				<dd>Adresse (nur http und https), Absender und Chat, jeweils optional.</dd>
			</div>
			<div class="row">
				<dt><code>sent_at</code></dt>
				<dd>
					Zeitpunkt nach ISO 8601 mit Zeitzone, etwa <code>2026-09-28T14:30:00+02:00</code>; wird
					zum Quelldatum, nie zur Fälligkeit.
				</dd>
			</div>
		</dl>
		<h4>Antworten</h4>
		<dl class="tokens">
			<div class="row">
				<dt>201 <code>created</code></dt>
				<dd>Angelegt.</dd>
			</div>
			<div class="row">
				<dt>200 <code>duplicate</code></dt>
				<dd>Schon im Eingang (auch verworfen oder umgewandelt); nichts Neues.</dd>
			</div>
			<div class="row">
				<dt>422 <code>filtered</code></dt>
				<dd>Kein Stichwort bei <code>mode: auto</code>; nicht gespeichert.</dd>
			</div>
			<div class="row">
				<dt>400, 401, 403, 429</dt>
				<dd>
					Ungültige Felder (mit Grund), fehlender oder widerrufener Schlüssel, Anfrage aus einer
					Webseite, mehr als 60 Anfragen je Minute und Schlüssel.
				</dd>
			</div>
		</dl>
		<p class="note">
			Mit <code>GET</code> auf dieselbe Adresse und dem Schlüssel prüfst du die Verbindung: Die App nennt
			den Namen des Schlüssels.
		</p>
	</section>

	<section id="fragen" aria-labelledby="fragen-title">
		<h3 id="fragen-title">Häufige Fragen</h3>
		<div class="faq">
			<details>
				<summary>Warum kommt meine Mail nicht an?</summary>
				<ul>
					<li>
						Automatisch kommen Mails aus dem <strong>gesamten Posteingang</strong> (nicht
						Papierkorb, Spam oder Gesendet), in denen ein <strong>Stichwort</strong> vorkommt: in Betreff,
						Absender, Kopfzeilen oder Text. Pro Abruf kommen höchstens 200 neue Einträge; die Karte sagt
						dann „Weitere Treffer – erneut abrufen“. Mails ohne Stichwort holst du an der Karte mit „Aus
						dem Postfach wählen“.
					</li>
					<li>
						Postfächer ruft der Hilfsprozess <code>byl-mail.exe</code> alle 5 Minuten ab. Er startet
						mit <code>start.bat</code>, sobald eine eingeschaltete Postfach-Verbindung besteht; sein
						Protokoll steht in <code>app\logs\byl-mail.log</code>.
					</li>
					<li>
						Die Karte der Verbindung unter „Kanäle“ zeigt, ob sie pausiert ist, ob Zugangsdaten
						fehlen oder was beim letzten Abruf schiefging.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wo sind meine Zugangsdaten gespeichert?</summary>
				<p>
					Nur als Umgebungsvariable in deinem Windows-Konto. Die App kennt den Namen der Variablen,
					nie den Wert, und fragt beim Einrichten nur ab, ob sie die Variable sieht. Siehe
					<a href="#zugangsdaten">Kanäle und Zugangsdaten</a>.
				</p>
			</details>
			<details>
				<summary>Was bedeutet „{RESTART_NEEDED.title}“?</summary>
				<p>
					{RESTART_NEEDED.text} Läuft die App, öffnet <code>start.bat</code> allein nur den Browser;
					erst mit <code>stop.bat</code> davor startet der Server neu.
				</p>
			</details>
			<details>
				<summary>Wie widerrufe ich einen Zugang?</summary>
				<ul>
					<li>
						<strong>Google Calendar:</strong> in den Kalendereinstellungen bei der Privatadresse im iCal-Format
						auf „Zurücksetzen“ klicken.
					</li>
					<li>
						<strong>Telegram:</strong> bei BotFather <code>/revoke</code> (neuer Token) oder
						<code>/deletebot</code>.
					</li>
					<li>
						<strong>Web.de:</strong> das anwendungsspezifische Passwort löschen oder den POP3/IMAP-Zugriff
						ausschalten.
					</li>
					<li><strong>Gmail:</strong> das App-Passwort unter „App-Passwörter“ entfernen.</li>
				</ul>
				<p>
					Danach die Variable entfernen und die App neu starten, oder die Verbindung unter „Kanäle“
					im Menü „…“ pausieren bzw. löschen.
				</p>
			</details>
			<details>
				<summary>Warum sehe ich im Admin-Bereich andere Konten?</summary>
				<p>
					Es gibt zwei Arten: Das <strong>Admin-Konto</strong> verwaltet den Server unter
					<code>/_/</code> und funktioniert in der App nicht. Mit dem <strong>App-Konto</strong> meldest
					du dich hier an; ihm gehören die Tickets. Beide dürfen dieselbe E-Mail-Adresse haben, bleiben
					aber getrennte Konten mit eigenem Passwort. App-Konten stehen in der Verwaltung unter „Collections
					→ users“.
				</p>
			</details>
			<details>
				<summary>Wie ändere ich Spalten und ihre Breite?</summary>
				<ul>
					<li>
						Mit der Maus ziehst du den rechten Rand eines Spaltenkopfs. <kbd>Esc</kbd> beim Ziehen bricht
						ab, ein Doppelklick passt die Breite an den längsten Inhalt an.
					</li>
					<li>
						Mit der Tastatur geht alles über das Menü „Spalten“ in der Leiste über jeder Tabelle:
						Spalten ein- und ausblenden, schmaler und breiter um je 1 rem, „Standard
						wiederherstellen“.
					</li>
					<li>
						Wird das Fenster schmal oder öffnet sich das Panel, weichen Spalten in fester
						Reihenfolge; sie kommen mit ihrer Breite zurück. Die Einstellungen gelten nur auf diesem
						Gerät.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie arbeite ich mit Unteraufgaben?</summary>
				<ul>
					<li>
						Im Ticket unter „Unteraufgaben“ legst du mit „Unteraufgabe hinzufügen“ eine nach der
						anderen an: Titel tippen, <kbd>Enter</kbd>; <kbd>Esc</kbd> schließt das Feld. Sie bekommen
						Projekt und Tags des Tickets. Ein vorhandenes Ticket wird in der Zeile „Übergeordnet“ mit
						dem Knopf zum Festlegen zur Unteraufgabe. Es gibt nur eine Ebene.
					</li>
					<li>
						Solange eine Unteraufgabe offen ist, fragt das Erledigen des übergeordneten Tickets
						nach: „Unteraufgaben mit erledigen“ oder „Trotzdem erledigen“. Der Schalter „Blockiert
						das übergeordnete Ticket“ in der Unteraufgabe nimmt sie aus dieser Frage heraus.
					</li>
					<li>
						In der Liste stehen Unteraufgaben eingerückt unter ihrem Ticket, wenn beide zu sehen
						sind; sonst steht vor dem Titel der Pfad, etwa „HAUS-12 ›“. Das Einrücken schaltest du
						im Menü „Spalten“ aus, dort gibt es auch die Spalte „Übergeordnet“.
					</li>
					<li>
						Wird ein Ticket gelöscht, gehen seine Unteraufgaben mit in den Papierkorb und kommen mit
						ihm zurück. Das nächste Ticket einer wiederkehrenden Unteraufgabe gehört zu keinem
						Ticket.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie hole ich ein gelöschtes Ticket zurück?</summary>
				<p>
					Gelöschte Tickets liegen im <a href={trashHref()}>Papierkorb</a> (Link neben dem Umschalter
					der Ansichten). Dort stellst du ein Ticket mit „Wiederherstellen“ wieder her, samt Key, Unteraufgaben
					und Quellen; direkt nach dem Löschen geht das auch mit „Rückgängig“ unten links. Nach 30 Tagen
					löscht die App es endgültig; die Frist stellst du unter „Einstellungen → Tickets“ ein.
				</p>
			</details>
			<details>
				<summary>Wie gliedere ich ein Projekt in Unterprojekte?</summary>
				<ul>
					<li>
						Im Panel eines Projekts legst du unter „Unterprojekte“ mit „Unterprojekt anlegen“ etwa
						„Garten“ in „Haus“ an, oder du wählst bei einem Projekt das Feld „Oberprojekt“. Es gibt
						nur eine Ebene. Ein Unterprojekt hat einen eigenen Code und eigene Nummern, etwa GART-3;
						ein anderes Oberprojekt oder „Keins“ ändert keinen Key.
					</li>
					<li>
						Unter „Projekte“ stehen Unterprojekte eingerückt unter ihrem Oberprojekt; der Knopf am
						Oberprojekt klappt sie zu. Die Zahlen des Oberprojekts zählen die Unterprojekte mit, das
						Panel nennt „davon direkt“.
					</li>
					<li>
						Der Filter „Projekt“ zeigt bei „Haus“ auch die Tickets von „Garten“. Mit „Unterprojekte
						einbeziehen“ im Filter schaltest du das aus. Auswahllisten, die Spalte „Projekt“ und der
						Pfad im Ticket zeigen „Haus › Garten“.
					</li>
					<li>
						Archivieren von „Haus“ archiviert „Garten“ mit; zurück holst du jedes einzeln oder
						„Garten“ mit „Mit Oberprojekt zurückholen“. Ein Projekt mit Unterprojekten lässt sich
						nicht löschen. Unterprojekte haben keinen Status und keinen Fortschritt; sie gliedern
						nur.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie formatiere ich Beschreibungen und Kommentare?</summary>
				<ul>
					<li>
						Die Beschreibung bearbeitest du im Editor wie in Jira: Formatierungsleiste, Tastenkürzel
						(unter „Tastaturkürzel“, Abschnitt „Editor“) oder Markdown beim Tippen, etwa
						<code>## </code> für eine Überschrift oder <code>[ ] </code> für eine Checkliste. Mit
						<kbd>Alt</kbd>+<kbd>F10</kbd> kommst du in die Leiste, mit <kbd>Esc</kbd> zurück in den Text.
					</li>
					<li>
						<kbd>/</kbd> am Zeilenanfang oder nach einem Leerzeichen öffnet ein Menü für Überschriften,
						Listen, Blöcke und Link; weitertippen filtert.
					</li>
					<li>
						<kbd>Strg</kbd>+<kbd>K</kbd> fügt einen Link ein oder bearbeitet ihn (nur http, https und
						mailto).
					</li>
					<li>
						Aus Word, Google Docs oder einer Webseite eingefügter Text behält Überschriften, Listen,
						Links und Formatierung, aber keine Farben, Schriften und Bilder. Text mit Markdown wird
						formatiert eingefügt; <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>V</kbd> fügt reinen Text ein.
					</li>
					<li>
						„Markdown“ in der Leiste zeigt den Text als Markdown. Texte mit Tabellen oder Listen aus
						Aufgaben und normalen Punkten öffnen gleich dort, damit nichts verloren geht.
					</li>
					<li>
						Gespeichert wird immer Markdown: <code>**fett**</code>,
						<code>*kursiv*</code>, <code>~~durchgestrichen~~</code>, <code># Überschrift</code>,
						<code>- Punkt</code>, <code>1. Punkt</code>, <code>&gt; Zitat</code> und
						<code>`Code`</code>.
					</li>
					<li><code>++unterstrichen++</code> unterstreicht den Text.</li>
					<li>
						<code>- [ ] offen</code> und <code>- [x] erledigt</code> werden zu einer Checkliste mit Kästchen.
						Das geht nur in Aufzählungen, nicht in nummerierten Listen.
					</li>
					<li>
						Die Kästchen der Beschreibung und deiner eigenen Kommentare hakst du direkt in der
						Ansicht ab, ohne „Bearbeiten“. Hat jemand die Beschreibung inzwischen geändert, wird
						nichts überschrieben: Du bekommst einen Hinweis und hakst in der neuen Fassung erneut
						ab.
					</li>
					<li>
						HTML im Text bleibt Text, Bilder werden nicht geladen. „Vorschau“ zeigt, wie es
						aussieht.
					</li>
				</ul>
			</details>
		</div>
	</section>

	<section id="betrieb" aria-labelledby="betrieb-title">
		<h3 id="betrieb-title">Betrieb</h3>
		<HostPlatformNote headingLevel={4} />
		<dl class="tokens">
			<div class="row">
				<dt>Neu starten</dt>
				<dd>
					<code>stop.bat</code>, dann <code>start.bat</code> im Ordner <code>app</code>. Läuft die
					App schon, öffnet <code>start.bat</code> allein nur den Browser.
				</dd>
			</div>
			<div class="row">
				<dt>Protokolle</dt>
				<dd>
					Im Ordner <code>app\logs</code>: die Ausgabe des Servers vom letzten Start und
					<code>byl-mail.log</code> des Mail-Hilfsprozesses (ohne Zugangsdaten und Inhalte).
				</dd>
			</div>
			<div class="row">
				<dt>Ruckeln</dt>
				<dd>
					Ruckelt die Oberfläche, etwa über Remote-Desktop, schalte unter Einstellungen →
					Darstellung den Glas-Effekt aus.
				</dd>
			</div>
			<div class="row">
				<dt>Verwaltung</dt>
				<dd>
					Konten, Sicherungen und Server-Einstellungen unter
					<a href="/_/" rel="external">Verwaltung (nur mit dem Admin-Konto)</a>.
				</dd>
			</div>
			<div class="row">
				<dt>Sichern und umziehen</dt>
				<dd>
					Die App ist der Ordner <code>app</code>: Kopieren sichert sie. Automatische Sicherungen
					legt der Server alle 4 Stunden an; Einzelheiten stehen in der README.
				</dd>
			</div>
		</dl>
	</section>
</div>

<style>
	.help {
		display: grid;
		gap: 1.75rem;
	}

	section {
		display: grid;
		gap: 0.625rem;
		scroll-margin-top: calc(var(--app-header-height, 0px) + 1rem);
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	p,
	li,
	dd,
	dt {
		font-size: var(--font-size-body);
	}

	.note {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.jump ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		list-style: none;
	}

	.jump a,
	section a {
		color: var(--color-brand-text);
	}

	ol,
	.faq ul {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	.tokens {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.row dt {
		display: flex;
		flex: 0 0 13rem;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
		font-weight: 500;
	}

	.row dd {
		flex: 1 1 18rem;
		max-width: 80ch;
	}

	.faq {
		display: grid;
		gap: 0.5rem;
	}

	details {
		padding: 0.625rem 0.875rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	details[open] > * + * {
		margin-top: 0.5rem;
	}

	summary {
		font-size: var(--font-size-body);
		font-weight: 500;
		cursor: pointer;
	}
</style>
