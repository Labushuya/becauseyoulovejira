// Every option of a ticket (NT-1, ADR-0069): what the detail (side panel and full view) offers, in
// its order, and where "Neues Ticket" offers it, among the main fields or under "Weitere Optionen".
// The product rule: everything that can be set at a ticket can be set when it is created, except what
// needs an existing ticket, and what accounts may not write yet; each exception names its reason here.
//
// The controls of the detail and of the form carry the key of their option (`data-ticket-option`),
// the entries of the menu "•••" their label (`menu`); ticket-options-parity.test.ts holds the detail,
// this list and the form in line. A new option of the detail therefore gets an entry here and, unless
// it is an exception with a reason, its control in NewTicketForm.

/** Where "Neues Ticket" offers an option: on top, or in the area "Weitere Optionen". */
export type CreatePlace = 'main' | 'more';

export interface TicketOption {
	/** Key of the option at its controls (`data-ticket-option`). */
	key: string;
	/** Name in the detail. */
	label: string;
	/** Where the detail shows it; null for an option the detail does not offer yet. */
	detail: string | null;
	/** "household": only at a ticket of a household (and so only in its tab of "Neues Ticket"). */
	area: 'all' | 'household';
	/** The place in "Neues Ticket", null for an exception. */
	create: CreatePlace | null;
	/** Why an exception is one (required for `create` null). */
	reason?: string;
	/** Labels of the entries of the menu "•••" that belong to the option. */
	menu?: readonly string[];
}

const HEAD = 'Kopf von Panel und Vollansicht';
const MENU = 'Menü „•••“ im Kopf';
const FIELDS = 'Felder';
const EXISTING = 'Setzt ein bestehendes Ticket voraus';

/** The options in the order of the side panel: head, title, fields, sections. */
export const TICKET_OPTIONS: readonly TicketOption[] = Object.freeze([
	{ key: 'pin', label: 'Anheften', detail: HEAD, area: 'all', create: 'more' },
	{
		key: 'dayPlan',
		label: 'Zum Tagesplan',
		detail: MENU,
		area: 'all',
		create: 'more',
		menu: ['Zum Tagesplan']
	},
	{
		key: 'open',
		label: 'Im Seitenpanel öffnen / In Vollansicht öffnen',
		detail: 'Menü „•••“ einer Zeile',
		area: 'all',
		create: null,
		reason: `${EXISTING}: Es öffnet das Ticket, eine Einstellung ist es nicht.`,
		menu: ['Im Seitenpanel öffnen', 'In Vollansicht öffnen']
	},
	{
		key: 'copyLink',
		label: 'Link kopieren',
		detail: MENU,
		area: 'all',
		create: null,
		reason: `${EXISTING}: Der Link nennt seine Adresse; eine Einstellung ist es nicht.`,
		menu: ['Link kopieren']
	},
	{
		key: 'duplicate',
		label: 'Duplizieren …',
		detail: MENU,
		area: 'all',
		create: null,
		reason: `${EXISTING}: Eine Kopie braucht ihr Original. Der Dialog bleibt bewusst schlank.`,
		menu: ['Duplizieren …']
	},
	{
		key: 'followUp',
		label: 'Folge-Ticket anlegen …',
		detail: MENU,
		area: 'all',
		create: null,
		reason: `${EXISTING}: Gegenrichtung der Ticket-Quellen (ein neues Ticket stammt aus diesem). Die Richtung „stammt aus“ bietet der Dialog unter „Quellen“.`,
		menu: ['Folge-Ticket anlegen …']
	},
	{
		key: 'move',
		label: 'In den Haushalt verschieben … / Ins Private verschieben …',
		detail: MENU,
		area: 'all',
		create: null,
		reason: `${EXISTING}: Verschieben wechselt den Bereich eines Tickets; ein neues entsteht im Bereich des Tabs (Bereichs-Umschalter).`,
		menu: ['In den Haushalt verschieben …', 'Ins Private verschieben …']
	},
	{
		key: 'trash',
		label: 'In den Papierkorb …',
		detail: MENU,
		area: 'all',
		create: null,
		reason: `${EXISTING}: Nur ein angelegtes Ticket kommt in den Papierkorb; „Abbrechen“ verwirft den Entwurf.`,
		menu: ['In den Papierkorb …']
	},
	{ key: 'title', label: 'Titel', detail: 'Titel', area: 'all', create: 'main' },
	{
		key: 'status',
		label: 'Status',
		detail: FIELDS,
		area: 'all',
		create: 'main',
		menu: ['Wieder öffnen']
	},
	{ key: 'priority', label: 'Priorität', detail: FIELDS, area: 'all', create: 'main' },
	{ key: 'assignee', label: 'Zuständig', detail: FIELDS, area: 'household', create: 'main' },
	{
		key: 'due',
		label: 'Fälligkeit',
		detail: FIELDS,
		area: 'all',
		create: 'main',
		menu: ['Fälligkeit verschieben …']
	},
	{ key: 'project', label: 'Projekt', detail: FIELDS, area: 'all', create: 'main' },
	{ key: 'color', label: 'Farbe', detail: FIELDS, area: 'all', create: 'more' },
	{ key: 'charm', label: 'Charm', detail: FIELDS, area: 'all', create: 'main' },
	{ key: 'kind', label: 'Art (Laufendes Vorhaben)', detail: FIELDS, area: 'all', create: 'more' },
	{ key: 'tags', label: 'Tags', detail: FIELDS, area: 'all', create: 'main' },
	{
		key: 'parent',
		label: 'Übergeordnet (mit „Blockiert das übergeordnete Ticket“)',
		detail: FIELDS,
		area: 'all',
		create: 'more'
	},
	{
		key: 'recurrence',
		label: 'Wiederholung (Rhythmus, Folgetickets, Zuständigkeit, Unteraufgaben der Vorlage)',
		detail: 'Abschnitt „Wiederholung“',
		area: 'all',
		create: 'more'
	},
	{ key: 'description', label: 'Beschreibung', detail: 'Abschnitt', area: 'all', create: 'main' },
	{ key: 'subtasks', label: 'Unteraufgaben', detail: 'Abschnitt', area: 'all', create: 'more' },
	{
		key: 'meta',
		label: 'Quelle und Daten',
		detail: 'Zeile unter den Unteraufgaben',
		area: 'all',
		create: null,
		reason:
			'Nur Anzeige: Erstellt, Aktualisiert und Erledigt am setzt der Server; die Quelle kommt aus dem Eingang (Umwandeln öffnet denselben Dialog).'
	},
	{
		key: 'sources',
		label: 'Quellen: Einträge aus dem Eingang',
		detail: 'Abschnitt „Quellen“',
		area: 'all',
		create: 'more'
	},
	{
		key: 'ticketSources',
		label: 'Quellen: Tickets',
		detail: 'Abschnitt „Quellen“',
		area: 'all',
		create: 'more'
	},
	{
		key: 'followUps',
		label: 'Folge-Tickets',
		detail: 'Abschnitt',
		area: 'all',
		create: null,
		reason: `${EXISTING}: Folge-Tickets stammen aus diesem Ticket (Gegenrichtung); ein neues Ticket hat noch keine.`
	},
	{
		key: 'comments',
		label: 'Kommentare (mit „Anpinnen“)',
		detail: 'Reiter „Kommentare“',
		area: 'all',
		create: null,
		reason: `${EXISTING}: Ein Kommentar gehört zu einem Ticket; der Server lehnt einen angepinnten Kommentar beim Anlegen ab. Was zum Anfang gehört, steht in der Beschreibung.`
	},
	{
		key: 'history',
		label: 'Verlauf',
		detail: 'Reiter „Verlauf“',
		area: 'all',
		create: null,
		reason: `${EXISTING}: Der Verlauf schreibt nur der Server.`
	},
	{
		key: 'read',
		label: 'Lesestatus („neu“)',
		detail: null,
		area: 'all',
		create: null,
		reason:
			'Ein einzeln angelegtes Ticket gilt sofort als gelesen (ADR-0015); Öffnen markiert es ebenso.'
	},
	{
		key: 'dependencies',
		label: 'Abhängigkeiten',
		detail: null,
		area: 'all',
		create: null,
		reason:
			'Konten schreiben Abhängigkeiten bis Stufe 2 nicht (API-Regeln null); das Detail bietet sie noch nicht an.'
	}
] satisfies TicketOption[]);

/** The option of a key, or undefined. */
export function ticketOption(key: string): TicketOption | undefined {
	return TICKET_OPTIONS.find((option) => option.key === key);
}

/** The keys of the options "Neues Ticket" offers at `place`, in the order of the detail. */
export function createKeys(place: CreatePlace): string[] {
	return TICKET_OPTIONS.filter((option) => option.create === place).map((option) => option.key);
}
