// Problems of the scripts (ADR-0048, plan robuste-skripte RS-1): the entries of the catalog
// app/byl-problems.ps1 that the help page "Betrieb" shows as frequent questions, word for word.
// The catalog stays the one source: tests/unit/script-problems.test.mjs reads it in Windows
// PowerShell and compares this list with it. Placeholders in braces as in the catalog; the help
// page fills them with the values it knows (commands for PowerShell in the folder app, the port of
// this app) and shows the rest as "…" in texts and as ‹placeholder› in commands. Pure module.

export type ScriptProblemLevel = 'error' | 'warning';

export interface ScriptProblem {
	code: string;
	/** The question on the help page (Faq of the catalog). */
	question: string;
	level: ScriptProblemLevel;
	problem: string;
	cause: string;
	steps: readonly string[];
	/** Command to copy, '' without one. */
	command: string;
}

export const SCRIPT_PROBLEMS: readonly ScriptProblem[] = [
	{
		code: 'config-json',
		question: 'Die Einstellungsdatei byl-config.json ist beschädigt',
		level: 'error',
		problem:
			'Die Einstellungsdatei byl-config.json ist kein gültiges JSON. becauseyoulovejira startet deshalb nicht, damit die App nie unter einer unerwarteten Adresse läuft.',
		cause:
			'Die Datei wurde von Hand bearbeitet und enthält einen Tippfehler, oder das Speichern wurde unterbrochen.',
		steps: [
			'Die Datei {file} in einem Editor öffnen und korrigieren; erwartet wird zum Beispiel { "port": 8090 }.',
			'Oder den Port neu setzen (Befehl unten): Die beschädigte Datei bleibt als byl-config.json.defekt-… daneben liegen. Ein Zielverzeichnis der Sicherung trägst du danach unter Einstellungen → Sicherung neu ein.'
		],
		command: '{control} port 8090'
	},
	{
		code: 'config-port',
		question: 'In byl-config.json steht ein ungültiger Port',
		level: 'error',
		problem:
			'In byl-config.json steht kein gültiger Port (erlaubt sind ganze Zahlen von 1024 bis 65535). becauseyoulovejira startet deshalb nicht.',
		cause:
			'Der Wert von „port“ wurde von Hand geändert und ist keine Zahl oder liegt außerhalb des Bereichs.',
		steps: [
			'Den Port wieder auf den Standard 8090 stellen (Befehl unten) oder statt 8090 einen anderen freien Port nehmen. Die übrigen Einstellungen in der Datei bleiben erhalten.'
		],
		command: '{control} port 8090'
	},
	{
		code: 'pocketbase-missing',
		question: 'pocketbase.exe fehlt',
		level: 'error',
		problem: 'pocketbase.exe fehlt im Ordner {app}.',
		cause:
			'Der Ordner app ist unvollständig: Die Datei wurde nicht mitkopiert, ein Virenscanner hat sie entfernt, oder das Projekt kommt frisch aus Git (pocketbase.exe liegt nicht im Repository).',
		steps: [
			'pocketbase.exe aus einer Kopie oder Sicherung des Ordners app zurücklegen.',
			'Im Repository lädt scripts\\fetch-pocketbase.ps1 die geprüfte Version (dafür ist Node.js 24 nötig).'
		],
		command: '{fetch}'
	},
	{
		code: 'folder-not-writable',
		question: 'Der Ordner der App ist nicht beschreibbar',
		level: 'error',
		problem: 'becauseyoulovejira kann im Ordner {folder} nicht schreiben ({detail}).',
		cause:
			'Der Ordner ist schreibgeschützt, gehört einem anderen Konto, liegt an einem Ort ohne Schreibrecht (etwa im Ordner „Programme“), oder ein Virenscanner sperrt ihn.',
		steps: [
			'Den Ordner app an einen Ort legen, an dem dein Konto schreiben darf, etwa in deinen Benutzerordner.',
			'Oder im Explorer: Rechtsklick auf den Ordner, Eigenschaften, Sicherheit, deinem Konto „Ändern“ erlauben.',
			'Danach mit dem Befehl unten prüfen.'
		],
		command: '{control} doctor'
	},
	{
		code: 'web-missing',
		question: 'Im Browser steht nur „File not found“',
		level: 'warning',
		problem:
			'Die Oberfläche fehlt (pb_public\\index.html). Die App startet trotzdem; im Browser steht dann nur „File not found“, die Verwaltung unter /_/ geht.',
		cause:
			'Der Ordner app kommt frisch aus dem Repository und wurde noch nicht gebaut, oder der Build ist abgebrochen.',
		steps: ['Im Repository scripts\\build.ps1 ausführen und danach im Browser neu laden.'],
		command: '{build}'
	},
	{
		code: 'pocketbase-exited',
		question: 'PocketBase beendet sich gleich beim Start',
		level: 'error',
		problem: 'PocketBase wurde beim Start beendet (Exit-Code {code}).',
		cause:
			'Den Grund nennen meist die letzten Zeilen des Server-Logs: eine Migration scheitert, die Datenbank ist beschädigt, oder ein anderes Programm sperrt eine Datei in pb_data (eine zweite Kopie der App, ein Sicherungsprogramm).',
		steps: [
			'Die Zeilen des Server-Logs lesen (oben bzw. mit dem Befehl unten).',
			'Läuft eine andere Kopie der App mit demselben Ordner pb_data, diese beenden.',
			'Danach start.bat erneut ausführen.',
			'Hilft das nicht: die letzten Zeilen des Server-Logs an Claude schicken.'
		],
		command: '{control} logs server'
	},
	{
		code: 'health-timeout',
		question: 'Die App startet, antwortet aber nicht',
		level: 'error',
		problem: 'PocketBase hat nach {seconds} Sekunden nicht auf /api/health geantwortet.',
		cause:
			'Der Rechner ist stark ausgelastet, ein Virenscanner prüft die Dateien beim ersten Start, oder eine lange Migration läuft noch.',
		steps: [
			'Einen Moment warten und mit status.bat nachsehen.',
			'Antwortet die App weiter nicht: neu-starten.bat ausführen und danach die Logs ansehen (Befehl unten).',
			'Der Server läuft eventuell weiter; stop.bat beendet ihn.'
		],
		command: '{control} logs server'
	},
	{
		code: 'port-busy',
		question: 'Der Port ist belegt',
		level: 'error',
		problem: 'Port {port} auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.',
		cause:
			'Ein anderes Programm nutzt die Adresse der App, oft eine zweite Kopie von becauseyoulovejira oder ein Entwicklungsserver. Es bleibt unberührt; die App weicht nie von selbst auf einen anderen Port aus.',
		steps: [
			'Das andere Programm beenden (eine andere Kopie der App mit ihrem stop.bat) und start.bat erneut ausführen.',
			'Oder becauseyoulovejira auf den freien Port {next} umstellen (Befehl unten) und start.bat ausführen. Lesezeichen, die installierte App und die Browser-Erweiterung für WhatsApp Web brauchen dann die neue Adresse; anmelden musst du dich dort einmal neu.'
		],
		command: '{control} port {next}'
	},
	{
		code: 'app-unhealthy',
		question: 'Die App läuft, antwortet aber nicht',
		level: 'error',
		problem: 'becauseyoulovejira läuft (PID {pid}, {url}), antwortet aber nicht auf /api/health.',
		cause: 'Der Server hängt, ist überlastet oder wird von einem anderen Programm blockiert.',
		steps: [
			'Neu starten: neu-starten.bat doppelklicken oder den Befehl unten ausführen.',
			'Bleibt es dabei, die Logs ansehen: logs server statt restart im Befehl.'
		],
		command: '{control} restart'
	},
	{
		code: 'stop-failed',
		question: 'Die App lässt sich nicht beenden',
		level: 'error',
		problem: 'becauseyoulovejira ließ sich nicht beenden.',
		cause:
			'Windows verweigert das Beenden, etwa weil der Prozess mit Administratorrechten oder unter einem anderen Konto läuft, oder er hängt.',
		steps: [
			'stop.bat noch einmal ausführen.',
			'Hilft das nicht: im Task-Manager unter „Details“ den Prozess mit der genannten PID beenden oder Windows neu starten.',
			'Danach mit dem Befehl unten prüfen, ob noch etwas läuft.'
		],
		command: '{control} status'
	},
	{
		code: 'dpapi-start',
		question: 'DPAPI ist nicht verfügbar',
		level: 'warning',
		problem:
			'Die Datenverschlüsselung von Windows (DPAPI) ist für dieses Konto nicht verfügbar ({detail}). Die App startet; status.bat erkennt aber nicht, ob sich eine BYL_-Variable geändert hat.',
		cause:
			'Das Benutzerprofil ist nur vorübergehend geladen, oder eine Richtlinie sperrt DPAPI (selten, etwa bei Domänenkonten).',
		steps: [
			'Nach dem Ändern einer BYL_-Variable immer neu starten (Befehl unten); neu-starten.bat erkennt den Bedarf dann nicht von selbst.',
			'Bei einem Konto einer Firma oder Schule die IT fragen, ob DPAPI gesperrt ist.'
		],
		command: '{control} restart'
	},
	{
		code: 'mail-helper-start',
		question: 'Der Mail-Helfer startet nicht',
		level: 'warning',
		problem:
			'Der Mail-Hilfsprozess byl-mail.exe ließ sich nicht starten ({detail}). Die App läuft, nur Postfächer werden nicht abgerufen.',
		cause: 'byl-mail.exe ist gesperrt oder beschädigt, oder ein Virenscanner blockiert die Datei.',
		steps: [
			'Die Fehler des Mail-Helfers ansehen (Befehl unten).',
			'Danach unter Einstellungen → System „Mail-Helfer neu starten“ oder neu-starten.bat.'
		],
		command: '{control} logs mail'
	},
	{
		code: 'disk-low',
		question: 'Auf dem Laufwerk ist wenig Platz',
		level: 'warning',
		problem: 'Auf dem Laufwerk der App sind nur noch {free} MB frei.',
		cause:
			'Datenbank, Sicherungen und Logs brauchen Platz; unter 100 MB können Speichern und Sichern scheitern.',
		steps: [
			'Platz schaffen: Papierkorb von Windows leeren und die Datenträgerbereinigung ausführen (Befehl unten).',
			'Ältere Sicherungen aus pb_data\\backups auf ein anderes Laufwerk verschieben.'
		],
		command: 'cleanmgr'
	},
	{
		code: 'autostart-write',
		question: 'Der Autostart lässt sich nicht einrichten',
		level: 'error',
		problem:
			'Der Autostart ließ sich nicht einrichten: Die Verknüpfung im Autostart-Ordner konnte nicht gespeichert werden ({detail}).',
		cause:
			'Der Autostart-Ordner von Windows ist schreibgeschützt oder gesperrt (Richtlinie, Virenscanner, Synchronisierung mit OneDrive).',
		steps: [
			'Den Autostart-Ordner öffnen (Befehl unten) und prüfen, ob du dort eine Datei anlegen kannst.',
			'Danach autostart-an.bat erneut ausführen.'
		],
		command: 'explorer shell:startup'
	},
	{
		code: 'backup-target-unreachable',
		question: 'Das Zielverzeichnis der Sicherung ist nicht erreichbar',
		level: 'error',
		problem: 'Das Zielverzeichnis der Sicherung ist nicht erreichbar.',
		cause:
			'Den Ordner gibt es nicht, die USB-Platte ist nicht angeschlossen, das Netzlaufwerk nicht verbunden, oder der Laufwerksbuchstabe hat sich geändert.',
		steps: [
			'Die Platte anschließen bzw. das Netzlaufwerk verbinden und den Pfad im Explorer prüfen.',
			'Die App versucht es alle 15 Minuten wieder; einen neuen Pfad trägst du unter Einstellungen → Sicherung ein.'
		],
		command: '{control} backup-info'
	},
	{
		code: 'passphrase-missing',
		question: 'Es fehlt die Passphrase der Sicherung',
		level: 'error',
		problem: 'Es ist keine Passphrase für die Sicherungen festgelegt.',
		cause: 'Ohne Passphrase entsteht im Zielverzeichnis keine verschlüsselte Sicherung.',
		steps: [
			'Unter Einstellungen → Sicherung eine Passphrase festlegen oder mit dem Befehl unten.',
			'Bewahre die Passphrase in deinem Passwort-Manager auf; ohne sie lässt sich die Sicherung nicht öffnen.'
		],
		command: '{control} backup-passphrase'
	},
	{
		code: 'passphrase-save',
		question: 'Die Passphrase lässt sich nicht speichern (DPAPI)',
		level: 'error',
		problem: 'Die Passphrase ließ sich nicht verschlüsselt speichern ({detail}).',
		cause:
			'Die Datenverschlüsselung von Windows (DPAPI) ist für dieses Konto nicht verfügbar, oder der Ordner %LOCALAPPDATA%\\becauseyoulovejira ist nicht beschreibbar.',
		steps: [
			'Es erneut versuchen (Befehl unten).',
			'Bei einem Konto einer Firma oder Schule die IT fragen, ob DPAPI gesperrt ist.'
		],
		command: '{control} backup-passphrase'
	},
	{
		code: 'backup-helper',
		question: 'byl-backup.exe fehlt oder antwortet nicht',
		level: 'error',
		problem: 'byl-backup.exe fehlt oder antwortet nicht.',
		cause:
			'Das Hilfsprogramm der Sicherung wurde nicht mitkopiert oder nicht gebaut, oder ein Virenscanner blockiert es.',
		steps: [
			'byl-backup.exe aus einer Kopie des Ordners app zurücklegen oder im Repository mit scripts\\build.ps1 bauen.'
		],
		command: '{build}'
	},
	{
		code: 'backup-passphrase',
		question: 'Die Passphrase passt nicht zur Sicherung',
		level: 'error',
		problem: 'Die Passphrase passt nicht zu dieser Sicherung.',
		cause:
			'Die Sicherung stammt von vor einem Wechsel der Passphrase, oder die Eingabe war vertippt.',
		steps: [
			'Die Passphrase eingeben, die beim Erstellen dieser Sicherung galt (Passwort-Manager).'
		],
		command: ''
	},
	{
		code: 'backup-damaged',
		question: 'Die Sicherung ist beschädigt',
		level: 'error',
		problem: 'Die Sicherung ist beschädigt oder unvollständig.',
		cause:
			'Die Datei wurde beim Kopieren abgeschnitten (USB-Platte abgezogen, Synchronisierung nicht fertig) oder verändert.',
		steps: [
			'Eine andere, ältere Sicherung prüfen und verwenden.',
			'Liegt sie in einem Ordner eines Cloud-Dienstes: warten, bis die Synchronisierung fertig ist.'
		],
		command: ''
	},
	{
		code: 'restore-start',
		question: 'Nach dem Wiederherstellen startet die App nicht',
		level: 'error',
		problem:
			'Mit der wiederhergestellten Sicherung startete die App nicht; der bisherige Stand ist zurück.',
		cause: 'Die Sicherung passt nicht zu dieser Version der App, oder ihr Port ist belegt.',
		steps: [
			'Die Logs ansehen (Befehl unten).',
			'Eine andere Sicherung versuchen oder die App zuerst aktualisieren.'
		],
		command: '{control} logs server'
	},
	{
		code: 'unexpected',
		question: 'Ein unerwarteter Fehler',
		level: 'error',
		problem: 'Unerwarteter Fehler: {detail}',
		cause: 'Ein Fall, den das Skript nicht kennt.',
		steps: [
			'Den Befehl noch einmal ausführen.',
			'Tritt der Fehler wieder auf: die letzten 50 Zeilen des Logs mit dem Befehl unten in die Zwischenablage kopieren und an Claude schicken. Sie enthalten keine Passwörter und keine Werte der BYL_-Variablen.'
		],
		command: '{tail}'
	},
	{
		code: 'script-blocked',
		question: 'Ein Doppelklick auf eine .bat-Datei zeigt nur eine rote Meldung von PowerShell',
		level: 'error',
		problem: 'byl-control.ps1 konnte nicht ausgeführt werden.',
		cause:
			'Eine Richtlinie für PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen oder sind beschädigt.',
		steps: [
			'Prüfen, ob byl-control.ps1, byl-functions.ps1 und byl-problems.ps1 im Ordner app liegen.',
			'Stammt der Ordner aus einem Download (ZIP): die Dateien entsperren (Befehl unten).',
			'Die Richtlinie anzeigen: powershell -NoProfile -Command Get-ExecutionPolicy -List. Steht bei MachinePolicy oder UserPolicy etwas anderes als Undefined, legt eine Richtlinie fest, dass Skripte nicht laufen; dann bei ihrem Verwalter um Freigabe bitten.'
		],
		command: 'powershell -NoProfile -Command "Get-ChildItem -LiteralPath \'{appq}\' | Unblock-File"'
	}
];

/**
 * What the help page fills in, as seen from a PowerShell window in the folder app: the commands
 * relative to it, the port and address of this app. The scripts themselves print full paths.
 */
export function helpValues(origin: string, port: string): Readonly<Record<string, string>> {
	return {
		control: 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\byl-control.ps1',
		fetch: 'powershell -NoProfile -ExecutionPolicy Bypass -File ..\\scripts\\fetch-pocketbase.ps1',
		build: 'powershell -NoProfile -ExecutionPolicy Bypass -File ..\\scripts\\build.ps1',
		tail: 'powershell -NoProfile -Command "Get-Content -LiteralPath .\\logs\\byl-control.log -Tail 50 | Set-Clipboard"',
		app: 'app',
		appq: '.',
		file: 'app\\byl-config.json',
		folder: 'app',
		log: 'app\\logs\\byl-control.log',
		seconds: '30',
		port,
		url: `${origin}/`
	};
}

/** Labels of the values only the machine knows, as ‹placeholders› of a command. */
export const COMMAND_PLACEHOLDERS: Readonly<Record<string, string>> = {
	next: 'freier Port'
};

const PLACEHOLDER = /\{([a-z][A-Za-z0-9]*)\}/g;

/** A text of the catalog with `values`; what the page cannot know becomes "…" (like the catalog). */
export function fillText(text: string, values: Readonly<Record<string, string>>): string {
	return text.replace(PLACEHOLDER, (_, name: string) => values[name] || '…');
}

/**
 * A command of the catalog as template of the code block (ADR-0026 section 6): known values filled
 * in, the others as {{name}} with the label of COMMAND_PLACEHOLDERS.
 */
export function commandTemplate(command: string, values: Readonly<Record<string, string>>): string {
	return command.replace(PLACEHOLDER, (_, name: string) => values[name] || `{{${name}}}`);
}
