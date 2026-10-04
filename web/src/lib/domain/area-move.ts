// Moving between the areas Privat and Haushalt and dissolving a household (E7-4, ADR-0060): when the
// menus offer it, the answers of POST /api/byl/area/move and POST /api/byl/household/dissolve read
// strictly, the choices of the dialog and what it says, and the history entry of a moved ticket. The
// texts of a refusal are the same as PROBLEMS of app/pb_hooks/lib/area-move-rules.js (parity test).
// The server decides; the dialog only leaves out what it would refuse. Pure: no SDK, no SvelteKit.

import type { AreaKind } from './area';
import { may, type Membership } from './household';

export type MoveKind = 'ticket' | 'project' | 'rule' | 'item';
export type MoveDirection = 'household' | 'private';
export type DependencyChoice = 'take' | 'release';
export type DissolveMode = 'adopt' | 'delete';

/** At most this many records start one move (lib/area-move-rules.js MAX_ROOTS). */
export const MOVE_MAX = 200;

/** Texts of the refused requests, the same as PROBLEMS of lib/area-move-rules.js. */
export const AREA_MOVE_PROBLEMS: Readonly<Record<string, string>> = {
	format: 'Die Angabe fehlt oder ist ungültig.',
	'too-many': `Höchstens ${MOVE_MAX} Einträge auf einmal.`,
	'no-household': 'Du bist in keinem Haushalt.',
	missing: 'Diesen Eintrag gibt es nicht (mehr), oder er ist für dich nicht sichtbar.',
	area: 'Der Eintrag liegt nicht in dem Bereich, aus dem verschoben wird.',
	linked:
		'Dieser Eintrag gehört zu einem Ticket. Verschiebe das Ticket, dann kommt der Eintrag mit.',
	right:
		'Dafür fehlt dir das Recht. Ins Private verschieben dürfen nur der Ersteller, der Inhaber und Mitglieder mit dem Recht „Ins Private verschieben“.',
	'project-choice':
		'Bitte wählen, in welches Projekt die Einträge im Ziel kommen, oder „Ohne Projekt“.',
	project: 'Dieses Projekt gibt es im Ziel nicht, oder es ist archiviert.',
	'dependencies-choice':
		'Bitte wählen, ob die verknüpften Tickets mitkommen oder die Verknüpfung gelöst wird.',
	code: 'Bitte einen Code aus 2 bis 6 Großbuchstaben wählen, den es im Ziel noch nicht gibt (nicht TASK).',
	'owner-only': 'Auflösen kann nur der Inhaber des Haushalts.',
	mode: 'Bitte wählen: alles ins Private übernehmen oder alles endgültig löschen.',
	'dissolve-name': 'Bitte den Namen des Haushalts genau so eintippen, wie er hier steht.'
};

/** Text of a refused request, or a general one for a problem the dialog does not know. */
export function moveProblemText(problem: string): string {
	return Object.hasOwn(AREA_MOVE_PROBLEMS, problem)
		? (AREA_MOVE_PROBLEMS[problem] ?? '')
		: 'Der Server hat die Anfrage abgelehnt.';
}

/** Words of the menus, the dialog and the flags. */
export const MOVE_TEXTS = Object.freeze({
	action: { household: 'In den Haushalt verschieben …', private: 'Ins Private verschieben …' },
	confirm: { household: 'In den Haushalt verschieben', private: 'Ins Private verschieben' },
	running: 'Wird verschoben …',
	title: (label: string, to: MoveDirection) =>
		`${label} ${to === 'household' ? 'in den Haushalt' : 'ins Private'} verschieben`,
	/** What the people of the household should know before (ADR-0060 §1). */
	hint: {
		household: 'Kommentare und Verlauf werden für alle Mitglieder sichtbar.',
		private: 'Für die anderen Mitglieder verschwindet der Eintrag.'
	},
	loading: 'Vorschau wird geladen …',
	whatMoves: 'Das wird verschoben',
	conflicts: 'Was sich ändert',
	projectLegend: 'Projekt im Ziel',
	projectHint: (codes: string) =>
		`${codes} bleibt im bisherigen Bereich. Wähle ein Projekt im Ziel oder „Ohne Projekt“.`,
	noProject: 'Ohne Projekt',
	chooseProject: 'Bitte wählen …',
	dependencyLegend: 'Abhängigkeiten zu Tickets, die zurückbleiben',
	take: 'Mitnehmen: die verknüpften Tickets kommen mit',
	release: 'Verknüpfung lösen: die Tickets bleiben, die Abhängigkeit geht',
	codeLegend: 'Neuer Code im Ziel',
	codeHint: (code: string) => `Im Ziel gibt es schon ein Projekt mit dem Code ${code}.`,
	done: (label: string, to: MoveDirection) =>
		`${label} ${to === 'household' ? 'in den Haushalt' : 'ins Private'} verschoben.`,
	newKey: (key: string) => `Neuer Key: ${key}.`,
	movedAway: 'Dieses Ticket ist jetzt in einem anderen Bereich.',
	movedAwayText: 'Es wurde verschoben und ist hier nicht mehr sichtbar.'
});

/**
 * Which way a record may move from the area of the tab (ADR-0060 §4), null when the menu leaves the
 * entry out: only for an account in a household; out of the private area its own records into the
 * household; from the household into the private area those it created, and every one with the
 * right "move_out" (the owner by the role). The server checks every record of the cascade again.
 */
export function moveDirection(input: {
	area: AreaKind;
	membership: Membership | null;
	userId: string | null;
	owner: string | undefined;
}): MoveDirection | null {
	if (input.membership === null || input.userId === null) return null;
	if (input.area === 'private') {
		return input.owner === undefined || input.owner === input.userId ? 'household' : null;
	}
	return input.owner === input.userId || may(input.membership, 'move_out') ? 'private' : null;
}

export interface NamedProject {
	id: string;
	code: string;
	name: string;
}

export interface TicketRef {
	id: string;
	key: string;
	title: string;
}

/** The answer of a preview and of a move. */
export interface MovePreview {
	preview: boolean;
	kind: MoveKind;
	to: MoveDirection;
	/** Scope of the target (`u:<account>` or `h:<household>`). */
	scope: string;
	fromName: string;
	toName: string;
	counts: {
		tickets: number;
		subtasks: number;
		projects: number;
		rules: number;
		items: number;
		comments: number;
		dependencies: number;
	};
	conflicts: {
		project: {
			projects: NamedProject[];
			tickets: number;
			rules: number;
			targets: NamedProject[];
		} | null;
		tags: { reused: string[]; created: string[] };
		dependencies: { ticket: TicketRef | null; other: TicketRef | null }[];
		parents: { id: string; key: string; parent: string }[];
		projectParents: { id: string; code: string; parent: string }[];
		codes: (NamedProject & { suggestion: string })[];
		series: { id: string; key: string }[];
		ruleTickets: number;
		rulesProject: { id: string; title: string }[];
		items: { connection: number; target: number; duplicate: number };
		targets: number;
	};
	needs: { project: boolean; dependencies: boolean; codes: string[] };
	/** After a move: the new keys and codes. */
	moved: {
		tickets: { id: string; key: string; previous: string }[];
		projects: { id: string; code: string }[];
		rules: string[];
		items: string[];
	} | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

/** A list of `value` mapped by `map`; null when it is no array or one entry does not fit. */
function listOf<T>(value: unknown, map: (entry: Record<string, unknown>) => T | null): T[] | null {
	if (!Array.isArray(value)) return null;
	const list: T[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		const mapped = map(entry);
		if (mapped === null) return null;
		list.push(mapped);
	}
	return list;
}

const named = (entry: Record<string, unknown>): NamedProject | null =>
	typeof entry.id === 'string' && entry.id !== ''
		? { id: entry.id, code: text(entry.code), name: text(entry.name) }
		: null;

const ticketRef = (value: unknown): TicketRef | null =>
	isRecord(value) && typeof value.id === 'string'
		? { id: value.id, key: text(value.key), title: text(value.title) }
		: null;

const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const KINDS: readonly MoveKind[] = ['ticket', 'project', 'rule', 'item'];

function parseProjectConflict(value: unknown): MovePreview['conflicts']['project'] | undefined {
	if (value === null) return null;
	if (!isRecord(value)) return undefined;
	const projects = listOf(value.projects, named);
	const targets = listOf(value.targets ?? [], named);
	if (projects === null || targets === null) return undefined;
	return { projects, tickets: count(value.tickets), rules: count(value.rules), targets };
}

function parseMoved(value: unknown): MovePreview['moved'] | undefined {
	if (value === undefined || value === null) return null;
	if (!isRecord(value)) return undefined;
	const tickets = listOf(value.tickets, (entry) =>
		typeof entry.id === 'string'
			? { id: entry.id, key: text(entry.key), previous: text(entry.previous) }
			: null
	);
	const projects = listOf(value.projects, (entry) =>
		typeof entry.id === 'string' ? { id: entry.id, code: text(entry.code) } : null
	);
	if (tickets === null || projects === null) return undefined;
	return { tickets, projects, rules: strings(value.rules), items: strings(value.items) };
}

/** The answer of POST /api/byl/area/move, or null for anything else. */
export function parseMovePreview(value: unknown): MovePreview | null {
	if (!isRecord(value) || !isRecord(value.counts) || !isRecord(value.conflicts)) return null;
	if (!isRecord(value.needs)) return null;
	const kind = KINDS.find((known) => known === value.kind);
	const to = value.to === 'household' || value.to === 'private' ? value.to : null;
	if (kind === undefined || to === null) return null;
	const c = value.conflicts;
	const project = parseProjectConflict(c.project);
	const tags = isRecord(c.tags) ? c.tags : {};
	const dependencies = listOf(c.dependencies ?? [], (entry) => ({
		ticket: ticketRef(entry.ticket),
		other: ticketRef(entry.other)
	}));
	const parents = listOf(c.parents ?? [], (entry) =>
		typeof entry.id === 'string'
			? { id: entry.id, key: text(entry.key), parent: text(entry.parent) }
			: null
	);
	const projectParents = listOf(c.project_parents ?? [], (entry) =>
		typeof entry.id === 'string'
			? { id: entry.id, code: text(entry.code), parent: text(entry.parent) }
			: null
	);
	const codes = listOf(c.codes ?? [], (entry) => {
		const base = named(entry);
		return base === null ? null : { ...base, suggestion: text(entry.suggestion) };
	});
	const series = listOf(c.series ?? [], (entry) =>
		typeof entry.id === 'string' ? { id: entry.id, key: text(entry.key) } : null
	);
	const rulesProject = listOf(c.rules_project ?? [], (entry) =>
		typeof entry.id === 'string' ? { id: entry.id, title: text(entry.title) } : null
	);
	const moved = parseMoved(value.moved);
	if (
		project === undefined ||
		dependencies === null ||
		parents === null ||
		projectParents === null ||
		codes === null ||
		series === null ||
		rulesProject === null ||
		moved === undefined
	) {
		return null;
	}
	const items = isRecord(c.items) ? c.items : {};
	const counts = value.counts;
	return {
		preview: value.preview === true,
		kind,
		to,
		scope: text(value.scope),
		fromName: text(value.from_name),
		toName: text(value.to_name),
		counts: {
			tickets: count(counts.tickets),
			subtasks: count(counts.subtasks),
			projects: count(counts.projects),
			rules: count(counts.rules),
			items: count(counts.items),
			comments: count(counts.comments),
			dependencies: count(counts.dependencies)
		},
		conflicts: {
			project,
			tags: { reused: strings(tags.reused), created: strings(tags.created) },
			dependencies,
			parents,
			projectParents,
			codes,
			series,
			ruleTickets: count(c.rule_tickets),
			rulesProject,
			items: {
				connection: count(items.connection),
				target: count(items.target),
				duplicate: count(items.duplicate)
			},
			targets: count(c.targets)
		},
		needs: {
			project: value.needs.project === true,
			dependencies: value.needs.dependencies === true,
			codes: strings(value.needs.codes)
		},
		moved
	};
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What moves, one line per kind with at least one (ADR-0060 §1: "Anzahl der Einträge je Art"). */
export function countLines(preview: MovePreview): string[] {
	const { counts } = preview;
	const lines: string[] = [];
	if (counts.tickets > 0) {
		const subtasks =
			counts.subtasks > 0
				? ` (davon ${plural(counts.subtasks, 'Unteraufgabe', 'Unteraufgaben')})`
				: '';
		lines.push(`${plural(counts.tickets, 'Ticket', 'Tickets')}${subtasks}`);
	}
	if (counts.projects > 0) lines.push(plural(counts.projects, 'Projekt', 'Projekte'));
	if (counts.rules > 0) lines.push(plural(counts.rules, 'Wiederholung', 'Wiederholungen'));
	if (counts.items > 0)
		lines.push(plural(counts.items, 'Eintrag im Eingang', 'Einträge im Eingang'));
	if (counts.comments > 0) lines.push(plural(counts.comments, 'Kommentar', 'Kommentare'));
	if (counts.dependencies > 0) {
		lines.push(plural(counts.dependencies, 'Abhängigkeit', 'Abhängigkeiten'));
	}
	return lines;
}

/** What else changes without a choice: tags by name, parents, series, entries of the inbox. */
export function noteLines(preview: MovePreview): string[] {
	const c = preview.conflicts;
	const lines: string[] = [];
	if (c.tags.reused.length > 0) lines.push(`Tags im Ziel übernommen: ${c.tags.reused.join(', ')}`);
	if (c.tags.created.length > 0)
		lines.push(`Tags im Ziel neu angelegt: ${c.tags.created.join(', ')}`);
	for (const parent of c.parents) {
		lines.push(`${parent.key} wird im Ziel ein Hauptticket (${parent.parent} bleibt zurück).`);
	}
	for (const project of c.projectParents) {
		lines.push(
			`${project.code} wird im Ziel ein eigenständiges Projekt (${project.parent} bleibt zurück).`
		);
	}
	if (c.series.length > 0) {
		lines.push(
			`${c.series.map((entry) => entry.key).join(', ')} ${c.series.length === 1 ? 'verlässt seine' : 'verlassen ihre'} Wiederholung.`
		);
	}
	if (c.ruleTickets > 0) {
		lines.push(
			`${plural(c.ruleTickets, 'bisheriges Ticket', 'bisherige Tickets')} der Wiederholung ${c.ruleTickets === 1 ? 'bleibt' : 'bleiben'}, wo ${c.ruleTickets === 1 ? 'es ist' : 'sie sind'}, ohne Bezug zur Regel. Künftige Tickets entstehen im Ziel.`
		);
	}
	for (const rule of c.rulesProject) {
		lines.push(`Die Wiederholung „${rule.title}“ bleibt zurück und verliert ihr Projekt.`);
	}
	if (c.items.connection > 0) {
		lines.push(
			`${plural(c.items.connection, 'Eintrag verliert', 'Einträge verlieren')} den Bezug zur Verbindung; Verbindungen bleiben privat.`
		);
	}
	if (c.items.target > 0) {
		lines.push(
			`${plural(c.items.target, 'Eintrag verliert', 'Einträge verlieren')} das Zielprojekt.`
		);
	}
	if (c.items.duplicate > 0) {
		lines.push(
			`${plural(c.items.duplicate, 'Eintrag gibt', 'Einträge gibt')} es im Ziel schon; beide bleiben.`
		);
	}
	if (c.targets > 0) {
		lines.push(
			`${plural(c.targets, 'Zielprojekt', 'Zielprojekte')} von Einträgen, Verbindungen oder Karten des Eingangs ${c.targets === 1 ? 'wird' : 'werden'} geleert.`
		);
	}
	return lines;
}

/** The choices of the dialog: null while not chosen. */
export interface MoveChoices {
	project: string | null;
	dependencies: DependencyChoice | null;
	codes: Record<string, string>;
}

/** The choices to start with: nothing chosen, taken codes with the suggestion of the server. */
export function initialChoices(preview: MovePreview): MoveChoices {
	const codes: Record<string, string> = {};
	for (const entry of preview.conflicts.codes) codes[entry.id] = entry.suggestion;
	return { project: null, dependencies: null, codes };
}

/** A typed code as the server stores it: capitals, without white space. */
export function normalizeCode(value: string): string {
	return value.replace(/\s+/g, '').toUpperCase();
}

const CODE_PATTERN = /^[A-Z]{2,6}$/;

/**
 * What is missing or wrong before the move may run, by field (`project`, `dependencies`,
 * `code:<project ID>`); empty when the choices are complete. The server checks again.
 */
export function choiceErrors(
	preview: MovePreview,
	choices: MoveChoices,
	hadDependencies: boolean
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (preview.conflicts.project !== null && choices.project === null) {
		errors.project = 'Bitte ein Projekt im Ziel oder „Ohne Projekt“ wählen.';
	}
	if (hadDependencies && choices.dependencies === null) {
		errors.dependencies = 'Bitte „Mitnehmen“ oder „Verknüpfung lösen“ wählen.';
	}
	const chosen = preview.conflicts.codes.map((entry) =>
		normalizeCode(choices.codes[entry.id] ?? '')
	);
	preview.conflicts.codes.forEach((entry, index) => {
		const code = chosen[index] ?? '';
		if (!CODE_PATTERN.test(code) || code === 'TASK' || code === entry.code) {
			errors[`code:${entry.id}`] =
				'Bitte 2 bis 6 Großbuchstaben, nicht TASK, nicht der bisherige Code.';
		} else if (chosen.indexOf(code) !== index) {
			errors[`code:${entry.id}`] = 'Diesen Code hat schon ein anderes verschobenes Projekt.';
		}
	});
	return errors;
}

/** The body of the route for the records, the direction and the choices made so far. */
export function moveBody(
	request: { kind: MoveKind; ids: readonly string[]; to: MoveDirection },
	choices: MoveChoices,
	preview: boolean
): Record<string, unknown> {
	const codes: Record<string, string> = {};
	for (const [id, code] of Object.entries(choices.codes)) codes[id] = normalizeCode(code);
	return {
		kind: request.kind,
		ids: [...request.ids],
		to: request.to,
		...(preview && { preview: true }),
		...(choices.project !== null && { project: choices.project }),
		...(choices.dependencies !== null && { dependencies: choices.dependencies }),
		...(Object.keys(codes).length > 0 && { codes })
	};
}

/**
 * The history entry of a moved ticket (field `area_move`, ADR-0060 §3): the old key is the old value,
 * the new value JSON with the direction and what else changed. E.g. "In den Haushalt verschoben
 * (vorher PRIV-12); Projekt: Haus → –".
 */
export function areaMoveHistoryText(oldValue: string, newValue: string): string {
	let value: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(newValue);
		if (isRecord(parsed)) value = parsed;
	} catch {
		// An unreadable value: only the direction is unknown.
	}
	let verb = value.to === 'household' ? 'In den Haushalt verschoben' : 'Ins Private verschoben';
	if (value.dissolved === true) verb = 'Aus dem aufgelösten Haushalt ins Private übernommen';
	const parts = [oldValue === '' ? verb : `${verb} (vorher ${oldValue})`];
	if (isRecord(value.project)) {
		const from = text(value.project.from) || '–';
		const to = text(value.project.to) || '–';
		parts.push(`Projekt: ${from} → ${to}`);
	}
	if (text(value.parent) !== '')
		parts.push(`übergeordnetes Ticket ${text(value.parent)} blieb zurück`);
	if (value.series === true) parts.push('aus der Wiederholung gelöst');
	return parts.join('; ');
}

// --- Dissolving a household ------------------------------------------------------------------------

/** The answer of POST /api/byl/household/dissolve (preview and done). */
export interface DissolvePreview {
	preview: boolean;
	mode: DissolveMode;
	household: { id: string; name: string };
	members: { name: string; role: 'owner' | 'member'; self: boolean }[];
	counts: {
		tickets: number;
		trash: number;
		projects: number;
		rules: number;
		items: number;
		tags: number;
		connections: number;
		comments: number;
	};
	codes: (NamedProject & { suggestion: string })[];
}

/** The answer of the route, or null for anything else. */
export function parseDissolvePreview(value: unknown): DissolvePreview | null {
	if (!isRecord(value) || !isRecord(value.household) || !isRecord(value.counts)) return null;
	const mode = value.mode === 'adopt' || value.mode === 'delete' ? value.mode : null;
	const id = text(value.household.id);
	const members = listOf(value.members, (entry) => ({
		name: text(entry.name),
		role: entry.role === 'owner' ? ('owner' as const) : ('member' as const),
		self: entry.self === true
	}));
	const codes = listOf(value.codes ?? [], (entry) => {
		const base = named(entry);
		return base === null ? null : { ...base, suggestion: text(entry.suggestion) };
	});
	if (mode === null || id === '' || members === null || codes === null) return null;
	const counts = value.counts;
	return {
		preview: value.preview === true,
		mode,
		household: { id, name: text(value.household.name) },
		members,
		counts: {
			tickets: count(counts.tickets),
			trash: count(counts.trash),
			projects: count(counts.projects),
			rules: count(counts.rules),
			items: count(counts.items),
			tags: count(counts.tags),
			connections: count(counts.connections),
			comments: count(counts.comments)
		},
		codes
	};
}

/** What the household holds, one line per kind with at least one. */
export function dissolveCountLines(counts: DissolvePreview['counts']): string[] {
	const lines: string[] = [];
	const add = (n: number, one: string, many: string) => {
		if (n > 0) lines.push(plural(n, one, many));
	};
	add(counts.tickets, 'Ticket', 'Tickets');
	add(counts.trash, 'Ticket im Papierkorb', 'Tickets im Papierkorb');
	add(counts.projects, 'Projekt', 'Projekte');
	add(counts.rules, 'Wiederholung', 'Wiederholungen');
	add(counts.items, 'Eintrag im Eingang', 'Einträge im Eingang');
	add(counts.tags, 'Tag', 'Tags');
	add(counts.connections, 'Verbindung', 'Verbindungen');
	add(counts.comments, 'Kommentar', 'Kommentare');
	return lines;
}

/** Whether the typed name confirms deleting the household (white space at the ends aside), like the hook. */
export function nameConfirmed(typed: string, name: string): boolean {
	const trimmed = typed.trim();
	return trimmed !== '' && trimmed === name.trim();
}

/** Words of "Haushalt auflösen" (page "Einstellungen → Haushalt"). */
export const DISSOLVE_TEXTS = Object.freeze({
	section: 'Haushalt auflösen',
	sectionText:
		'Nur der Inhaber kann den Haushalt auflösen. Danach gibt es ihn nicht mehr: Mitgliedschaften und Einladungscodes gehen, und alle Mitglieder sind wieder im Bereich Privat.',
	button: 'Haushalt auflösen …',
	title: (name: string) => `Haushalt „${name}“ auflösen`,
	holds: 'Der Haushalt enthält',
	nothing: 'Der Haushalt ist leer.',
	members: 'Mitglieder',
	modeLegend: 'Was passiert mit den Einträgen?',
	adopt: 'Alles in meinen privaten Bereich übernehmen',
	adoptHint:
		'Tickets, Projekte, Wiederholungen, Einträge und der Papierkorb kommen in deinen Bereich Privat, mit neuen Nummern; die alten stehen im Verlauf. Tags werden nach Namen zugeordnet.',
	codes: 'Diese Projekt-Codes gibt es bei dir schon; sie bekommen ein Suffix:',
	remove: 'Alles endgültig löschen',
	removeHint:
		'Alle Einträge des Haushalts werden endgültig gelöscht, auch der Papierkorb. Das lässt sich nicht rückgängig machen.',
	nameLabel: (name: string) => `Zum Bestätigen den Namen „${name}“ eintippen`,
	nameError: 'Der Name stimmt nicht.',
	confirm: { adopt: 'Auflösen und übernehmen', delete: 'Auflösen und löschen' },
	running: 'Wird aufgelöst …',
	done: (name: string) => `Haushalt „${name}“ aufgelöst.`,
	doneAdopt: 'Alle Einträge sind jetzt in deinem Bereich Privat.',
	doneDelete: 'Alle Einträge des Haushalts sind gelöscht.',
	dissolved: (name: string) => `Der Haushalt „${name}“ wurde aufgelöst.`
});
