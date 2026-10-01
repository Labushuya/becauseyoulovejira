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
	import { channelSetupHref, trashHref } from '$lib/ticket-links';

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
	// Port change of the control script (ADR-0039 section 2), run in PowerShell in the folder app.
	const PORT_COMMAND =
		'powershell -NoProfile -ExecutionPolicy Bypass -File .\\byl-control.ps1 port 8091';
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
					im Titel, und die Vorschau sagt es. Ohne den Code zu kennen: „Projekt“ unter der Zeile
					wählen, das setzt ihn ein.
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
			Windows-Kontos, deren Name mit <code>BYL_</code> beginnt (nur Großbuchstaben, Ziffern und _).
			So landen sie weder in der App noch in Kopien des Ordners oder den Sicherungen im Ordner app;
			nur die Sicherungen im Zielverzeichnis nehmen sie verschlüsselt mit, wenn du es unter
			<a href={resolve('/einstellungen/sicherung')}>Sicherung</a> so lässt.
		</p>
		<p>
			Jeder Kanal hat dort eine Karte gleichen Aufbaus: oben der Zustand („Verbunden“, „Pausiert“,
			„Fehler“, „Einrichtung offen“ oder „Neustart nötig“), darunter eine Zeile wie „Zuletzt
			abgerufen vor 5 Min. · 3 neu“ und ein Knopf für den nächsten Schritt, etwa „Jetzt abrufen“
			oder „Einrichtung fortsetzen“. Alles Weitere steht im Menü „•••“ (Stichwörter, Pausieren,
			Umbenennen, Einrichtung, Hilfe, Löschen), Einzelheiten wie Stichwörter, Postfach, Hilfsprozess
			und letzter Fehler unter „Details“. Lange Listen von Stichwörtern zeigen dort zuerst 8 und „+
			N weitere“, ab 21 Stichwörtern mit einem Filterfeld.
		</p>
		<p>
			„Umbenennen …“ macht den Namen oben in der Karte zum Textfeld: <kbd>Enter</kbd> oder
			„Speichern“ übernimmt ihn, <kbd>Esc</kbd> oder „Abbrechen“ lässt ihn, wie er war. Er darf nicht
			leer sein und höchstens 100 Zeichen haben; heißt schon eine andere Verbindung so, sagt die Karte
			das, erlaubt es aber. Umbenennen ändert nur den Namen, nie Abruf, Zugangsdaten oder Stichwörter.
			Der neue Name steht sofort überall, auch in anderen Tabs, im Eingang bei „Quelle“ und in den Quellen
			eines Tickets (etwa „Postfach · Gmail Arbeit“). Eigener Eingang, WhatsApp Web, Dateien und Bookmarklet
			haben feste Namen.
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
				Danach die App neu starten: <code>neu-starten.bat</code> im Ordner <code>app</code>
				doppelklicken. Es erkennt die neue oder geänderte Variable und startet neu. Erst dann sieht die
				App die Variable, und die Karte der Verbindung steht nicht mehr auf „Einrichtung offen“.
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

	<section id="whatsapp-web" aria-labelledby="whatsapp-web-title">
		<h3 id="whatsapp-web-title">WhatsApp Web</h3>
		<p>
			Die Browser-Erweiterung „becauseyoulovejira für WhatsApp Web“ (Edge und Chrome) bringt
			Nachrichten aus deinem offenen WhatsApp-Web-Tab in den Eingang, ohne Export. Eingerichtet wird
			sie unter <a href={channelSetupHref({ kind: 'whatsapp-web', connectionId: null })}
				>Kanäle → WhatsApp Web → Einrichten</a
			>: Zugangsschlüssel erzeugen, Erweiterung aus dem Ordner
			<code>app\erweiterung-whatsapp-web</code>
			entpackt laden, Schlüssel eintragen, Verbindung testen.
		</p>
		<h4>So benutzt du sie</h4>
		<ul>
			<li>
				<strong>Einzeln:</strong> An jeder Nachricht mit Text steht beim Überfahren und per Tab ein kleiner
				Knopf „In den Eingang“. Er meldet „Angelegt“, „Schon im Eingang“ oder den Fehler.
			</li>
			<li>
				<strong>Automatisch:</strong> Der Schalter „Automatisch (nur mit Stichwort)“ in der Erweiterung
				ist aus, bis du ihn einschaltest. Dann gehen neue Nachrichten des geöffneten Chats an die App;
				übernommen wird nur, was ein Stichwort für WhatsApp Web enthält. Optional nur für genannte Chats.
			</li>
			<li>
				Dieselbe Nachricht kommt nur einmal an, auch nachdem du sie verworfen hast. Bilder, Sprach-
				und Videonachrichten ohne Text übernimmt die Erweiterung nicht; eine Bildunterschrift schon.
			</li>
		</ul>
		<h4>Gut zu wissen</h4>
		<ul>
			<li>
				Die Erweiterung ist inoffiziell und nicht von WhatsApp. Sie liest nur, was du im offenen Tab
				siehst; sie sendet nie etwas, klickt nichts und ändert keine Nachricht.
			</li>
			<li>
				Sie arbeitet nur, solange der WhatsApp-Web-Tab offen ist, und automatisch nur im gerade
				geöffneten Chat. Nachrichten von vor dem Einschalten übernimmt sie nicht.
			</li>
			<li>
				Nach Updates von WhatsApp kann sie eine Anpassung brauchen. Dann zeigt sie „Seitenstruktur
				nicht erkannt – Erweiterung braucht ein Update“ und tut nichts.
			</li>
			<li>
				Sie spricht nur mit der App auf diesem Rechner (<code>127.0.0.1</code> oder
				<code>localhost</code>), ohne Dienst im Internet. Absender, Chat, Zeit und Text landen im
				Eingang, Telefonnummern nicht.
			</li>
			<li>
				Nach einem Update der App auf der Seite der Erweiterungen (<code>edge://extensions</code>
				bzw.
				<code>chrome://extensions</code>) bei der Erweiterung auf „Neu laden“ klicken.
			</li>
		</ul>
	</section>

	<section id="notion" aria-labelledby="notion-title">
		<h3 id="notion-title">Notion</h3>
		<p>
			Aus Notion übernimmst du bestehende Listen als Kopien in den Eingang: die Zeilen einer
			Datenbank oder die Punkte von To-do-, Aufzählungs- und nummerierten Listen einer Seite. Die
			App liest nur; sie schreibt nie etwas nach Notion, meldet nichts zurück und ruft nie von
			selbst ab. Eingerichtet wird unter
			<a href={channelSetupHref({ kind: 'notion', connectionId: null })}
				>Kanäle → Notion (Listen übernehmen) → Einrichten</a
			>.
		</p>
		<h4>Einrichten</h4>
		<ol>
			<li>
				Im Developer-Portal von Notion eine interne Integration anlegen („Internal connections“ →
				„Create a new connection“) und unter „Capabilities“ nur „Read content“ eingeschaltet lassen.
			</li>
			<li>
				Das Token (beginnt mit <code>ntn_</code>) als Windows-Variable setzen, Vorschlag
				<code>BYL_NOTION_TOKEN</code>, dann <code>neu-starten.bat</code> im Ordner
				<code>app</code> doppelklicken. Für einen weiteren Arbeitsbereich legst du eine weitere
				Verbindung an; der Assistent schlägt dann einen freien Namen vor (etwa
				<code>BYL_NOTION_TOKEN_2</code>), damit das erste Token bleibt.
			</li>
			<li>
				In Notion jede Seite oder Datenbank freigeben, die du übernehmen willst: „•••“ →
				„Verbindungen“ → „Verbindung hinzufügen“. Unterseiten sind mit freigegeben; übernommen
				werden ihre Listen mit „Unterseiten einbeziehen“ oder wenn du sie selbst als Quelle wählst.
			</li>
			<li>Im Assistenten oder an der Karte im Menü „•••“ „Verbindung prüfen“.</li>
		</ol>
		<h4>Listen übernehmen</h4>
		<ul>
			<li>
				„Listen übernehmen …“ an der Karte zeigt die freigegebenen Seiten und Datenbanken. Du wählst
				eine oder mehrere Quellen (Umschalt+Klick für einen Bereich); die Wahl bleibt auch nach
				einer neuen Suche. Danach siehst du die Einträge je Quelle in einer Gruppe, die sich
				einklappen lässt, mit Datum und Kurztext; was schon im Eingang ist, ist gesperrt. Du wählst
				einzelne, alle einer Quelle oder alle aus und übernimmst sie in einem Durchgang.
			</li>
			<li>
				Die Übernahme läuft Quelle für Quelle in Blöcken. Oben im Dialog siehst du, wie viele
				Einträge schon bearbeitet sind, danach das Ergebnis mit „Im Eingang ansehen“ und bei
				mehreren Quellen eine Zeile je Quelle. „Nach diesem Block anhalten“ stoppt nach dem
				laufenden Block. Scheitert eine Quelle (etwa nicht mehr freigegeben), laufen die anderen
				weiter. Was nicht übernommen wurde, bleibt ausgewählt; ein neuer Versuch erkennt
				Übernommenes als „schon vorhanden“.
			</li>
			<li>
				<strong>Datenbank:</strong> Jede Zeile wird ein Eintrag. Die erste Datums-Eigenschaft (oder die
				gewählte) wird zum Datum, die übrigen Eigenschaften stehen als Liste im Text. Mit „Seiteninhalt
				als Kopie mitnehmen“ kommt auch der Inhalt der Seite jeder Zeile mit, höchstens 500 Blöcke und
				50.000 Zeichen je Seite; längere Seiten sind gekürzt und sagen das.
			</li>
			<li>
				<strong>Seite:</strong> Jeder Punkt einer Liste wird ein Eintrag; verschachtelte Punkte stehen
				als Text darunter. Eine Datumserwähnung im Punkt („@15. Oktober“) wird zum Datum. Mit „Unterseiten
				einbeziehen“ kommen auch die Listen ihrer Unterseiten mit, höchstens 50 Unterseiten bis zur dritten
				Ebene; der Abschnitt nennt die Unterseite. Unterseiten, die die Integration nicht sieht, fehlen
				und werden gezählt.
			</li>
			<li>
				Die Optionen gelten für alle gewählten Quellen; nur „Datum aus“ wählst du je Datenbank.
				„Erledigte überspringen“ (Standard) lässt abgehakte To-dos und erledigte Zeilen aus.
			</li>
			<li>
				„Erneut abrufen“ an einer schon übernommenen Quelle (unter „Details“ der Karte) holt nur
				Einträge, die noch nicht im Eingang sind, mit den Optionen des letzten Imports. „Alle erneut
				abrufen“ im Menü „•••“ der Karte macht das für alle Quellen nacheinander; die Karte zeigt,
				welche Quelle gerade läuft, und danach unter „Details“ das Ergebnis je Quelle. Verworfene
				kommen nicht wieder, Änderungen in Notion erreichen die Kopien nicht.
			</li>
			<li>
				Umgewandelt wird im Eingang wie immer. „Gesammelt umwandeln“ kann das Datum als Fälligkeit
				nehmen („Datum des Termins als Fälligkeit“).
			</li>
		</ul>
		<h4>Gut zu wissen</h4>
		<ul>
			<li>
				Das Token bleibt in der Variablen auf diesem Rechner; die App schickt es nur an Notion und
				zeigt es nirgends. Widerrufen: im Developer-Portal bei der Integration das Token erneuern
				oder die Integration löschen.
			</li>
			<li>
				Eine interne Integration kann nur anlegen, wer „Workspace Owner“ ist. Personen erscheinen
				mit Namen nur, wenn die Integration Benutzerinformationen lesen darf; sonst steht ihre Zahl
				da.
			</li>
			<li>
				Frisch freigegebene Seiten findet die Suche von Notion manchmal erst nach einem Moment; dann
				„Liste aktualisieren“. Eine Datenbank liest die App bis 1.000 Zeilen.
			</li>
		</ul>
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
						dann „Weitere Treffer – erneut abrufen“. Mails ohne Stichwort holst du an der Karte im Menü
						„•••“ mit „Aus dem Postfach wählen …“.
					</li>
					<li>
						Postfächer ruft der Hilfsprozess <code>byl-mail.exe</code> alle 5 Minuten ab. Er startet
						mit <code>start.bat</code>, sobald eine eingeschaltete Postfach-Verbindung besteht; sein
						Protokoll steht in <code>app\logs\byl-mail.log</code>.
					</li>
					<li>
						Die Karte der Verbindung unter „Kanäle“ zeigt, ob sie pausiert ist, ob Zugangsdaten
						fehlen, ob der Hilfsprozess einen Neustart braucht oder was beim letzten Abruf
						schiefging; unter „Details“ steht, was durchsucht wird.
					</li>
				</ul>
			</details>
			<details>
				<summary>Was schreibt der Telegram-Bot in den Chat?</summary>
				<ul>
					<li>
						Auf jede Nachricht, die er in den Eingang legt, antwortet er „Im Eingang gespeichert“;
						auf eine Nachricht ohne Stichwort „Kein Stichwort erkannt – nicht gespeichert“. Doppelte
						Nachrichten und Nachrichten aus nicht freigegebenen Chats beantwortet er nie.
					</li>
					<li>
						Beide Antworten schaltest du einzeln ab: „Bestätigung senden“ und „Hinweis bei fehlendem
						Stichwort senden“ an der Karte unter „Details“, im Menü „•••“ unter „Stichwörter und
						Einstellungen …“ oder im letzten Schritt der Einrichtung. Standardmäßig sind beide an.
					</li>
					<li>
						Der Bot schreibt diese Antworten in den Chat; in Gruppen sehen sie alle Mitglieder. Ohne
						Bestätigung siehst du im Chat nicht, ob eine Nachricht angekommen ist, nur im Eingang.
						Telegram hält Nachrichten für den Bot höchstens 24 Stunden bereit.
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
					<code>neu-starten.bat</code> startet den Server neu, wenn ein Update es braucht.
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
					im Menü „•••“ ihrer Karte pausieren bzw. löschen.
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
						Auch „Titel“ (in „Projekte“: „Name“) hat eine eigene Breite. Ist er schmaler, bekommen
						die anderen Spalten den Platz; ist er breiter, werden sie schmaler, bis zu ihrer
						Mindestbreite. Ein Doppelklick auf seinen Rand gibt ihm wieder den ganzen Rest.
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
					Gelöschte Tickets („In den Papierkorb …“ im Menü „•••“ des Tickets) liegen im
					<a href={trashHref()}>Papierkorb</a> (Link neben dem Umschalter der Ansichten). Dort stellst
					du ein Ticket mit „Wiederherstellen“ wieder her, samt Key, Unteraufgaben und Quellen; direkt
					nach dem Löschen geht das auch mit „Rückgängig“ unten links. Nach 30 Tagen löscht die App es
					endgültig; die Frist stellst du unter „Einstellungen → Tickets“ ein.
				</p>
			</details>
			<details>
				<summary>Was steht im Menü „•••“ eines Tickets?</summary>
				<ul>
					<li>
						Oben im Panel und in der Vollansicht öffnet „•••“ (Weitere Aktionen) die Aktionen des
						Tickets: „Link kopieren“, „Duplizieren …“ und „In den Papierkorb …“. Daneben bleiben
						„Vollansicht“ bzw. „Im Seitenpanel öffnen“ und das Schließen.
					</li>
					<li>
						Mit der Tastatur: <kbd>Tab</kbd> bis zu „•••“, <kbd>Enter</kbd> oder die Leertaste
						öffnet, die Pfeiltasten wählen, <kbd>Enter</kbd> führt aus, <kbd>Esc</kbd> schließt das Menü.
					</li>
					<li>
						„Link kopieren“ legt die Adresse des Tickets in die Zwischenablage, die Meldung unten
						links sagt „Link kopiert“. Der Link öffnet das Ticket im Seitenpanel, auch in einem
						anderen Tab.
					</li>
					<li>
						In der Tabelle „Aufgaben“ steht dasselbe Menü am Ende jeder Zeile, dazu „Im Seitenpanel
						öffnen“ und „In Vollansicht öffnen“: Sie öffnen das Ticket genau so, ohne zu ändern, wie
						Zeilen sonst öffnen. Ein Klick auf „•••“ öffnet die Zeile nicht.
					</li>
					<li>
						Ein Rechtsklick auf eine Zeile öffnet dasselbe Menü an der Maus, mit der Tastatur
						<kbd>Umschalt</kbd>+<kbd>F10</kbd> oder die Kontextmenü-Taste in der Zeile, in der du
						gerade bist. Die Zeile öffnet sich dabei nicht und wird nicht ausgewählt. Das Menü des
						Browsers bekommst du mit <kbd>Strg</kbd>+Rechtsklick, in Eingabefeldern, auf markiertem
						Text und auf anderen Links.
					</li>
					<li>
						Auch Papierkorb, Eingang, die Liste der Projekte und die Wiederholungen haben am Ende
						jeder Zeile „•••“ mit dem, was dort geht: etwa „Endgültig löschen …“ im Papierkorb, „Mit
						Ticket verknüpfen …“ im Eingang, „Archivieren“ bei Projekten und „Pausieren“ bei
						Wiederholungen.
					</li>
					<li>
						Im Eingang öffnet „Link der Quelle öffnen“ die Adresse eines Eintrags in einem neuen Tab
						(nur https). Ein verknüpfter Eintrag hat dort auch „Anderem Ticket zuordnen …“ und
						„Lösen“, ein Web-Link ohne Kopie „Seiteninhalt sichern“. Die Hauptquelle eines Tickets
						bleibt bei ihm: Ihr Menü hat kein „Lösen“ und kein anderes Ticket, das Panel des
						Eintrags sagt, warum.
					</li>
					<li>
						Die Kacheln der Projekte haben „•••“ oben rechts mit denselben Einträgen wie die Liste,
						auch per Rechtsklick auf die Kachel oder <kbd>Umschalt</kbd>+<kbd>F10</kbd> auf ihr. Ein Klick
						auf die Kachel öffnet das Projekt wie bisher.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie dupliziere ich ein Ticket?</summary>
				<ul>
					<li>
						„Duplizieren …“ (im Menü „•••“ oben im Panel und in der Vollansicht) fragt, wie das
						Duplikat entstehen soll: den Titel (vorbelegt mit „(Kopie)“), was es übernimmt
						(Beschreibung, Priorität, Projekt, Tags und Fälligkeit sind angehakt, Unteraufgaben und
						Kommentare nicht) und den Status. Den Status wählst du immer selbst, „Erledigt“ gibt es
						dabei nicht. Das Duplikat bekommt einen neuen Key im gewählten Projekt.
					</li>
					<li>
						Unteraufgaben kommen als neue, offene Unteraufgaben mit. Kopierte Kommentare beginnen
						mit „Kopiert aus HAUS-12“ und behalten Autor und Zeit; ein angepinnter bleibt angepinnt.
						Eine Wiederholung kommt nie mit: Das Duplikat ist ein normales Ticket.
					</li>
					<li>
						Hat das Ticket Quellen, wählst du „Keine Quelle“ (Standard) oder „Kopie der Herkunft
						übernehmen“: Dann bekommt das Duplikat einen eigenen Eintrag als Kopie seiner
						Hauptquelle, mit Text, Details und Originaldatei, markiert als „Kopie aus HAUS-12“. Die
						Quelle des Originals bleibt, wo sie ist, und dieselbe Mail kommt trotzdem nicht doppelt
						in den Eingang.
					</li>
					<li>
						Danach öffnet sich das Duplikat, wie du Tickets zuletzt geöffnet hast (Panel oder
						Vollansicht). Der Verlauf nennt an beiden Tickets „Dupliziert aus …“ bzw. „Dupliziert
						nach …“, und die Meldung unten links führt mit „HAUS-12 öffnen“ zurück zum Original.
					</li>
				</ul>
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
				<summary>Wie sehe ich die offenen Tickets eines Projekts?</summary>
				<ul>
					<li>
						In der Liste unter „Projekte“ klappt der Pfeil vor dem Code eine Zeile auf: Darunter
						stehen die offenen Tickets des Projekts (nicht erledigt, nicht im Papierkorb) mit Key,
						Titel, Status, Priorität und Fälligkeit, die früheste Fälligkeit zuerst, ohne Fälligkeit
						am Ende. Unterprojekte zeigen ihre eigenen Tickets eingerückt unter ihrer Zeile; ein
						Oberprojekt zeigt dort nur die Tickets direkt in ihm.
					</li>
					<li>
						Es stehen höchstens 10 Tickets da; bei mehr führt „Alle 12 in Aufgaben öffnen“ zu
						„Aufgaben“ mit dem Projekt als Filter. Ein Klick auf ein Ticket öffnet es, wie du
						Tickets zuletzt geöffnet hast (Panel oder Vollansicht); „•••“ und der Rechtsklick bieten
						dasselbe Menü wie in „Aufgaben“. Bearbeitet wird im Ticket oder in „Aufgaben“.
					</li>
					<li>
						„Alle aufklappen“ und „Alle zuklappen“ über der Liste öffnen bzw. schließen alle Zeilen.
						Welche Zeilen offen sind, merkt sich dieser Browser. Das Panel eines Projekts zeigt
						dieselbe Liste unter „Offene Tickets“, die Kacheln zählen sie als „aktiv“.
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
			<details>
				<summary>Wie ordne ich Kommentare und hebe einen hervor?</summary>
				<ul>
					<li>
						Über den Kommentaren wählst du „Neueste zuerst“ (Standard) oder „Älteste zuerst“; die
						Wahl gilt auf diesem Gerät für alle Tickets. „Kommentar hinzufügen …“ steht in beiden
						Fällen oben. Bei „Älteste zuerst“ springt die Ansicht nach dem Senden zu deinem neuen
						Kommentar am Ende.
					</li>
					<li>
						„Anpinnen“ an einem Kommentar stellt ihn immer ganz oben hin, mit „Angepinnt“ markiert.
						Ein Ticket hat höchstens einen angepinnten Kommentar: Pinnst du einen anderen an,
						ersetzt er den bisherigen, und die Meldung unten links bietet 8 Sekunden lang
						„Rückgängig“. „Lösen“ nimmt ihn wieder heraus; der Verlauf nennt jeden Schritt. Wird der
						angepinnte Kommentar gelöscht, ist das Anpinnen aufgehoben.
					</li>
					<li>
						Lange Kommentare zeigen zuerst etwa 12 Zeilen, dann „Weiterlesen“; „Weniger anzeigen“
						klappt sie wieder ein. Aufgeklappte bleiben es, solange der Tab offen ist. Zum
						Bearbeiten siehst du immer den ganzen Text.
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
				<dt>Starten</dt>
				<dd>
					<code>start.bat</code> im Ordner <code>app</code>. Läuft die App schon, startet es nichts
					doppelt und öffnet nur den Browser.
				</dd>
			</div>
			<div class="row">
				<dt>Neu starten</dt>
				<dd>
					<code>neu-starten.bat</code> im Ordner <code>app</code>. Es startet nur neu, wenn es nötig
					ist: nach einem Update mit neuer Migration oder Server-Logik, nach einer neuen oder
					geänderten <code>BYL_</code>-Variable oder einem neuen Mail-Hilfsprozess. Ist nur die
					Oberfläche neu gebaut, sagt es „F5 im offenen Tab genügt“.
				</dd>
			</div>
			<div class="row">
				<dt>Beenden</dt>
				<dd>
					<code>stop.bat</code> beendet geordnet erst den Mail-Hilfsprozess, dann den Server, und nur
					Programme aus diesem Ordner. Nach 15 Sekunden ohne Ende beendet es hart und sagt es.
				</dd>
			</div>
			<div class="row">
				<dt>Status</dt>
				<dd>
					<code>status.bat</code> zeigt, ob die App läuft, unter welcher Adresse, ob der Mail-Hilfsprozess
					läuft und ob ein Neustart nötig ist.
				</dd>
			</div>
			<div class="row">
				<dt>Aus dem Dashboard</dt>
				<dd>
					Unter <a href={resolve('/einstellungen/system')}>Einstellungen → System</a> siehst du
					dasselbe und kannst die App neu starten, den Mail-Hilfsprozess neu starten, den Autostart
					ein- und ausschalten, die Umgebung prüfen und die Logs ansehen. Das geht nur im Browser
					auf dem Rechner der App und nur mit dem App-Konto, das bei der Einrichtung zuerst angelegt
					wurde. Beenden geht weiter nur mit
					<code>stop.bat</code>; die Dateien im Ordner <code>app</code> bleiben wie sie sind.
				</dd>
			</div>
			<div class="row">
				<dt>Adresse und Port</dt>
				<dd>
					Diese App läuft unter <code>{page.url.origin}</code>. Den Port stellst du in PowerShell im
					Ordner <code>app</code> um, danach <code>neu-starten.bat</code>:
					<CodeBlock code={PORT_COMMAND} label="Port umstellen (PowerShell)" />
					Lesezeichen, die installierte App und die Browser-Erweiterung für WhatsApp Web brauchen dann
					die neue Adresse; anmelden musst du dich dort einmal neu.
				</dd>
			</div>
			<div class="row">
				<dt>Wenn es hakt</dt>
				<dd>
					Ist der Port belegt, nennt <code>start.bat</code> das Programm und einen freien Port.
					Antwortet die App nicht, hilft <code>neu-starten.bat</code>. Die Prüfung
					<code>byl-control.ps1 doctor</code> zeigt fehlende Dateien, Schreibrechte, Plattenplatz und
					andere laufende Kopien.
				</dd>
			</div>
			<div class="row">
				<dt>Protokolle</dt>
				<dd>
					Im Ordner <code>app\logs</code>: die Ausgabe des Servers, <code>byl-mail.log</code> des
					Mail-Hilfsprozesses (jeweils der vorige Lauf als <code>*.1.log</code>) und
					<code>byl-control.log</code> mit einer Zeile je Start und Stopp, alles ohne Zugangsdaten und
					Inhalte.
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
					Die App ist der Ordner <code>app</code>: Kopieren sichert sie. Automatisch sichert die App
					einmal am Tag in <code>app\pb_data\backups</code> und, wenn eingerichtet, verschlüsselt in
					ein Zielverzeichnis auf einem anderen Laufwerk; einmal in der Woche prüft sie, ob sich die
					neueste Sicherung öffnen und starten lässt. Alles dazu unter
					<a href={resolve('/einstellungen/sicherung')}>Einstellungen → Sicherung</a>. Zurückholen
					geht dort an jeder Sicherung mit „Wiederherstellen …“ oder mit
					<code>app\wiederherstellen.bat</code>; die bisherigen Daten bleiben sieben Tage als
					Sicherheitskopie im Ordner <code>app</code>.
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
