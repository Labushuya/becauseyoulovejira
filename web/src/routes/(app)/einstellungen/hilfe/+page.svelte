<script lang="ts">
	import { resolve } from '$app/paths';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import ShortcutList from '$lib/components/help/ShortcutList.svelte';
	import { PRIORITY_NUMBERS, PRIORITY_WORDS } from '$lib/domain/quick-syntax';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { HELP_SECTIONS } from '$lib/settings-sections';

	// Settings "Hilfe" (ADR-0026 section 7, plan EH-9 §3.10): jump links, the keyboard shortcuts from
	// the one source, the short syntax of the quick entry, how the access data work (moved here from
	// the explanation on "Kanäle"), frequent questions as <details> and the operation of the app.
	// Shortcuts and tokens are description lists, not tables: no data list with a panel, and nothing
	// scrolls sideways (table-columns.test.ts stays for the real tables). The section IDs are the
	// anchors of helpHref(), used by the shortcuts modal, the quick entry and "Kanäle".

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

	<section id="zugangsdaten" aria-labelledby="zugangsdaten-title">
		<h3 id="zugangsdaten-title">Kanäle und Zugangsdaten</h3>
		<p>
			Kanäle richtest du unter <a href={resolve('/einstellungen/kanaele')}>Kanäle</a> mit einem
			Assistenten ein. Jede Verbindung liest ihre Zugangsdaten aus einer Umgebungsvariablen deines
			Windows-Kontos, deren Name mit <code>BYL_</code> beginnt (nur Großbuchstaben, Ziffern und _). So
			landen sie weder in der App noch in Sicherungen oder Kopien des Ordners.
		</p>
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

	<section id="fragen" aria-labelledby="fragen-title">
		<h3 id="fragen-title">Häufige Fragen</h3>
		<div class="faq">
			<details>
				<summary>Warum kommt meine Mail nicht an?</summary>
				<ul>
					<li>
						Automatisch kommen nur neue Mails, die <strong>nach dem ersten Abruf</strong> der
						Verbindung eintreffen und ein <strong>Stichwort in Betreff oder Absender</strong> haben (auf
						Wunsch auch in den ersten 500 Zeichen des Textes). Ältere Mails holst du an der Karte mit
						„Aus dem Postfach wählen“.
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
		</div>
	</section>

	<section id="betrieb" aria-labelledby="betrieb-title">
		<h3 id="betrieb-title">Betrieb</h3>
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
		font-size: 0.875rem;
		font-weight: 600;
	}

	p,
	li,
	dd,
	dt {
		font-size: 0.875rem;
	}

	.note {
		font-size: 0.8125rem;
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
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}
</style>
