// Keyboard shortcuts of the app in one place (ADR-0026 section 7, plan EH-9): the help page, the
// modal "Tastaturkürzel" and aria-keyshortcuts in the header read this list, so they never differ.
// Pure data; the handlers stay where they are (keyboard.ts for the global keys) and
// shortcuts.test.ts checks the global entries against them.

import { CALENDAR_MOVE_KEY } from './calendar';

/** Where a shortcut works, in the order of the help. */
export type ShortcutContext = 'everywhere' | 'list' | 'calendar' | 'panel' | 'dialogs' | 'editor';

export const SHORTCUT_CONTEXTS: readonly { id: ShortcutContext; label: string }[] = [
	{ id: 'everywhere', label: 'Überall' },
	{ id: 'list', label: 'Liste' },
	{ id: 'calendar', label: 'Kalender' },
	{ id: 'panel', label: 'Panel' },
	{ id: 'dialogs', label: 'Dialoge' },
	{ id: 'editor', label: 'Editor' }
];

/**
 * One shortcut: `keys` lists the alternatives, each a combination of key names as printed on a
 * German keyboard ("Strg", "Umschalt", "Alt", "Enter", …), e.g. [["c"], ["Strg", "K"]].
 */
export interface Shortcut {
	readonly id: string;
	readonly context: ShortcutContext;
	readonly keys: readonly (readonly string[])[];
	/** What the keys do, one sentence without a full stop. */
	readonly action: string;
}

/** aria-keyshortcuts of the button "Schnellerfassung" (WAI-ARIA key names). */
export const QUICK_CAPTURE_KEYSHORTCUTS = 'C Control+K';
/** aria-keyshortcuts of "Tastaturkürzel" in the help menu. */
export const HELP_KEYSHORTCUTS = '?';

export const SHORTCUTS: readonly Shortcut[] = [
	{
		id: 'quick-capture',
		context: 'everywhere',
		keys: [['c'], ['Strg', 'K']],
		action: 'Schnellerfassung öffnen (nicht in Eingabefeldern, Dialogen und offenen Auswahlen)'
	},
	{
		id: 'help',
		context: 'everywhere',
		keys: [['?']],
		action: 'Diese Tastaturkürzel anzeigen (auf deutscher Tastatur Umschalt+ß)'
	},
	{
		id: 'tab',
		context: 'everywhere',
		keys: [['Tab'], ['Umschalt', 'Tab']],
		action: 'Zum nächsten bzw. vorigen Bedienelement'
	},
	{
		id: 'open-row',
		context: 'list',
		keys: [['Enter']],
		action: 'Das Ticket oder den Eintrag der Zeile im Panel öffnen'
	},
	{
		id: 'toggle-done',
		context: 'list',
		keys: [['Leertaste']],
		action: 'Häkchen setzen oder entfernen'
	},
	// The menu of a row or a project tile (plan aktionsmenues, AM-3 and AM-5);
	// lib/overlay/context-menu.ts takes these keys.
	{
		id: 'row-menu',
		context: 'list',
		keys: [['Umschalt', 'F10'], ['Kontextmenü']],
		action:
			'Das Menü „•••“ der Zeile oder Kachel öffnen, in der der Fokus steht (wie ein Rechtsklick)'
	},
	{
		id: 'filter-arrows',
		context: 'list',
		keys: [['Pfeiltasten']],
		action: 'In einer Filtergruppe und in „Gruppieren“ den Wert wechseln'
	},
	{
		id: 'clear-search',
		context: 'list',
		keys: [['Esc']],
		action: 'Im Suchfeld: die Suche leeren'
	},
	{
		id: 'paste-inbox',
		context: 'list',
		keys: [['Strg', 'V']],
		action: 'In der Eingangsansicht außerhalb von Feldern: Text aus der Zwischenablage übernehmen'
	},
	// The grid of month and week (ADR-0053 §8 and §12); CalendarGrid.svelte takes these keys with
	// gridMove and CALENDAR_MOVE_KEY of domain/calendar.ts.
	{
		id: 'calendar-days',
		context: 'calendar',
		keys: [['Pfeiltasten']],
		action: 'Im Monat oder in der Woche: zum Tag davor, danach, eine Woche früher oder später'
	},
	{
		id: 'calendar-week-ends',
		context: 'calendar',
		keys: [['Pos1'], ['Ende']],
		action: 'Zum Montag bzw. Sonntag der Woche; mit Strg zum ersten bzw. letzten Tag des Monats'
	},
	{
		id: 'calendar-period',
		context: 'calendar',
		keys: [['Bild auf'], ['Bild ab']],
		action: 'Zum selben Tag im Monat bzw. in der Woche davor oder danach'
	},
	{
		id: 'calendar-enter',
		context: 'calendar',
		keys: [['Enter'], ['F2']],
		action: 'In die Einträge des Tages wechseln; dort Pfeil hoch und runter, Esc zurück zum Tag'
	},
	{
		id: 'calendar-move',
		context: 'calendar',
		keys: [[CALENDAR_MOVE_KEY]],
		action:
			'Auf einem offenen Ticket: seine Fälligkeit verschieben; Tag mit den Pfeiltasten wählen, Enter setzt, Esc bricht ab'
	},
	{
		id: 'close-panel',
		context: 'panel',
		keys: [['Esc']],
		action: 'Das Panel schließen (außer ein Feld wird gerade bearbeitet)'
	},
	{
		id: 'field-save',
		context: 'panel',
		keys: [['Enter'], ['Esc']],
		action: 'Im Titel- oder Datumsfeld: speichern bzw. die Eingabe verwerfen'
	},
	{
		id: 'ctrl-enter',
		context: 'panel',
		keys: [['Strg', 'Enter']],
		action:
			'Beschreibung speichern, Kommentar senden, „Neues Ticket“ anlegen oder eine Regel speichern'
	},
	{
		id: 'activity-tabs',
		context: 'panel',
		keys: [['Pfeil links'], ['Pfeil rechts'], ['Pos1'], ['Ende']],
		action: 'Zwischen den Reitern „Kommentare“ und „Verlauf“ wechseln'
	},
	{
		id: 'close-dialog',
		context: 'dialogs',
		keys: [['Esc']],
		action: 'Dialog oder Auswahl schließen; bei ungespeicherten Eingaben fragt die App erst nach'
	},
	{
		id: 'quick-save',
		context: 'dialogs',
		keys: [['Enter'], ['Alt', 'Enter']],
		action: 'In der Schnellerfassung: Ticket anlegen bzw. in den Eingang legen'
	},
	{
		id: 'new-ticket-save',
		context: 'dialogs',
		keys: [['Strg', 'Enter']],
		action: 'Im Formular „Neues Ticket“ und in der Erfassung: speichern'
	},
	{
		id: 'capture-inbox',
		context: 'dialogs',
		keys: [['Alt', 'Enter']],
		action: 'In der Erfassung: in den Eingang legen'
	},
	// The editor (ADR-0032, plan editor section 3.2): the keys of Tiptap, like in Jira. The
	// toolbar takes names and aria-keyshortcuts from here; editor tests press every one of them.
	{ id: 'editor-bold', context: 'editor', keys: [['Strg', 'B']], action: 'Fett' },
	{ id: 'editor-italic', context: 'editor', keys: [['Strg', 'I']], action: 'Kursiv' },
	{ id: 'editor-underline', context: 'editor', keys: [['Strg', 'U']], action: 'Unterstrichen' },
	{
		id: 'editor-strike',
		context: 'editor',
		keys: [['Strg', 'Umschalt', 'S']],
		action: 'Durchgestrichen'
	},
	{ id: 'editor-code', context: 'editor', keys: [['Strg', 'E']], action: 'Inline-Code' },
	{
		id: 'editor-paragraph',
		context: 'editor',
		keys: [['Strg', 'Alt', '0']],
		action: 'Normaler Text'
	},
	{
		id: 'editor-heading-1',
		context: 'editor',
		keys: [['Strg', 'Alt', '1']],
		action: 'Überschrift 1'
	},
	{
		id: 'editor-heading-2',
		context: 'editor',
		keys: [['Strg', 'Alt', '2']],
		action: 'Überschrift 2'
	},
	{
		id: 'editor-heading-3',
		context: 'editor',
		keys: [['Strg', 'Alt', '3']],
		action: 'Überschrift 3'
	},
	{
		id: 'editor-bullet-list',
		context: 'editor',
		keys: [['Strg', 'Umschalt', '8']],
		action: 'Aufzählung'
	},
	{
		id: 'editor-ordered-list',
		context: 'editor',
		keys: [['Strg', 'Umschalt', '7']],
		action: 'Nummerierte Liste'
	},
	{
		id: 'editor-task-list',
		context: 'editor',
		keys: [['Strg', 'Umschalt', '9']],
		action: 'Checkliste'
	},
	{ id: 'editor-quote', context: 'editor', keys: [['Strg', 'Umschalt', 'B']], action: 'Zitat' },
	{ id: 'editor-code-block', context: 'editor', keys: [['Strg', 'Alt', 'C']], action: 'Codeblock' },
	{
		id: 'editor-link',
		context: 'editor',
		keys: [['Strg', 'K']],
		action: 'Link einfügen oder bearbeiten'
	},
	{
		id: 'editor-slash',
		context: 'editor',
		keys: [['/']],
		action:
			'Am Zeilenanfang oder nach einem Leerzeichen: Menü für Überschriften, Listen, Blöcke und Link; Esc schließt es'
	},
	{
		id: 'editor-indent',
		context: 'editor',
		keys: [['Tab'], ['Umschalt', 'Tab']],
		action: 'In Listen ein- bzw. ausrücken; sonst zum nächsten bzw. vorigen Bedienelement'
	},
	{
		id: 'editor-toolbar',
		context: 'editor',
		keys: [['Alt', 'F10']],
		action: 'Zur Formatierungsleiste; Esc führt zurück in den Text'
	},
	{
		id: 'editor-plain-paste',
		context: 'editor',
		keys: [['Strg', 'Umschalt', 'V']],
		action: 'Als reinen Text einfügen'
	},
	{
		id: 'editor-undo',
		context: 'editor',
		keys: [
			['Strg', 'Z'],
			['Strg', 'Y']
		],
		action: 'Rückgängig bzw. wiederholen'
	}
];

/** The shortcuts of one context, in the order of the list. */
export function shortcutsOf(context: ShortcutContext): Shortcut[] {
	return SHORTCUTS.filter((shortcut) => shortcut.context === context);
}

/** The shortcut with `id`; throws for an unknown id, so a typo fails at once. */
export function shortcutById(id: string): Shortcut {
	const shortcut = SHORTCUTS.find((candidate) => candidate.id === id);
	if (shortcut === undefined) throw new Error(`Unknown shortcut: ${id}`);
	return shortcut;
}

/** Plain text of the keys, e.g. "c oder Strg+K", for names and tests. */
export function keysText(shortcut: Pick<Shortcut, 'keys'>): string {
	return shortcut.keys.map((combination) => combination.join('+')).join(' oder ');
}

/** WAI-ARIA names of the German key names that differ. */
const ARIA_KEYS: Readonly<Record<string, string>> = {
	Strg: 'Control',
	Umschalt: 'Shift',
	Esc: 'Escape'
};

/** aria-keyshortcuts of a shortcut, e.g. "Control+Shift+S" (WAI-ARIA key names). */
export function ariaKeyShortcuts(shortcut: Pick<Shortcut, 'keys'>): string {
	return shortcut.keys
		.map((combination) =>
			combination
				.map((name) => ARIA_KEYS[name] ?? (name.length === 1 ? name.toUpperCase() : name))
				.join('+')
		)
		.join(' ');
}
