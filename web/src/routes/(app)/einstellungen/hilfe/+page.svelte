<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import ExternalLink from '$lib/components/guidance/ExternalLink.svelte';
	import { GITHUB_TOKEN_TEMPLATE_URL } from '$lib/domain/channel-setup';
	import {
		EMERGENCY_CONTENTS,
		EMERGENCY_LOSSES,
		EMERGENCY_MANUAL,
		EMERGENCY_STEPS
	} from '$lib/domain/backup';
	import { KEY_PLACEHOLDER, ingestExamples } from '$lib/domain/inbox-keys';
	import HostPlatformNote from '$lib/components/guidance/HostPlatformNote.svelte';
	import PcOnly from '$lib/components/guidance/PcOnly.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import RecurrenceHelp from '$lib/components/help/RecurrenceHelp.svelte';
	import ScriptProblemsHelp from '$lib/components/help/ScriptProblemsHelp.svelte';
	import ShortcutList from '$lib/components/help/ShortcutList.svelte';
	import { PRIORITY_NUMBERS, PRIORITY_WORDS } from '$lib/domain/quick-syntax';
	import { CONTEXT_TEXTS, RESTART_NEEDED } from '$lib/guidance/texts';
	import { HELP_SECTIONS, helpHref } from '$lib/settings-sections';
	import { appContext } from '$lib/stores/context.svelte';
	import { calendarHref, channelSetupHref, trashHref } from '$lib/ticket-links';

	// Settings "Hilfe" (ADR-0026 section 7, plan EH-9 §3.10): jump links, the keyboard shortcuts from
	// the one source, the short syntax of the quick entry, how the access data work (moved here from
	// the explanation on "Kanäle"), frequent questions as <details> and the operation of the app.
	// Shortcuts and tokens are description lists, not tables: no data list with a panel, and nothing
	// scrolls sideways (table-columns.test.ts stays for the real tables). The section IDs are the
	// anchors of helpHref(), used by the shortcuts modal, the quick entry and "Kanäle". The section
	// "Wiederholungen" (plan "Wiederholungen verständlich machen") explains rules with examples the
	// engine computes; the form, the overview and the rule panel link to it. The section "Sicherung &
	// Notfall" (ADR-0046 §8) takes the steps for a new machine from the one source of the Notfallkarte.
	// "Betrieb" ends with the frequent problems of the scripts in the words of their catalog
	// (ADR-0048, ScriptProblemsHelp). Since KOB-1 (ADR-0057) commands, .bat files, setx, the Explorer
	// and the steps at the machine of the app show only for the administrator there (PcOnly); the
	// administrator on another device reads "nur am PC" instead, every other account "Bitte den
	// Verwalter fragen.", and "Betrieb" and "Sicherung & Notfall" become one sentence for them.

	const mode = $derived(appContext.capabilities.mode);

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

	<section id="kalender" aria-labelledby="kalender-title">
		<h3 id="kalender-title">Kalender</h3>
		<p>
			Der <a href={calendarHref()}>Kalender</a> zeigt, was wann ansteht: als Monat, als Woche oder als
			Agenda. Es gibt nur Tage, keine Uhrzeiten; jeder Eintrag gilt für den ganzen Tag. „Heute“, die Pfeile
			davor und danach und die Wahl der Ansicht stehen über dem Kalender; Ansicht, Tag und Filter stehen
			in der Adresse, und die zuletzt gewählte Ansicht merkt sich dieses Gerät.
		</p>
		<h4>Was im Kalender steht</h4>
		<ul>
			<li>
				<strong>Tickets</strong> an ihrem Fälligkeitstag. Überfällige sind fett, mit einer Uhr und „überfällig“,
				nie rot. Erledigte zeigt die Ebene „Erledigte Tickets“ gedämpft mit Häkchen.
			</li>
			<li>
				<strong>Künftige Wiederholungen</strong> blass und gestrichelt: Termine einer Regel, für die es
				noch kein Ticket gibt, mit „erscheint am …“. Pausierte Regeln zeigt der Kalender nicht. Ein Klick
				öffnet die Regel neben dem Kalender.
			</li>
			<li>
				<strong>Termine im Eingang</strong> gedämpft: neue Einträge mit Datum aus Kalendern und Notion,
				die noch nicht umgewandelt sind. Ein Klick öffnet den Eintrag neben dem Kalender.
			</li>
		</ul>
		<p>
			Regel und Eintrag bleiben dabei im Kalender, so wie ein Ticket: Ein Ticket, das du dort
			öffnest, nimmt ihren Platz ein, und das Schließen führt zurück zur Regel bzw. zum Eintrag,
			danach zum Kalender mit Ansicht, Tag und Filtern.
		</p>
		<p>
			Unter „Ebenen“ blendest du jede dieser Arten ein und aus; das merkt sich dieses Gerät. Die
			Filter sind die von „Aufgaben“ ohne „Fällig“ und Suche. Ein Projekt zeigt auch die Termine des
			Eingangs mit diesem Zielprojekt; Status, Priorität, Tag und „Wiederkehrend“ blenden die
			Termine des Eingangs aus, weil sie keine haben.
		</p>
		<p>
			Die Farbe eines Tickets steht als Streifen vor dem Titel, wie in „Aufgaben“. Ein Tag zeigt im
			Monat höchstens vier Einträge; „+N weitere“ öffnet die Liste des Tages. Ein Klick auf ein
			Ticket öffnet es neben dem Kalender, so wie du Tickets zuletzt geöffnet hast (Seitenpanel oder
			Vollansicht); ein Rechtsklick öffnet sein Menü. In einem schmalen Fenster startet der Kalender
			mit der Agenda, und der Monat zeigt Punkte statt Titel.
		</p>
		<h4>Mit der Tastatur</h4>
		<ul>
			<li>
				Im Monat und in der Woche: die Pfeiltasten von Tag zu Tag, <kbd>Pos1</kbd> und
				<kbd>Ende</kbd>
				zum Anfang und Ende der Woche (mit <kbd>Strg</kbd> des Monats).
			</li>
			<li><kbd>Bild auf</kbd> und <kbd>Bild ab</kbd>: einen Monat bzw. eine Woche weiter.</li>
			<li><kbd>Enter</kbd> führt in die Einträge des Tages, <kbd>Esc</kbd> zurück zum Tag.</li>
			<li><kbd>Umschalt</kbd>+<kbd>F10</kbd> öffnet das Menü eines Tickets.</li>
			<li><kbd>m</kbd> auf einem offenen Ticket verschiebt seine Fälligkeit (siehe unten).</li>
		</ul>
		<h4>Fälligkeit verschieben</h4>
		<p>
			Im Monat und in der Woche ziehst du ein offenes Ticket mit der Maus auf einen anderen Tag; das
			setzt seine Fälligkeit. Ohne Maus wählst du im Menü des Tickets „Fälligkeit verschieben …“
			oder drückst <kbd>m</kbd>: Dann wählst du den Tag mit den Pfeiltasten (auch in anderen
			Monaten) oder tippst bzw. klickst ihn an, <kbd>Enter</kbd> setzt ihn, <kbd>Esc</kbd> oder „Abbrechen“
			lassen alles, wie es war. Danach meldet sich „Fälligkeit von HAUS-12 auf 09.10.2026 gesetzt.“ mit
			„Rückgängig“.
		</p>
		<p>
			Erledigte Tickets, künftige Wiederholungen und Termine im Eingang bleiben, wo sie sind. Bei
			einem Ticket einer Serie verschiebt sich nur dieses Ticket, nicht die Serie. Hat jemand das
			Ticket inzwischen geändert, etwa in einem anderen Tab, wird nichts überschrieben, und eine
			Meldung sagt es. Auf Touch-Geräten scrollt das Ziehen die Seite; dort geht es über das Menü.
		</p>
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
			oder „Einrichtung fortsetzen“. Alles Weitere steht im Menü „•••“ (Stichwörter, Zielprojekt,
			Pausieren, Umbenennen, Einrichtung, Hilfe, Löschen), Einzelheiten wie Stichwörter,
			Zielprojekt, Postfach, Hilfsprozess und letzter Fehler unter „Details“. Lange Listen von
			Stichwörtern zeigen dort zuerst 8 und „+ N weitere“, ab 21 Stichwörtern mit einem Filterfeld.
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
		<p>
			Das „Zielprojekt“ einer Karte ist das Projekt, zu dem ihre Einträge meist gehören, etwa
			„Arbeit“ für das Arbeitspostfach. Du wählst es unter „Details“ (oder über „Zielprojekt …“ im
			Menü „•••“, bei neuen Verbindungen auch im Assistenten); es speichert sofort. Ein neuer
			Eintrag merkt es sich beim Eintreffen, eine spätere Änderung gilt also nur für neue Einträge.
			Beim Umwandeln ist es vorbelegt, und du kannst es ändern; ein archiviertes oder gelöschtes
			Projekt wird nicht vorbelegt. Im Eingang filterst und gruppierst du nach Zielprojekt.
		</p>
		<HostPlatformNote headingLevel={4} />
		<h4>Zugangsdaten als Windows-Variable setzen</h4>
		<PcOnly>
			<ol>
				<li>
					<strong>Per Eingabeaufforderung:</strong> Windows-Taste, „cmd“ eingeben, Eingabetaste.
					Dann
					<code>setx NAME "Wert"</code> eingeben, also etwa
					<code>setx BYL_TELEGRAM_TOKEN "123456789:AA…"</code>. Den Wert in Anführungszeichen
					setzen. Die Meldung „Erfolgreich: Der angegebene Wert wurde gespeichert.“ bestätigt es.
				</li>
				<li>
					<strong>Oder per Systemsteuerung:</strong> Windows-Taste, „Umgebungsvariablen“ eingeben und
					„Umgebungsvariablen für dieses Konto bearbeiten“ öffnen. Unter „Benutzervariablen“ auf „Neu…“,
					Name und Wert eintragen, mit „OK“ bestätigen.
				</li>
				<li>
					Danach die App neu starten: <code>neu-starten.bat</code> im Ordner <code>app</code>
					doppelklicken. Es erkennt die neue oder geänderte Variable und startet neu. Erst dann sieht
					die App die Variable, und die Karte der Verbindung steht nicht mehr auf „Einrichtung offen“.
				</li>
			</ol>
			<p class="note">
				Ändern geht genauso (<code>setx</code> mit neuem Wert, dann neu starten). Entfernen: in der
				Systemsteuerung die Variable löschen oder
				<code>reg delete HKCU\Environment /v NAME /f</code>, dann neu starten. Auf einem anderen
				Rechner musst du die Variablen neu anlegen.
			</p>
		</PcOnly>
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
			Die Adresse ist nur auf diesem Rechner erreichbar (<code>127.0.0.1</code>), mit
			eingeschaltetem
			<a href="#heimnetz">Zugriff im Heimnetz</a> auch von Geräten im Heimnetz, nie aus dem Internet.
			Anfragen aus Webseiten lehnt die App ab.
		</p>
		<PcOnly>
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
		</PcOnly>
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
				<PcOnly inline>
					Das Token (beginnt mit <code>ntn_</code>) als Windows-Variable setzen, Vorschlag
					<code>BYL_NOTION_TOKEN</code>, dann <code>neu-starten.bat</code> im Ordner
					<code>app</code> doppelklicken. Für einen weiteren Arbeitsbereich legst du eine weitere
					Verbindung an; der Assistent schlägt dann einen freien Namen vor (etwa
					<code>BYL_NOTION_TOKEN_2</code>), damit das erste Token bleibt.
				</PcOnly>
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

	<section id="github" aria-labelledby="github-title">
		<h3 id="github-title">GitHub</h3>
		<p>
			Der Kanal GitHub beobachtet Repositorys: Roadmaps, Changelogs und andere gewählte Dateien,
			Pull Requests und Releases. Die App liest nur; sie schreibt nie etwas nach GitHub, keinen
			Kommentar, keinen Status, keine Änderung. Eingerichtet wird unter
			<a href={channelSetupHref({ kind: 'github', connectionId: null })}
				>Kanäle → GitHub → Einrichten</a
			>.
		</p>
		<h4>Token anlegen (nur lesend)</h4>
		<p>
			Öffentliche Repositorys liest die App auch ohne Token, dann mit höchstens 60 Anfragen je
			Stunde. Für private Repositorys (und 5.000 Anfragen je Stunde) brauchst du ein „Fine-grained
			personal access token“:
		</p>
		<ol>
			<li>
				Auf github.com oben rechts auf dein Profilbild klicken, dann „Settings“ → links ganz unten
				„Developer settings“ → „Personal access tokens“ → „Fine-grained tokens“ → „Generate new
				token“. Schneller geht es mit dem
				<ExternalLink href={GITHUB_TOKEN_TEMPLATE_URL}>vorbelegten Token-Formular</ExternalLink>
				(Name, 90 Tage, nur lesend).
			</li>
			<li>
				„Token name“ etwa <code>becauseyoulovejira</code>, bei „Expiration“ eine Frist, bei
				„Resource owner“ dein Konto.
			</li>
			<li>
				„Repository access“, zwei gleichwertige Wege: „All repositories“ (einfach: das Token darf
				alle deine Repositorys nur lesen; welche die App beobachtet, legst du in der App fest) oder
				„Only select repositories“ (strenger: nur die Repositorys, die du dort auswählst).
			</li>
			<li>
				„Permissions“ → Rechte für Repositorys: „Contents“ und „Pull requests“ auf „Read-only“ (in
				der aktuellen Ansicht über „Add permissions“ bzw. das Suchfeld). „Metadata“ steht von selbst
				auf „Read-only“. Sonst nichts.
			</li>
			<li>
				„Generate token“, dann das Token (beginnt mit <code>github_pat_</code>) kopieren; GitHub
				zeigt es nur einmal.
			</li>
			<li>
				<PcOnly inline>
					Das Token als Windows-Variable setzen, Vorschlag <code>BYL_GITHUB_TOKEN</code>, und
					<code>neu-starten.bat</code> im Ordner <code>app</code> doppelklicken.
				</PcOnly>
			</li>
		</ol>
		<p>
			Der Unterschied ist die Reichweite des Tokens: Mit „All repositories“ könnte jemand, der das
			Token bekommt, alle deine Repositorys lesen, auch private und künftige; mit „Only select
			repositories“ nur die gewählten. Ändern oder schreiben kann das Token in beiden Fällen nichts.
			Repositorys einer Organisation brauchen ein eigenes Token mit der Organisation als „Resource
			owner“.
		</p>
		<h4>Repositorys und was ankommt</h4>
		<ul>
			<li>
				„Repository hinzufügen …“ (an der Karte und im Assistenten) zeigt mit Token die Liste der
				Repositorys, die das Token lesen darf: mehrere ankreuzen, mit dem Feld darüber filtern;
				schon eingetragene sind markiert. Fremde öffentliche Repositorys trägst du als
				<code>Besitzer/Name</code> oder mit der Adresse ein; ohne Token ist das der einzige Weg. Je Repository
				wählst du die Ereignisse (Dateiänderungen auf dem Standard-Branch, Pull Requests, Releases), die
				beobachteten Pfade und auf Wunsch ein eigenes Zielprojekt.
			</li>
			<li>
				„Alle meine Repositorys beobachten“ (Schalter in den Details der Karte, Standard aus,
				braucht ein Token) nimmt alle Repositorys deines Kontos mit den Standard-Einstellungen, ohne
				Forks, archivierte und die von Organisationen, höchstens 50. Neue kommen von selbst dazu,
				archivierte und gelöschte fallen weg; die Karte sagt es. Die Liste holt die App höchstens
				stündlich neu, mit ETag. Ein einzelnes passt du mit „Anpassen …“ an oder nimmst es mit
				„Ausschließen …“ heraus; die erste Erfassung bringt auch hier keine Flut, nicht einmal
				offene Pull Requests.
			</li>
			<li>
				Pfade sind Muster ab dem Hauptordner, vorbelegt <code>ROADMAP*</code>,
				<code>CHANGELOG*</code>, <code>README*</code> und <code>docs/**/roadmap*</code>;
				<code>*</code> steht für beliebige Zeichen eines Namens, <code>**</code> für beliebig viele
				Ordner. Groß- und Kleinschreibung zählt nicht. Alle Markdown-Dateien unter <code>docs</code> schaltest
				du mit einem Häkchen dazu.
			</li>
			<li>
				Ändert sich eine beobachtete Datei, kommt ein Eintrag „CHANGELOG.md in besitzer/repo
				geändert“ mit Commits, Autoren, Zeilen (+/−), Vergleichs-Link, einem kurzen Diff-Auszug und
				dem neuen Inhalt als Kopie (bis 2 MB). Neue und gelöschte Dateien kommen auch.
			</li>
			<li>
				Je Pull Request und Release kommt ein Eintrag. Der erste Abruf merkt sich nur den Stand:
				Dateien und Releases von vorher kommen nicht, offene Pull Requests schon (höchstens 20),
				geschlossene nie.
			</li>
			<li>
				Stichwörter gibt es bei GitHub nicht: Übernommen wird alles aus den gewählten Pfaden und
				Ereignissen.
			</li>
		</ul>
		<h4>Status der Quelle</h4>
		<p>
			Einträge aus GitHub zeigen im Eingang und unter „Quellen“ eines Tickets, ob ihre Quelle sich
			seitdem geändert hat: „Unverändert“, „Seit Import geändert“ oder „Nicht mehr vorhanden“ bei
			einer Datei, „PR offen“, „PR gemergt“ oder „PR geschlossen“ bei einem Pull Request. Das ist
			nur eine Anzeige: Das Ticket ändert sich dadurch nie.
		</p>
		<h4>Gut zu wissen</h4>
		<ul>
			<li>
				Die App ruft alle 15 Minuten ab (an der Karte 5 bis 60 Minuten), „Jetzt abrufen“ sofort. Sie
				fragt GitHub mit ETag; unveränderte Antworten zählen nicht gegen das Anfragelimit.
			</li>
			<li>
				Erreicht sie das Anfragelimit, wartet sie bis zur Freigabe und sagt an der Karte, ab wann
				sie wieder abruft. Das ist kein Fehler.
			</li>
			<li>
				Das Token bleibt in der Variablen auf diesem Rechner; die App schickt es nur an GitHub und
				zeigt es nirgends. Widerrufen: unter „Fine-grained tokens“ beim Token „Revoke“, dann die
				Variable löschen und die App neu starten.
			</li>
		</ul>
	</section>

	<section id="ordner" aria-labelledby="ordner-title">
		<h3 id="ordner-title">Ordner</h3>
		<p>
			Der Kanal Ordner beobachtet Ordner auf dem Rechner, auf dem die App läuft, auch Freigaben im
			Netz. Neue und geänderte Dateien kommen als Einträge in den Eingang, und zwar als
			<strong>Verweis</strong> auf die Datei, nicht als Kopie. Die App liest nur: Sie ändert,
			verschiebt und löscht keine Datei. Eingerichtet wird unter
			<a href={channelSetupHref({ kind: 'ordner', connectionId: null })}
				>Kanäle → Ordner → Einrichten</a
			>; Zugangsdaten braucht es keine.
		</p>
		<h4>Ordner eintragen</h4>
		<ul>
			<li>
				<PcOnly inline>
					Den vollständigen Pfad aus der Adressleiste des Explorers kopieren, etwa
					<code>C:\Daten\Projekte</code> oder <code>\\NAS\Projekte</code>; läuft der Server unter
					Linux, etwa <code>/home/anna/Projekte</code>. Die App prüft, ob es den Ordner gibt und ob
					sie ihn lesen darf.
				</PcOnly>
			</li>
			<li>
				Je Ordner wählst du, ob Unterordner dazugehören, welche Dateitypen zählen (Endungen wie
				<code>pdf, docx</code>; leer für alle) und welche Dateien wegfallen. Vorbelegt sind
				<code>*.tmp</code>, <code>~$*</code>, <code>.git/**</code>, <code>node_modules/**</code>,
				<code>Thumbs.db</code> und <code>desktop.ini</code>. Dazu ein eigenes Zielprojekt und ob
				Änderungen gemeldet werden.
			</li>
			<li>
				Verknüpfungen (Symlinks, Junctions) folgt die App nicht, und den Ordner der App selbst
				beobachtet sie nicht. Höchstens 10 Ordner je Verbindung.
			</li>
		</ul>
		<h4>Was ankommt</h4>
		<ul>
			<li>
				Der erste Lauf merkt sich nur den Stand: Dateien von vorher kommen nicht in den Eingang.
				Einzelne davon holst du an der Karte mit „Vorhandene Dateien übernehmen …“.
			</li>
			<li>
				Danach kommt je neue Datei ein Eintrag „Neue Datei: …“ mit Name, Pfad, Größe, Zeit und Typ.
				Ändert sich eine beobachtete Datei, kommt „Datei geändert: …“, für denselben Stand nur
				einmal; das lässt sich je Ordner abschalten.
			</li>
			<li>
				Stichwörter gibt es bei Ordnern nicht: Übernommen wird, was Dateitypen und Ausschlüsse
				treffen.
			</li>
		</ul>
		<h4>Ansehen und Status</h4>
		<ul>
			<li>
				„Ansehen“ an einem Eintrag öffnet die aktuelle Fassung der Datei: PDF, Bilder und Text im
				Browser, alles andere als Download. Das geht nur im Browser auf diesem Rechner, nur für dich
				und nur für Dateien in den eingetragenen Ordnern. Ist die Datei nicht mehr da, sagt der
				Eintrag es.
			</li>
			<li>
				Die Statusanzeige zeigt „Unverändert“, „Seit Import geändert“, „Nicht mehr vorhanden“ oder
				„Verschoben“ (eine umbenannte oder verschobene Datei erkennt die App am gleichen Inhalt).
				Das ist nur eine Anzeige: Das Ticket ändert sich dadurch nie.
			</li>
		</ul>
		<h4>Gut zu wissen</h4>
		<ul>
			<li>
				Die App prüft alle 5 Minuten (an der Karte 1 bis 60 Minuten), „Jetzt prüfen“ sofort. Sie
				vergleicht Größe und Änderungszeit und berechnet bei einer Änderung eine Prüfsumme, für
				Dateien bis 200 MB.
			</li>
			<li>
				Je Ordner beobachtet sie höchstens 2.000 Dateien und legt je Lauf höchstens 100 neue
				Einträge an; der Rest folgt beim nächsten Lauf. Die Karte sagt, wenn eine Grenze erreicht
				ist.
			</li>
			<li>
				Ist ein Ordner nicht erreichbar (etwa ein getrenntes Netzlaufwerk), sagt die Karte es; die
				bisherigen Einträge bleiben, bis er wieder da ist.
			</li>
			<li>
				Gespeichert werden nur Name, Pfad, Größe, Zeit, Typ und Prüfsumme einer Datei, nie ihr
				Inhalt; auch das Protokoll enthält keine Pfade.
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
						Postfächer ruft der Hilfsprozess alle 5 Minuten ab.
						<PcOnly need="script" inline>
							Er heißt <code>byl-mail.exe</code> und startet mit <code>start.bat</code>, sobald eine
							eingeschaltete Postfach-Verbindung besteht; sein Protokoll steht in
							<code>app\logs\byl-mail.log</code>.
						</PcOnly>
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
					{RESTART_NEEDED.text}
					<PcOnly need="script" inline quiet>
						Läuft die App, öffnet <code>start.bat</code> allein nur den Browser;
						<code>neu-starten.bat</code> startet den Server neu, wenn ein Update es braucht.
					</PcOnly>
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
				<summary>Wie wirken die Karten über der Liste?</summary>
				<ul>
					<li>
						„In Arbeit“, „Heute fällig“, „Überfällig“ und „Dringend“ sind Schalter: Ein Klick wählt
						eine Karte, ein zweiter wählt sie wieder ab. Du kannst mehrere wählen; die Liste zeigt
						dann jedes Ticket, das zu mindestens einer gewählten Karte passt, und zwar nur einmal.
						„Heute fällig“ und „Überfällig“ zusammen zeigen also alles, was heute oder früher fällig
						ist.
					</li>
					<li>
						„Alle offenen“ ist gewählt, solange keine andere Karte gewählt ist. Ein Klick darauf
						hebt die anderen Karten auf.
					</li>
					<li>
						Die Filter der Filterleiste und die Suche schränken die gewählten Karten weiter ein.
						Jede Karte zählt die offenen Tickets, die zu diesen Filtern passen, unabhängig von den
						anderen Karten.
					</li>
					<li>
						Über der Liste steht, woraus sie besteht, etwa „12 Tickets aus: In Arbeit, Heute fällig,
						Dringend“. „Zurücksetzen“ dort oder in der Filterleiste setzt Karten, Filter und Suche
						zurück; Sortierung, Gruppierung und „Erledigte anzeigen“ bleiben. Mit „Erledigte
						anzeigen“ gelten die Karten auch für den Abschnitt „Erledigt“; ein erledigtes Ticket ist
						nie „In Arbeit“ oder „Überfällig“.
					</li>
					<li>
						Die Auswahl steht in der Adresse (<code>?karte=heute&amp;karte=dringend</code>) und
						bleibt beim Neuladen, mit Zurück und in Lesezeichen erhalten. Ältere Lesezeichen mit
						Status, Priorität oder Fälligkeit zeigen dieselben Tickets wie vorher; diese Werte
						stehen dann als Filter in der Filterleiste.
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
					nach dem Löschen geht das auch mit „Rückgängig“ unten links. Nach dem Wiederherstellen bleibst
					du im Papierkorb, und die Meldung unten links bietet „Öffnen“. Nach 30 Tagen löscht die App
					es endgültig; die Frist stellst du unter „Einstellungen → Tickets“ ein.
				</p>
			</details>
			<details>
				<summary>Warum lässt sich ein Ticket im Papierkorb nicht endgültig löschen?</summary>
				<p>
					Endgültig gelöscht wird nur, was nicht mehr gebraucht wird: das Ticket und seine
					Unteraufgaben sind erledigt, und keine Quelle hängt mehr daran. Sonst steht in der Zeile
					„Blockiert“, und auch die Aufbewahrung löscht es nicht. In der Vorschau unter
					„Abhängigkeiten“ entscheidest du: offene Tickets als erledigt markieren oder
					wiederherstellen, eine Unteraufgabe auch als eigenes Ticket, Quellen zurück in den
					Eingang, verwerfen oder einem anderen Ticket zuordnen (die Hauptquelle bleibt bei ihrem
					Ticket). Danach geht „Endgültig löschen …“.
				</p>
			</details>
			<details>
				<summary>Wo öffnet sich ein Ticket?</summary>
				<ul>
					<li>
						Dort, wo du es anklickst: in „Aufgaben“ neben der Liste, im Kalender, unter „Projekte“,
						im Eingang und unter „Wiederholungen“ jeweils neben der Ansicht, im Seitenpanel oder in
						der Vollansicht, so wie du Tickets zuletzt geöffnet hast.
					</li>
					<li>
						Ist dort gerade ein Projekt, ein Eintrag oder eine Regel offen, nimmt das Ticket dessen
						Platz ein, auch im Kalender. Das Schließen (× oder <kbd>Esc</kbd>) führt genau dorthin
						zurück, sonst zur Ansicht. Auch die Vollansicht bleibt an diesem Ort. Der Fokus steht
						danach wieder auf dem Link, mit dem du das Ticket geöffnet hast.
					</li>
					<li>
						„Ticket ansehen“ nach der Schnellerfassung öffnet das neue Ticket in der Ansicht, in der
						du gerade bist; aus den Einstellungen und dem Papierkorb in „Aufgaben“.
					</li>
					<li>
						Hast du im Panel eines Projekts oder einer Regel etwas geändert und nicht gespeichert,
						fragt es vorher oben im Panel „Änderungen verwerfen?“.
					</li>
					<li>
						Links auf Tickets in Beschreibungen und Kommentaren (auch „Kopiert aus HAUS-12“) öffnen
						ebenfalls dort, wo der Text steht. Mit <kbd>Strg</kbd>, <kbd>Umschalt</kbd> oder der mittleren
						Maustaste öffnen sie wie jeder Link einen neuen Tab.
					</li>
					<li>
						Der Pfad „Haus › Garten“ oben im Ticket öffnet das Projekt. Bewusst nach „Aufgaben“
						führen „Link kopieren“ (die Adresse taugt für jeden Tab), „Alle 12 in Aufgaben öffnen“,
						„Tickets anzeigen“, der Name der App und „Neues Ticket“.
					</li>
				</ul>
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
						„Aufgaben“ mit dem Projekt als Filter. Ein Klick auf ein Ticket öffnet es hier unter
						„Projekte“, wie du Tickets zuletzt geöffnet hast (Panel oder Vollansicht); aus dem Panel
						eines Projekts nimmt es dessen Platz ein, und das Schließen führt zum Projekt zurück.
						„•••“ und der Rechtsklick bieten dasselbe Menü wie in „Aufgaben“. Bearbeitet wird im
						Ticket oder in „Aufgaben“.
					</li>
					<li>
						„Alle aufklappen“ und „Alle zuklappen“ über der Liste öffnen bzw. schließen alle Zeilen.
						Welche Zeilen offen sind, merkt sich dieser Browser. Das Panel eines Projekts zeigt
						dieselbe Liste unter „Offene Tickets“, die Kacheln zählen sie als „aktiv“.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie färbe ich Projekte und Tickets?</summary>
				<ul>
					<li>
						Im Panel eines Projekts wählst du unter „Farbe“ eine der zehn Farben (Violett, Indigo,
						Blau, Himmelblau, Türkis, Grün, Oliv, Senf, Braun, Grau) und speicherst. Alle Tickets
						des Projekts zeigen sie; ein Unterprojekt ohne eigene Farbe zeigt die seines
						Oberprojekts („Wie Oberprojekt“).
					</li>
					<li>
						Ein Ticket hat standardmäßig „Wie Projekt“. Unter „Farbe“ im Ticket, in „Neues Ticket“
						oder mit „Farbe“ in der Leiste mehrerer gewählter Tickets gibst du ihm eine eigene, die
						vorgeht. Eine Wiederholung gibt ihre Farbe den nächsten Tickets, „Duplizieren …“ nimmt
						sie mit; jede Änderung steht im Verlauf.
					</li>
					<li>
						Die Farbe ist ein Zusatz: ein Streifen am Anfang der Zeile in „Aufgaben“, ein Punkt vor
						dem Namen in Projekten, Listen und im Kopf eines Tickets. Ihr Name steht beim Zeigen mit
						der Maus und für Screenreader immer dabei. Rot gibt es nicht, es bleibt für Fehler.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie setze ich einen Charm?</summary>
				<ul>
					<li>
						Ein Charm ist ein kleines Symbol vor dem Titel, wie im Outlook-Kalender: eine Torte für
						einen Geburtstag, ein Flugzeug für eine Reise, eine Hantel fürs Training. Jedes Ticket
						und jede Wiederholung kann einen haben, keiner ist Pflicht.
					</li>
					<li>
						Im Ticket, in „Neues Ticket“ und in der Vorlage einer Wiederholung öffnet „Charm wählen“
						die Auswahl: oben die Suche (etwa „Müll“ oder „Reise“), darunter „Kein Charm“ und die
						Charms in den Gruppen Alltag, Haushalt, Gesundheit, Familie, Arbeit, Reise, Finanzen und
						Freizeit. Mit den Pfeiltasten wanderst du durch die Symbole, <kbd>Enter</kbd> wählt,
						<kbd>Esc</kbd> schließt ohne Änderung. Im Ticket gilt die Wahl sofort.
					</li>
					<li>
						Eine Wiederholung gibt ihren Charm jedem neuen Ticket beim Anlegen; änderst du ihn,
						bekommen ihn erst die nächsten Tickets. „Duplizieren …“ nimmt den Charm mit, beim
						Verschieben in einen anderen Bereich bleibt er. Unteraufgaben bekommen keinen.
					</li>
					<li>
						Der Charm steht vor dem Titel in „Aufgaben“, im Kalender, unter den offenen Tickets
						eines Projekts, im Ticket und in „Wiederholungen“, in der Farbe des Textes. Sein Name
						steht beim Zeigen mit der Maus und für Screenreader dabei. „Kein Charm“ entfernt ihn
						wieder.
					</li>
				</ul>
			</details>
			<details>
				<summary>Wie hefte ich ein Ticket an?</summary>
				<ul>
					<li>
						Mit dem Knopf „Anheften“ (eine Nadel) am Ende des Titels in „Aufgaben“, bei den offenen
						Tickets eines Projekts und im Kopf eines Tickets heftest du es an; ein zweiter Klick
						(„Lösen“) löst es wieder. Am PC erscheint die Nadel beim Zeigen auf die Zeile und mit
						der Tastatur, am Handy steht sie immer da, bei angehefteten Tickets immer und
						ausgefüllt.
					</li>
					<li>
						Angeheftete Tickets stehen in „Aufgaben“ ganz oben im Abschnitt „Angeheftet“, das zuerst
						angeheftete zuoberst, auch wenn die Filter sie sonst ausblenden würden, und nicht noch
						einmal in der Liste darunter; die Zahl neben „Aufgaben“ nennt sie als „+ 2 angeheftet“.
						Der Abschnitt lässt sich zuklappen, das merkt sich dieses Gerät. Unter „Projekte“ stehen
						die angehefteten Tickets eines Projekts zuerst.
					</li>
					<li>
						Deine Pins siehst nur du, auch im Haushalt; jedes Mitglied heftet für sich an. Du siehst
						die angehefteten Tickets des Bereichs, in dem du gerade bist.
					</li>
					<li>
						Wird ein Ticket erledigt oder kommt es in den Papierkorb, ist es für alle gelöst;
						Wiedereröffnen oder Wiederherstellen heftet es nicht neu an. Wer den Haushalt verlässt,
						verliert seine Pins auf dessen Tickets.
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
		<PcOnly need="script" member={CONTEXT_TEXTS.operations}>
			{@render operations()}
		</PcOnly>
	</section>

	{#snippet operations()}
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
					auf dem Rechner der App und nur mit einem Konto, das Verwalter der App ist (zu Beginn das
					zuerst angelegte, siehe <a href={helpHref('konten')}>Konten und Verwalter</a>). Beenden
					geht weiter nur mit
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
				<dt>Im Heimnetz</dt>
				<dd>
					Andere Geräte im Heimnetz erreichen die App nur, wenn du es unter
					<a href={resolve('/einstellungen/sicherheit')}>Einstellungen → Sicherheit</a> einschaltest
					(<a href="#heimnetz">Schritt für Schritt</a>). <code>status.bat</code> und
					<code>byl-control.ps1 doctor</code> nennen dann die Adresse für andere Geräte, die
					Firewall-Regel und das Netzwerkprofil; im Ordner <code>app</code> gibt es dafür auch
					<code>byl-control.ps1 lan-info</code>, <code>lan-configure</code> und
					<code>lan-firewall</code>.
					<code>start.bat</code>, die Startseite und die Browser-Erweiterung bleiben auf
					<code>127.0.0.1</code>.
				</dd>
			</div>
			<div class="row">
				<dt>Wenn es hakt</dt>
				<dd>
					Jedes Skript sagt bei einem Problem, was passiert ist, die wahrscheinliche Ursache und die
					Schritte, die helfen, mit einem Befehl zum Kopieren; das Fenster bleibt dann offen. Ist es
					sicher, bietet es an, das Problem selbst zu lösen („Soll ich …? (J/N)“). Scheitert ein
					Lauf ohne Fenster (Autostart, Neustart oder Wiederherstellung aus der App), zeigt das
					nächste Skript im Fenster das Problem einmal; läuft die App, steht es auch unter
					Einstellungen → System. Die Prüfung <code>byl-control.ps1 doctor</code> zeigt fehlende Dateien,
					Schreibrechte, Plattenplatz und andere laufende Kopien. Die häufigsten Probleme stehen unten.
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
					Die App ist der Ordner <code>app</code>: Kopieren sichert und zieht sie um, aber erst nach
					<code>stop.bat</code> – während die App läuft, schreibt sie in ihre Datenbank, und eine
					Kopie wäre halb fertig. Automatisch sichert die App einmal am Tag in
					<code>app\pb_data\backups</code> und, wenn eingerichtet, verschlüsselt in ein
					Zielverzeichnis auf einem anderen Laufwerk; mehr unter
					<a href="#sicherung">Sicherung & Notfall</a>.
				</dd>
			</div>
		</dl>
		<h4 id="betrieb-probleme">Probleme mit den Skripten</h4>
		<ScriptProblemsHelp origin={page.url.origin} port={page.url.port || '8090'} />
	{/snippet}

	<section id="sicherung" aria-labelledby="sicherung-title">
		<h3 id="sicherung-title">Sicherung & Notfall</h3>
		{#if mode === 'member'}
			<SectionMessage tone="info" compact>{CONTEXT_TEXTS.operations}</SectionMessage>
		{:else if mode !== 'pending'}
			<p>
				Die App sichert einmal am Tag in <code>app\pb_data\backups</code> und, mit Zielverzeichnis
				und Passphrase, verschlüsselt auf ein anderes Laufwerk; einmal in der Woche prüft sie die
				neueste Sicherung. Alles dazu unter
				<a href={resolve('/einstellungen/sicherung')}>Einstellungen → Sicherung</a>.
			</p>
			<h4>Einrichten</h4>
			<ol>
				<li>
					Ein Zielverzeichnis auf einem anderen Laufwerk angeben: USB-Platte, NAS-Freigabe oder ein
					Ordner, den ein Cloud-Dienst synchronisiert.
				</li>
				<li>
					Eine Passphrase festlegen. Bewahre die Passphrase in deinem Passwort-Manager auf – ohne
					sie lässt sich die Sicherung nicht öffnen.
				</li>
				<li>„Jetzt sichern“, danach „Jetzt prüfen“.</li>
				<li>
					Die <a href={resolve('/notfallkarte')}>Notfallkarte</a> drucken und neben die USB-Platte legen.
				</li>
			</ol>
			<PcOnly need="script">
				<h4>Wiederherstellen</h4>
				<p>
					An einer Sicherung „Wiederherstellen …“ oder <code>app\wiederherstellen.bat</code>. Die
					App prüft die Sicherung zuerst, fragt nach den Zugangsdaten und dem Wort WIEDERHERSTELLEN,
					legt die jetzigen Daten sieben Tage als Sicherheitskopie in den Ordner
					<code>app</code> und geht zurück, wenn sie mit der Sicherung nicht startet.
				</p>
				<h4>Neuer Rechner, Schritt für Schritt</h4>
				<ol>
					{#each EMERGENCY_STEPS as step (step.title)}
						<li><strong>{step.title}:</strong> {step.text}</li>
					{/each}
				</ol>
				<h4>Ohne die App öffnen</h4>
				<p>
					Mit dem Programm age (age-encryption.org) und tar von Windows, in einer
					Eingabeaufforderung:
				</p>
				<CodeBlock code={EMERGENCY_MANUAL.join('\n')} label="Sicherung ohne die App öffnen" />
				<p>{EMERGENCY_CONTENTS}</p>
				<h4>Was verloren gehen kann</h4>
				<ul>
					{#each EMERGENCY_LOSSES as loss (loss)}
						<li>{loss}</li>
					{/each}
				</ul>
			</PcOnly>
		{/if}
	</section>

	<section id="speicher" aria-labelledby="speicher-title">
		<h3 id="speicher-title">Speicher</h3>
		<p>
			Unter <a href={resolve('/einstellungen/speicher')}>Einstellungen → Speicher</a> siehst du, was die
			App belegt, gemessen in dem Moment, in dem du die Seite öffnest oder „Neu messen“ wählst: die Datenbank
			mit ihrem freien Teil, die Originaldateien des Eingangs danach, wozu sie gehören (neu, an offenen
			oder erledigten Tickets, verworfen, im Papierkorb), die größten Einträge mit ihrem Ticket, die Sicherungen
			hier und im Zielverzeichnis, Sicherheitskopien, Logs, Programmdateien und den freien Platz.
		</p>
		<h4>Aufräumen</h4>
		<ul>
			<li>
				<strong>Datenbank verdichten</strong> gibt freien Platz in der Datenbank an das Laufwerk zurück;
				die App wartet dabei kurz.
			</li>
			<li>
				<strong>Liegengebliebenes aufräumen</strong> löscht Programmreste nach Updates und Sicherheitskopien,
				die älter als sieben Tage sind, und auf Wunsch die alten automatischen Sicherungen von PocketBase.
				Die Sicherungen der App bleiben.
			</li>
			<li>
				<strong>Verworfene jetzt leeren</strong> leert Text und Originaldatei verworfener Einträge sofort
				statt nach 30 Tagen; der Eintrag bleibt als Sperre, damit dieselbe Mail nicht noch einmal hereinkommt.
				Quellen, die noch an Tickets im Papierkorb hängen, sind nicht dabei; über sie entscheidest du
				im Papierkorb.
			</li>
		</ul>
		<p>
			Originaldateien an Quellen löscht die Seite nicht einzeln: Sie belegen, woher ein Ticket
			kommt. Tickets und ihre Daten gehen über den <a href={trashHref()}>Papierkorb</a>, und
			endgültig nur, wenn nichts mehr offen ist (siehe „Warum lässt sich ein Ticket im Papierkorb
			nicht endgültig löschen?“).
		</p>
		<p>
			Programmdateien, Sicherheitskopien, Logs und den freien Platz zeigt die Seite nur, wenn die
			App unter Windows aus ihrem Ordner <code>app</code> läuft; auf anderen Servern den Rest.
		</p>
	</section>

	<section id="sicherheit" aria-labelledby="sicherheit-title">
		<h3 id="sicherheit-title">Sicherheit</h3>
		<p>
			becauseyoulovejira ist standardmäßig nur auf diesem Rechner erreichbar. Jede Webseite, die du
			im Browser öffnest, kann aber Anfragen an diesen Rechner schicken. Deshalb schützt sich die
			App selbst; unter <a href={resolve('/einstellungen/sicherheit')}>Einstellungen → Sicherheit</a
			> siehst du, was aktiv ist, und stellst ein, was sinnvoll ist.
		</p>
		<ul>
			<li>
				<strong>Schutz vor Rateversuchen:</strong> Höchstens 10 Anmeldeversuche je Minute („Streng“: 5
				je 5 Minuten), für App- und Admin-Konto getrennt. Danach meldet die Anmeldung „Zu viele Anmeldeversuche“;
				nach spätestens einer Minute (bzw. fünf) geht es wieder. Was du angemeldet tust, zählt nie.
			</li>
			<li>
				<strong>Nur die eigenen Adressen:</strong> Die App antwortet nur unter 127.0.0.1 und localhost
				mit ihrem Port, und nur sie selbst darf Antworten lesen. Die Browser-Erweiterung, der eigene Eingang
				per Skript, das Bookmarklet und der Mail-Helfer funktionieren wie gewohnt.
			</li>
			<li>
				<strong>Verwaltung (/_/):</strong> Admin-Anfragen gelten nur von diesem Rechner.
			</li>
			<li>
				<strong>Fehlgeschlagene Anmeldungen</strong> der letzten 30 Tage stehen auf der Seite, ohne Passwort.
				Gibt es in 24 Stunden zehn oder mehr, zeigt die App beim Öffnen einen Hinweis.
			</li>
			<li>
				<strong>Zusätzliche Adressen</strong> brauchst du nur, wenn die App später von anderen Geräten
				erreichbar sein soll, etwa über Tailscale; sie gelten nur über HTTPS und erst nach einem Neustart.
			</li>
			<li>
				<strong>Zugriff im Heimnetz</strong> (standardmäßig aus) öffnet die App für andere Geräte in deinem
				Heimnetz, unverschlüsselt über HTTP; Einzelheiten unten.
			</li>
		</ul>
		<p>
			Das Passwort deines App-Kontos änderst du unter
			<a href={resolve('/einstellungen/konto')}>Mein Konto</a>, ein vergessenes setzt der Verwalter
			der App unter <a href={resolve('/einstellungen/konten')}>Konten verwalten</a> zurück.
			<PcOnly need="script" inline quiet>
				Ein vergessenes Admin-Passwort setzt <code>admin-zuruecksetzen.bat</code> im Ordner
				<code>app</code> neu, ohne Daten zu löschen.
			</PcOnly>
		</p>
		<h4 id="heimnetz">Zugriff im Heimnetz</h4>
		<p>
			So öffnet eine zweite Person die App auf ihrem eigenen Gerät, etwa dem Handy im WLAN, mit
			ihrem eigenen Konto. Die App läuft weiter auf diesem Rechner; andere Geräte erreichen sie
			unter seiner Adresse im Heimnetz, etwa <code>http://192.168.178.20:8090</code>.
		</p>
		<p>
			<strong>Unverschlüsselt:</strong> Im Heimnetz geht alles über HTTP ohne Verschlüsselung, auch Passwörter.
			Schalte den Zugriff nur in deinem eigenen, vertrauenswürdigen Heimnetz ein, nie in fremden Netzen.
			Verschlüsselt (HTTPS) folgt mit dem Umzug auf den Raspberry Pi.
		</p>
		<ol>
			<li>
				Netzwerk als „Privat“ einstufen, nur im eigenen Heimnetz: Windows-Einstellungen → Netzwerk
				und Internet → Status → „Eigenschaften“ bei der Verbindung (WLAN: Netzwerk und Internet →
				WLAN → das Netzwerk) → Netzwerkprofil „Privat“. Die Firewall-Regel gilt nur in privaten
				Netzwerken.
			</li>
			<li>
				Unter <a href={resolve('/einstellungen/sicherheit')}>Einstellungen → Sicherheit</a> den Zugriff
				im Heimnetz einschalten, die Adresse dieses Rechners wählen und „Einstellung speichern“.
			</li>
			<li>
				„Firewall-Regel anlegen …“ wählen und die Frage von Windows nach Administratorrechten
				bestätigen; erscheint kein Fenster, blinkt sie als Schild-Symbol in der Taskleiste. Die
				Regel lässt nur diese App, nur ihren Port und nur in privaten Netzwerken durch. Danach prüft
				die Seite die Regel und meldet Erfolg nur, wenn sie wirklich besteht. Kann Windows nicht
				fragen oder lehnt die Firewall ab, nennt die Seite den Grund und den Befehl für eine
				Eingabeaufforderung als Administrator.
			</li>
			<li>
				Die App neu starten: unter <a href={resolve('/einstellungen/system')}
					>Einstellungen → System</a
				>
				„Jetzt neu starten“<PcOnly need="script" inline quiet>
					oder <code>neu-starten.bat</code></PcOnly
				>. Erscheint danach die Windows-Sicherheitswarnung für pocketbase.exe, nur „Private
				Netzwerke“ anhaken.
			</li>
			<li>
				Auf dem anderen Gerät im selben WLAN die „Adresse für andere Geräte“ der Seite Sicherheit im
				Browser öffnen und mit dem eigenen Konto anmelden. Als App installieren lässt sich die Seite
				über HTTP nicht; ein Lesezeichen oder eine Verknüpfung auf dem Startbildschirm geht.
			</li>
			<li>
				In der FRITZ!Box eine feste Adresse reservieren: Heimnetz → Netzwerk → Netzwerkverbindungen
				→ beim Rechner „Bearbeiten“ → „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse
				zuweisen“. Sonst kann sich die Adresse ändern, und andere Geräte erreichen die App nicht
				mehr.
			</li>
		</ol>
		<p>
			Auch mit Zugriff im Heimnetz bleiben die Seiten der Verwaltung (Konten verwalten, Sicherheit,
			Sicherung, Speicher und System), das Ansehen von Dateien aus beobachteten Ordnern und die
			Verwaltung (/_/) nur auf diesem Rechner unter <code>127.0.0.1</code>, auch für den Verwalter.
			Jedes andere Konto meldet sich auf seinem Gerät an und ändert sein Passwort dort unter „Mein
			Konto“. Jedes Gerät hat seine eigene Zählung beim Schutz vor Rateversuchen. Ausschalten: den
			Schalter aus, „Einstellung speichern“, neu starten und die Firewall-Regel mit „Firewall-Regel
			entfernen …“ wieder entfernen.
		</p>
	</section>

	<section id="konten" aria-labelledby="konten-title">
		<h3 id="konten-title">Konten und Verwalter</h3>
		<p>
			Jede Person meldet sich mit ihrem eigenen Konto an. Tickets, Projekte, Tags und Verbindungen
			gehören dem Konto, das sie angelegt hat; die anderen Konten sehen sie nicht. Was ihr teilen
			wollt, gehört in einen <a href={helpHref('haushalt')}>Haushalt</a>.
		</p>
		<dl class="tokens">
			<div class="row">
				<dt>Verwalter der App</dt>
				<dd>
					Ein Recht für Konten: Wer es hat, legt Konten an, setzt Passwörter zurück, deaktiviert und
					aktiviert Konten und gibt oder entzieht das Recht. Nur er sieht die Gruppe „Verwaltung“
					mit Konten verwalten, Sicherheit, Sicherung, Speicher und System und richtet Kanäle mit
					Zugangsdaten oder Ordnern dieses Rechners ein. Zu Beginn hat es das zuerst angelegte
					Konto. Mindestens ein aktives Konto bleibt immer Verwalter; dein eigenes Recht kann dir
					nur ein anderer Verwalter entziehen.
				</dd>
			</div>
			<div class="row">
				<dt>Konto anlegen</dt>
				<dd>
					Unter <a href={resolve('/einstellungen/konten')}>Einstellungen → Konten verwalten</a> Name
					und E-Mail-Adresse eingeben, „Konto anlegen“. Die App erzeugt ein Startpasswort und zeigt
					es einmal an, mit „Kopieren“. Gib es auf einem sicheren Weg weiter; die Person ändert es
					danach unter <a href={resolve('/einstellungen/konto')}>Einstellungen → Mein Konto</a>.
					Eine Mail verschickt die App nicht.
				</dd>
			</div>
			<div class="row">
				<dt>Passwort vergessen</dt>
				<dd>
					Der Verwalter wählt am Konto „Passwort zurücksetzen …“ und gibt das neue Passwort weiter;
					alle Anmeldungen des Kontos enden sofort. Hat der einzige Verwalter sein Passwort
					vergessen, hilft die Verwaltung von PocketBase mit dem Admin-Konto (Collections → users).
				</dd>
			</div>
			<div class="row">
				<dt>Deaktivieren</dt>
				<dd>
					Das Konto kann sich nicht mehr anmelden, offene Anmeldungen enden. Tickets, Kommentare und
					Verlauf bleiben; „Aktivieren“ macht es rückgängig. Löschen lassen sich Konten hier nicht.
					Ist das Konto Inhaber eines Haushalts, sagt die Frage das vorher.
				</dd>
			</div>
			<div class="row">
				<dt>Haushalt ohne aktiven Inhaber</dt>
				<dd>
					Ist der Inhaber eines Haushalts deaktiviert oder in der Verwaltung gelöscht, steht der
					Haushalt unter „Haushalte ohne aktiven Inhaber“. Der Verwalter wählt dort ein aktives
					Mitglied und „Zum Inhaber machen …“; der bisherige Inhaber bleibt Mitglied mit allen
					Rechten. Hat kein Mitglied mehr ein Konto, bleibt nur „Haushalt löschen …“: Nach der
					Vorschau und mit dem eingetippten Namen löscht der Verwalter alles des Haushalts
					endgültig. Übernehmen kann er nichts davon.
				</dd>
			</div>
			<div class="row">
				<dt>Was andere sehen</dt>
				<dd>
					Den Namen eines Kontos sehen die Mitglieder desselben Haushalts und der Verwalter, etwa in
					Kommentaren, im Verlauf und im Papierkorb; sonst steht dort „Anderes Konto“. Die
					E-Mail-Adresse sieht nur der Verwalter.
				</dd>
			</div>
			<div class="row">
				<dt>Kanäle für jedes Konto</dt>
				<dd>
					Schnellerfassung, Zwischenablage, Bookmarklet, Datei-Importe (Mail- und Kalenderdateien,
					WhatsApp-Exporte, Proton per Datei) und der eigene Eingang mit eigenem Zugangsschlüssel,
					auch für WhatsApp Web. Google Calendar, Telegram, Postfächer, Notion, GitHub und Ordner
					richtet nur der Verwalter ein, weil sie Zugangsdaten oder Ordner dieses Rechners lesen.
				</dd>
			</div>
			<div class="row">
				<dt>Zweite Person am selben Rechner</dt>
				<dd>
					Die Anmeldung gilt je Browserprofil. Die zweite Person nutzt ein eigenes Profil (Chrome
					und Edge: Profil hinzufügen; Firefox: <code>about:profiles</code>) und meldet sich dort
					mit ihrem Konto an. Die Seiten des Verwalters gehen nur im Browser auf diesem Rechner.
				</dd>
			</div>
		</dl>
	</section>

	<section id="haushalt" aria-labelledby="haushalt-title">
		<h3 id="haushalt-title">Haushalt</h3>
		<p>
			Ein Haushalt ist ein gemeinsamer Bereich für mehrere Konten: Was im Haushalt liegt, sehen und
			bearbeiten alle Mitglieder; Privates sieht weiter nur sein Konto. Ein Konto kann vorerst in
			einem Haushalt sein. Mitglieder, Codes und Rechte verwaltest du unter
			<a href={resolve('/einstellungen/haushalt')}>Einstellungen → Haushalt</a>, auf jedem Gerät,
			auch am Handy im Heimnetz. Zwischen deinen privaten Einträgen und denen des Haushalts
			wechselst du oben mit dem Umschalter (siehe
			<a href="#bereiche">Bereiche Privat und Haushalt</a>).
		</p>
		<dl class="tokens">
			<div class="row">
				<dt>Gründen</dt>
				<dd>
					Namen eingeben und „Haushalt gründen“. Du wirst Inhaber und hast alle Rechte des
					Haushalts.
				</dd>
			</div>
			<div class="row">
				<dt>Einladen und beitreten</dt>
				<dd>
					„Neuen Code erzeugen“ zeigt einen Code wie <code>ABCD-EFGH</code> einmal an, mit „Kopieren“.
					Er gilt 7 Tage und für eine Person; gespeichert wird nur ein Prüfwert, nicht der Code. Gib ihn
					auf einem sicheren Weg weiter. Die andere Person meldet sich mit ihrem eigenen Konto an und
					gibt ihn unter „Mit Code beitreten“ ein; Groß- und Kleinschreibung und Bindestrich sind egal.
					Ist ein Code falsch, abgelaufen, benutzt oder widerrufen, heißt es immer „Code ungültig oder
					abgelaufen.“ Nach fünf Versuchen in fünf Minuten wartet die App kurz. Offene Codes lassen sich
					jederzeit widerrufen.
				</dd>
			</div>
			<div class="row">
				<dt>Rechte</dt>
				<dd>
					Neue Mitglieder nutzen den Haushalt ganz normal, haben aber keine Sonderrechte: Einladen,
					Mitglieder entfernen, Rechte weitergeben, Umbenennen, Endgültig löschen (im Papierkorb des
					Haushalts, dazu seine Aufbewahrung) und Ins Private verschieben (Einträge anderer
					Mitglieder; eigene darf jedes Mitglied, siehe <a href="#bereiche">Verschieben</a>). Wer
					„Rechte weitergeben“ hat, kann anderen Mitgliedern nur Rechte geben oder nehmen, die er
					selbst hat; nie sich selbst und nie dem Inhaber.
				</dd>
			</div>
			<div class="row">
				<dt>Inhaber übertragen</dt>
				<dd>
					Nur der Inhaber macht ein anderes Mitglied zum Inhaber. Er selbst bleibt Mitglied und
					behält alle Rechte.
				</dd>
			</div>
			<div class="row">
				<dt>Entfernen und austreten</dt>
				<dd>
					Wer „Mitglieder entfernen“ hat, entfernt andere Mitglieder, nie den Inhaber. Jedes
					Mitglied außer dem Inhaber kann selbst austreten. In beiden Fällen bleiben die Einträge im
					Haushalt, auch die selbst angelegten, und der Zugriff darauf endet sofort, auch in offenen
					Tabs: Sie wechseln ohne Neuladen in den Bereich Privat, und was du gerade tippst, bleibt
					stehen. Der Inhaber überträgt zuerst die Inhaberschaft oder löst den Haushalt auf.
				</dd>
			</div>
			<div class="row">
				<dt>Auflösen</dt>
				<dd>
					Nur der Inhaber: „Haushalt auflösen …“ zeigt vorher, was der Haushalt enthält und wer
					Mitglied ist. „Alles in meinen privaten Bereich übernehmen“ holt Tickets, Projekte,
					Wiederholungen, Einträge und den Papierkorb zu dir, mit neuen Nummern (die alten stehen im
					Verlauf); ein Projektkürzel, das du schon hast, bekommt ein Suffix wie <code>HAUSH</code>.
					„Alles endgültig löschen“ geht erst, wenn du den Namen des Haushalts eintippst, und lässt
					sich nicht rückgängig machen. Danach gibt es den Haushalt nicht mehr; alle Mitglieder sind
					ohne Neuladen im Bereich Privat und sehen einen Hinweis.
				</dd>
			</div>
		</dl>
	</section>

	<section id="bereiche" aria-labelledby="bereiche-title">
		<h3 id="bereiche-title">Bereiche Privat und Haushalt</h3>
		<p>
			Bist du Mitglied eines Haushalts, steht oben der Umschalter „Privat | Name des Haushalts“. Er
			wechselt wie zwischen zwei Schreibtischen: Jede Liste, jede Zahl, die Suche, der Kalender, der
			Eingang, der Papierkorb und jede Auswahl zeigen nur den gewählten Bereich. Im Haushalt
			markiert zusätzlich eine Linie am oberen Rand den Bereich. Ohne Haushalt gibt es keinen
			Umschalter, und alles bleibt, wie es war: Oben steht nur „Privat“ und daneben ein kleines „+“.
			Es führt zu <a href={resolve('/einstellungen/haushalt')}>Einstellungen → Haushalt</a>, wo du
			einen Haushalt gründest oder mit einem Code beitrittst; danach steht dort der Umschalter, ohne
			Neuladen.
		</p>
		<dl class="tokens">
			<div class="row">
				<dt>Wechseln</dt>
				<dd>
					Ein Klick genügt, ohne Neuladen. Die Wahl merkt sich dieses Gerät für dein Konto; am Handy
					kann ein anderer Bereich gewählt sein als am PC. Offene Tickets, Projekte oder Filter des
					alten Bereichs schließen sich dabei; ungespeicherter Text fragt vorher nach.
				</dd>
			</div>
			<div class="row">
				<dt>Anlegen</dt>
				<dd>
					Was du anlegst, landet im gewählten Bereich: Tickets, Schnellerfassung, Projekte, Tags,
					Wiederholungen und Einträge im Eingang. Kommentare und Verlauf gehören zu ihrem Ticket,
					Unteraufgaben zum übergeordneten Ticket, Tickets einer Wiederholung zu deren Bereich, und
					ein Duplikat bleibt im Bereich des Originals.
				</dd>
			</div>
			<div class="row">
				<dt>Keine Verweise über Bereichsgrenzen</dt>
				<dd>
					Projekt, Tags, übergeordnetes Ticket, Abhängigkeiten, die Wiederholung eines Tickets und
					das Zielprojekt einer Verbindung liegen immer im selben Bereich wie das Ticket bzw. die
					Verbindung. Der Server lehnt alles andere ab und sagt, was in einem anderen Bereich liegt.
					Ein Projektkürzel wie <code>@HAUS</code> gilt je Bereich: Privat und Haushalt dürfen dasselbe
					Kürzel haben, und die Schnellerfassung nimmt das Projekt des gewählten Bereichs.
				</dd>
			</div>
			<div class="row">
				<dt>Links in den anderen Bereich</dt>
				<dd>
					Öffnest du über einen Link, einen Hinweis oder den Kalender etwas aus dem anderen Bereich,
					wechselt der Bereich von selbst, und ein Hinweis sagt „Zum Bereich … gewechselt“. Was du
					nicht sehen darfst, bleibt „nicht gefunden“.
				</dd>
			</div>
			<div class="row">
				<dt>Kanäle</dt>
				<dd>
					Verbindungen (Google Calendar, Telegram, Postfächer, Notion, GitHub, Ordner) laufen im
					Server mit seinen Zugangsdaten und Ordnern und bleiben deshalb privat; im Haushalt stehen
					sie mit „Nur im privaten Bereich“. Der eigene Eingang und WhatsApp Web legen immer privat
					an. Schnellerfassung, Zwischenablage, Bookmarklet und Datei-Importe gehen auch im
					Haushalt.
				</dd>
			</div>
			<div class="row">
				<dt>Papierkorb im Haushalt</dt>
				<dd>
					Alle Mitglieder sehen ihn und stellen wieder her. Endgültig löschen und „Papierkorb
					leeren“ dürfen nur der Inhaber und Mitglieder mit dem Recht „Endgültig löschen“; sonst
					fehlen die Knöpfe. Wie lange Tickets dort liegen, stellen sie unter Einstellungen →
					Haushalt ein; dein privater Papierkorb behält seine Einstellung unter Einstellungen →
					Tickets.
				</dd>
			</div>
			<div class="row">
				<dt>Verschieben</dt>
				<dd>
					Im Menü „•••“ eines Tickets, Projekts, einer Wiederholung oder eines Eintrags im Eingang
					(und für ausgewählte Tickets in der Leiste) steht „In den Haushalt verschieben …“ bzw.
					„Ins Private verschieben …“. In den Haushalt verschiebst du deine privaten Einträge;
					Kommentare und Verlauf werden dann für alle Mitglieder sichtbar. Ins Private holen ihre
					Ersteller, der Inhaber und Mitglieder mit dem Recht „Ins Private verschieben“; der Eintrag
					gehört dann dir, und für die anderen verschwindet er. Unteraufgaben, Unterprojekte, die
					Tickets eines Projekts und die Quellen eines Tickets kommen mit; Verbindungen bleiben
					immer privat.
				</dd>
			</div>
			<div class="row">
				<dt>Vorschau und Fragen</dt>
				<dd>
					Vor dem Verschieben zeigt die App, was mitkommt und was sich ändert, und fragt nur, was
					sie wissen muss: das Projekt im Ziel (oder „Ohne Projekt“), ob verknüpfte Tickets
					mitkommen oder die Verknüpfung gelöst wird, und einen neuen Code, wenn es das Kürzel im
					Ziel schon gibt. Tags werden nach Namen zugeordnet, eine Unteraufgabe ohne ihr Ticket wird
					ein eigenes, und ein Ticket ohne seine Wiederholung löst sich aus der Serie. Verschobene
					Tickets bekommen neue Nummern im Ziel; der Verlauf nennt die alte („vorher PRIV-12“), und
					Links funktionieren weiter. Alles geschieht in einem Schritt oder gar nicht; offene Tabs
					folgen ohne Neuladen.
				</dd>
			</div>
		</dl>
	</section>

	<p class="note elements">
		Zum Prüfen der Darstellung: <a href={resolve('/einstellungen/hilfe/elemente')}
			>Übersicht der Eingabeelemente</a
		> mit allen Feldern, Auswahllisten, Kästchen, Schaltern und Knöpfen in ihren Zuständen.
	</p>
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
	section a,
	.elements a {
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
