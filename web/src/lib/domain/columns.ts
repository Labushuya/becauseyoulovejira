// Columns of the tables (ADR-0030): width, showing and hiding, and the fit into the frame. Pure.
//
// The tables ("Aufgaben", "Eingang", "Projekte", "Wiederholungen", since ADR-0037 "Papierkorb")
// never scroll sideways (ADR-0025 section 11). Until ADR-0030 container queries with fixed thresholds hid columns; they
// knew nothing of a width the user dragged. Now `fitColumns` decides from the width of the frame,
// the specs below and the preferences of the device which columns are shown and how wide they are.
// Widths are CSS pixels of the whole column (cell padding included), as `<col>` of a table with
// `table-layout: fixed` takes them. One column per table is flexible and takes the rest; since
// ADR-0030 Nachtrag 3 the user may give it a width of its own, see `fitColumns` and
// `resizeColumn`.

/** The tables with their own column preferences. */
export type TableId = 'tickets' | 'inbox' | 'projects' | 'recurrences' | 'trash';

export interface ColumnSpec {
	/** Name in code, also `data-col` in the markup. */
	readonly id: string;
	/** Name in the menu "Spalten" and in the announcements. */
	readonly label: string;
	/** Always shown; not in the menu "Spalten". */
	readonly required: boolean;
	/**
	 * Takes the rest of the width (the title); exactly one per table. A width the user chose for it
	 * is a target: the rest beyond it goes to the other columns (ADR-0030 Nachtrag 3).
	 */
	readonly flexible: boolean;
	/** Default width; for the flexible column its minimum (it has no default: it takes the rest). */
	readonly width: number;
	readonly min: number;
	readonly max: number;
	/**
	 * Place in the order in which columns give way when space runs out (1 first); null: the column
	 * never gives way on its own (it can still be switched off in the menu unless required).
	 */
	readonly hideRank: number | null;
	/** Off until the user switches it on (e.g. "Quelle"). */
	readonly hiddenByDefault: boolean;
	/**
	 * Came after preferences were stored on devices (e.g. "Übergeordnet", ADR-0033): it counts as
	 * shown only when the stored preferences list it under `shown`. A list `hidden` written before
	 * the column existed does not name it, and must not switch it on.
	 */
	readonly optIn?: boolean;
}

/** A switch of a table beside its columns, e.g. "Unteraufgaben einrücken" (ADR-0033 section 5). */
export interface TableOption {
	readonly id: string;
	/** Name in the menu "Spalten". */
	readonly label: string;
	readonly default: boolean;
}

export interface TableSpec {
	readonly id: TableId;
	/** Key in localStorage, one per table. */
	readonly storageKey: string;
	/** Columns in the order of the table. */
	readonly columns: readonly ColumnSpec[];
	/** Switches of the table, stored with the columns. */
	readonly options: readonly TableOption[];
}

/** CSS pixels of 1rem at the default font size; widths in the specs are written in rem. */
export const REM = 16;

/** Step of "schmaler" and "breiter" in the menu "Spalten": 1rem. */
export const WIDTH_STEP = REM;

/** Version of the stored preferences; another version counts as "not set". */
export const COLUMN_PREFS_VERSION = 1;

/** Prefix of the keys in localStorage (`byl-columns-tickets` …). */
export const COLUMN_PREFS_PREFIX = 'byl-columns-';

interface ColumnOptions {
	width: number;
	min: number;
	max: number;
	required?: boolean;
	hideRank?: number | null;
	hiddenByDefault?: boolean;
	optIn?: boolean;
}

/** A column with its widths in rem. */
function column(id: string, label: string, options: ColumnOptions): ColumnSpec {
	return Object.freeze({
		id,
		label,
		required: options.required ?? false,
		flexible: false,
		width: options.width * REM,
		min: options.min * REM,
		max: options.max * REM,
		hideRank: options.hideRank ?? null,
		hiddenByDefault: options.hiddenByDefault ?? false,
		...(options.optIn && { optIn: true })
	});
}

/** A column of fixed width that is always there (check mark, actions). */
function fixed(id: string, label: string, width: number): ColumnSpec {
	return column(id, label, { width, min: width, max: width, required: true });
}

/** Upper bound of a width the user gives the flexible column: 60rem (ADR-0030 Nachtrag 3). */
const FLEXIBLE_MAX_REM = 60;

/** The flexible column with its minimum in rem; it is always there. */
function flexible(id: string, label: string, min: number): ColumnSpec {
	return Object.freeze({
		...column(id, label, { width: min, min, max: FLEXIBLE_MAX_REM }),
		required: true,
		flexible: true
	});
}

function table(
	id: TableId,
	columns: readonly ColumnSpec[],
	options: readonly TableOption[] = []
): TableSpec {
	return Object.freeze({
		id,
		storageKey: `${COLUMN_PREFS_PREFIX}${id}`,
		columns: Object.freeze([...columns]),
		options: Object.freeze(options.map((option) => Object.freeze({ ...option })))
	});
}

/** "Unteraufgaben einrücken" of the tickets (ADR-0033 section 5), on by default. */
export const NEST_SUBTASKS = 'nest';

/**
 * "Aufgaben": Key, Prio, Status, Titel, Übergeordnet, Quelle, Projekt, Tags, Fällig, Erstellt,
 * actions. Space runs out: Erstellt, Tags, Projekt, Fällig give way in this order (ADR-0025
 * section 11); the columns "Übergeordnet" (ADR-0033 section 5) and "Quelle" (ADR-0019 section 4),
 * both off by default, go before them. Prio and Status never give way on their own but can be
 * switched off, as in Jira. The switch "Unteraufgaben einrücken" is stored with the columns. The
 * selection (plan BI-2, ADR-0036 §2) comes first, fixed and always shown like in "Eingang".
 */
export const TICKET_TABLE: TableSpec = table(
	'tickets',
	[
		fixed('select', 'Auswahl', 2.5),
		// Up to 12rem, so "ABCDEF-1000000" with the dot "neu" fits (KN-1, ADR-0030 Nachtrag 7).
		column('key', 'Key', { width: 6, min: 4, max: 12, required: true }),
		column('priority', 'Prio', { width: 4, min: 3, max: 6 }),
		column('status', 'Status', { width: 6.5, min: 4.5, max: 10 }),
		flexible('title', 'Titel', 10),
		column('parent', 'Übergeordnet', {
			width: 7,
			min: 5,
			max: 12,
			hideRank: 0,
			hiddenByDefault: true,
			optIn: true
		}),
		column('source', 'Quelle', { width: 7, min: 4, max: 12, hideRank: 0, hiddenByDefault: true }),
		column('project', 'Projekt', { width: 8, min: 4, max: 16, hideRank: 3 }),
		column('tags', 'Tags', { width: 8, min: 4, max: 20, hideRank: 2 }),
		column('due', 'Fällig', { width: 8, min: 5, max: 12, hideRank: 4 }),
		column('created', 'Erstellt', { width: 6, min: 5, max: 9, hideRank: 1 }),
		// Check mark, "Öffnen" and the menu "•••" of the row (plan aktionsmenues, AM-2).
		fixed('actions', 'Aktionen', 5.5)
	],
	[{ id: NEST_SUBTASKS, label: 'Unteraufgaben einrücken', default: true }]
);

/**
 * "Eingang": selection (only for new entries), Art, Titel, Quelle, Zielprojekt, Quelldatum,
 * arrival, actions. The arrival (or handling) date gives way first, then Quelle, Art and
 * Quelldatum. The actions hold "Umwandeln" and "Verwerfen" (or what a handled entry offers) and
 * since AM-4 the menu "•••": 15rem instead of 13 (ADR-0030, Nachtrag 5). "Zielprojekt" (ADR-0049
 * §5) came later: off by default (`optIn`) and the first to give way, so the thresholds stay.
 */
export const INBOX_TABLE: TableSpec = table('inbox', [
	fixed('select', 'Auswahl', 2.5),
	column('kind', 'Art', { width: 6, min: 4, max: 10, hideRank: 3 }),
	flexible('title', 'Titel', 10),
	column('source', 'Quelle', { width: 7, min: 4, max: 12, hideRank: 2 }),
	column('target', 'Zielprojekt', {
		width: 8,
		min: 4,
		max: 16,
		hideRank: 0,
		hiddenByDefault: true,
		optIn: true
	}),
	column('source-date', 'Quelldatum', { width: 6, min: 5, max: 9, hideRank: 4 }),
	column('arrival', 'Eingang', { width: 6, min: 5, max: 9, hideRank: 1 }),
	fixed('actions', 'Aktionen', 15)
]);

/**
 * "Projekte": Code, Name, aktiv, gesamt, neu, archiviert, actions; the numbers give way from the
 * right. The actions are the menu "•••" of the row since AM-4 (ADR-0030, Nachtrag 5).
 */
export const PROJECT_TABLE: TableSpec = table('projects', [
	column('code', 'Code', { width: 6, min: 4, max: 8, required: true }),
	flexible('name', 'Name', 10),
	column('active', 'aktiv', { width: 5, min: 4, max: 7, hideRank: 4 }),
	column('total', 'gesamt', { width: 5.5, min: 4, max: 8, hideRank: 3 }),
	column('new', 'neu', { width: 5, min: 3.5, max: 7, hideRank: 2 }),
	column('archived', 'archiviert', { width: 6.5, min: 5, max: 9, hideRank: 1 }),
	fixed('actions', 'Aktionen', 3.5)
]);

/**
 * "Wiederholungen": Titel, Rhythmus, Nächstes Ticket, Offene Tickets, Projekt, Zustand, actions
 * (since AM-4 the menu "•••" instead of the symbol "Pausieren", in the same 3.5rem). Projekt gives
 * way first, then Offene Tickets, Nächstes Ticket and Rhythmus. "Offene Tickets" may hold several
 * keys and grows further (plan "Wiederholungen verständlich machen", recommendation 7).
 */
export const RECURRENCE_TABLE: TableSpec = table('recurrences', [
	flexible('title', 'Titel', 10),
	column('rhythm', 'Rhythmus', { width: 10, min: 6, max: 20, hideRank: 4 }),
	column('next', 'Nächstes Ticket', { width: 7, min: 5.5, max: 10, hideRank: 3 }),
	column('open', 'Offene Tickets', { width: 7, min: 5, max: 16, hideRank: 2 }),
	column('project', 'Projekt', { width: 9, min: 5, max: 16, hideRank: 1 }),
	column('state', 'Zustand', { width: 7, min: 6, max: 9, required: true }),
	fixed('actions', 'Aktionen', 3.5)
]);

/**
 * "Papierkorb" (ADR-0037): selection, Key, Titel, Status (with "Blockiert (N)", ADR-0047),
 * Projekt, Gelöscht am, Von, the days until it is deleted for good, actions ("Wiederherstellen"
 * and since AM-4 the menu "•••" with "Endgültig löschen …", in the same 5rem). "Von" gives way
 * first, then the date, Projekt, the days and the status.
 */
export const TRASH_TABLE: TableSpec = table('trash', [
	fixed('select', 'Auswahl', 2.5),
	column('key', 'Key', { width: 6, min: 4, max: 12, required: true }),
	flexible('title', 'Titel', 10),
	// Status and "Blockiert (N)" (ADR-0047): gives way last.
	column('status', 'Status', { width: 9, min: 6, max: 14, hideRank: 5 }),
	column('project', 'Projekt', { width: 8, min: 4, max: 16, hideRank: 3 }),
	column('deleted', 'Gelöscht am', { width: 7, min: 5.5, max: 10, hideRank: 2 }),
	column('by', 'Von', { width: 6, min: 4, max: 10, hideRank: 1 }),
	column('left', 'Endgültig gelöscht', { width: 8.5, min: 6, max: 11, hideRank: 4 }),
	fixed('actions', 'Aktionen', 5)
]);

export const TABLES: Readonly<Record<TableId, TableSpec>> = Object.freeze({
	tickets: TICKET_TABLE,
	inbox: INBOX_TABLE,
	projects: PROJECT_TABLE,
	recurrences: RECURRENCE_TABLE,
	trash: TRASH_TABLE
});

/**
 * Whether the user can change the width of the column (by dragging or in the menu); since ADR-0030
 * Nachtrag 3 also the flexible one.
 */
export function isResizable(column: ColumnSpec): boolean {
	return column.max > column.min;
}

/**
 * Columns the menu "Spalten" lists, in the order of the table: every column that is not required,
 * and the flexible one for its width (ADR-0030 Nachtrag 3).
 */
export function menuColumns(columns: readonly ColumnSpec[]): ColumnSpec[] {
	return columns.filter((entry) => !entry.required || entry.flexible);
}

/** A width for people: "8 rem", "8,5 rem" (half steps; a dragged width is rounded). */
export function formatRem(px: number): string {
	const rem = Math.round((px / REM) * 2) / 2;
	return `${String(rem).replace('.', ',')} rem`;
}

/** `px` within the bounds of the column, in whole pixels. */
export function clampWidth(column: ColumnSpec, px: number): number {
	return Math.round(Math.min(Math.max(px, column.min), column.max));
}

/** Preferences of one table on this device (ADR-0030). */
export interface ColumnPrefs {
	/** Widths the user chose, only resizable columns, clamped. */
	readonly widths: Readonly<Record<string, number>>;
	/** Columns the user switched off, only optional ones, in the order of the table. */
	readonly hidden: readonly string[];
	/**
	 * Switches of the table the user set against their default (ADR-0033 section 5); missing when
	 * all have their default.
	 */
	readonly options?: Readonly<Record<string, boolean>>;
}

/** Value of a switch: the chosen one, else its default. */
export function optionValue(prefs: ColumnPrefs, option: TableOption): boolean {
	return prefs.options?.[option.id] ?? option.default;
}

/**
 * The switches that differ from their default, or undefined for none, so preferences without a
 * changed switch keep their shape `{ widths, hidden }`.
 */
export function changedOptions(
	values: Readonly<Record<string, unknown>>,
	options: readonly TableOption[]
): Readonly<Record<string, boolean>> | undefined {
	const changed: Record<string, boolean> = {};
	for (const option of options) {
		const value = values[option.id];
		if (typeof value === 'boolean' && value !== option.default) changed[option.id] = value;
	}
	return Object.keys(changed).length === 0 ? undefined : changed;
}

/** Nothing chosen: default widths, only the columns that are off by default are hidden. */
export function defaultColumnPrefs(columns: readonly ColumnSpec[]): ColumnPrefs {
	return {
		widths: {},
		hidden: columns
			.filter((entry) => !entry.required && entry.hiddenByDefault)
			.map((entry) => entry.id)
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the stored preferences strictly: broken JSON, another version or no object mean the
 * defaults; unknown columns, required ones in `hidden`, and widths that are no positive finite
 * number count as not set. Valid widths are clamped to the bounds of their column. A column that
 * came later (`optIn`) is shown only when `shown` names it. Switches of the table (`options`)
 * count only with a known name and a boolean value.
 */
export function parseColumnPrefs(
	raw: string | null | undefined,
	columns: readonly ColumnSpec[],
	options: readonly TableOption[] = []
): ColumnPrefs {
	const defaults = defaultColumnPrefs(columns);
	if (typeof raw !== 'string' || raw === '') return defaults;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return defaults;
	}
	if (!isRecord(data) || data.v !== COLUMN_PREFS_VERSION) return defaults;

	const widths: Record<string, number> = {};
	if (isRecord(data.widths)) {
		for (const entry of columns) {
			const value = data.widths[entry.id];
			if (!isResizable(entry) || !Object.hasOwn(data.widths, entry.id)) continue;
			if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
			widths[entry.id] = clampWidth(entry, value);
		}
	}

	let hidden = defaults.hidden;
	if (Array.isArray(data.hidden)) {
		const listed = new Set(
			data.hidden.filter((value): value is string => typeof value === 'string')
		);
		// A column that came later is shown only when `shown` names it (ColumnSpec.optIn).
		const shown = Array.isArray(data.shown) ? data.shown : [];
		hidden = columns
			.filter(
				(entry) =>
					!entry.required &&
					(listed.has(entry.id) || (entry.optIn === true && !shown.includes(entry.id)))
			)
			.map((entry) => entry.id);
	}
	const changed = isRecord(data.options) ? changedOptions(data.options, options) : undefined;
	return changed === undefined ? { widths, hidden } : { widths, hidden, options: changed };
}

/**
 * The stored form: `{ "v": 1, "widths": { … }, "hidden": [ … ] }`, with `"shown": [ … ]` for
 * shown columns that came later (needs `columns`) and `"options": { … }` when a switch differs
 * from its default.
 */
export function serializeColumnPrefs(
	prefs: ColumnPrefs,
	columns: readonly ColumnSpec[] = []
): string {
	const options = prefs.options && Object.keys(prefs.options).length > 0 ? prefs.options : null;
	// Columns that came later (optIn) are named when shown, so older lists cannot switch them on.
	const shown = columns
		.filter((entry) => entry.optIn === true && !prefs.hidden.includes(entry.id))
		.map((entry) => entry.id);
	return JSON.stringify({
		v: COLUMN_PREFS_VERSION,
		widths: prefs.widths,
		hidden: prefs.hidden,
		...(shown.length > 0 && { shown }),
		...(options && { options })
	});
}

/** Whether `prefs` equal the defaults (then nothing needs to be stored). */
export function isDefaultColumnPrefs(prefs: ColumnPrefs, columns: readonly ColumnSpec[]): boolean {
	const defaults = defaultColumnPrefs(columns);
	return (
		Object.keys(prefs.widths).length === 0 &&
		prefs.hidden.length === defaults.hidden.length &&
		prefs.hidden.every((id) => defaults.hidden.includes(id)) &&
		Object.keys(prefs.options ?? {}).length === 0
	);
}

/** Width of a column from the preferences, else its default; always within its bounds. */
export function columnWidth(column: ColumnSpec, prefs: ColumnPrefs): number {
	return clampWidth(column, prefs.widths[column.id] ?? column.width);
}

// Columns of keys (KN-1, ADR-0030 Nachtrag 7). Numbers of tickets have no upper bound, so a key
// grows with its number ("HAUS-9", "HAUS-1000000"). Keys stand in JetBrains Mono at
// --font-size-control (0.8125rem); every glyph of the font advances 0.6em, one `ch`, so a key needs
// its length in `ch`.

/** Font size of the keys in the tables in rem (--font-size-control). */
const KEY_FONT_REM = 0.8125;
/** Advance of every glyph of the mono font in em: 1ch. */
const MONO_CH_EM = 0.6;
/** Padding of a cell, left plus right (0.75rem each). */
const KEY_CELL_PADDING_REM = 1.5;
/** The dot "neu" before a key (0.5rem) and its gap (0.375rem), ADR-0015 section 5. */
const NEW_DOT_REM = 0.875;
/** Room for rounding and the smoothing of the font. */
const KEY_SLACK_PX = 2;

/** The widest default a column of keys takes on its own: 12rem; wider only by the user. */
export const KEY_AUTO_MAX = 12 * REM;

/**
 * Width of a cell that shows `key` uncut, in CSS pixels: the key in `ch`, the padding and, with
 * `dot`, the dot "neu". `rem`: pixels of 1rem on the page.
 */
export function keyCellWidth(key: string, dot = false, rem = REM): number {
	const text = key.length * KEY_FONT_REM * MONO_CH_EM * rem;
	const extra = KEY_CELL_PADDING_REM * rem + (dot ? NEW_DOT_REM * rem : 0);
	return Math.ceil(text + extra + KEY_SLACK_PX);
}

/**
 * Whether `key` (with the dot "neu" for `dot`) is cut off in a cell of `width` CSS pixels, e.g.
 * after the user dragged the column narrow; then the cell names the whole key in its `title`.
 */
export function isKeyCut(key: string, width: number, dot = false, rem = REM): boolean {
	return keyCellWidth(key, dot, rem) > width;
}

/** A column of keys and the keys of the list it shows right now. */
export interface KeyColumn {
	readonly id: string;
	readonly keys: Iterable<string>;
	/** Room for the dot "neu" before the key, so a ticket that becomes new never cuts its key. */
	readonly dot?: boolean;
}

/**
 * The columns with the default width of each column of keys fitted to the longest key it shows
 * (`keyCellWidth`): never narrower than the default of the column (short keys look as before and
 * the thresholds of ADR-0030 stay), never wider than `KEY_AUTO_MAX` and its maximum. A width the
 * user chose still wins (`columnWidth`), and "Standard wiederherstellen" brings this default back.
 * Without a change the very same `columns` come back.
 */
export function withKeyDefaults(
	columns: readonly ColumnSpec[],
	keyColumns: readonly KeyColumn[],
	rem = REM
): readonly ColumnSpec[] {
	const needs = new Map<string, number>();
	for (const entry of keyColumns) {
		let longest = '';
		for (const key of entry.keys) if (key.length > longest.length) longest = key;
		if (longest !== '') needs.set(entry.id, keyCellWidth(longest, entry.dot ?? false, rem));
	}
	let changed = false;
	const fitted = columns.map((column) => {
		const need = needs.get(column.id);
		if (need === undefined || need <= column.width) return column;
		changed = true;
		const width = Math.max(column.width, Math.min(need, column.max, KEY_AUTO_MAX));
		return Object.freeze({ ...column, width });
	});
	return changed ? fitted : columns;
}

/**
 * Width the user chose for the flexible column (ADR-0030 Nachtrag 3), or null: it takes the
 * rest, as before. Older preferences never hold one.
 */
export function flexibleTarget(columns: readonly ColumnSpec[], prefs: ColumnPrefs): number | null {
	const flex = columns.find((entry) => entry.flexible);
	if (flex === undefined || prefs.widths[flex.id] === undefined) return null;
	return columnWidth(flex, prefs);
}

/** What `fitColumns` decided. */
export interface ColumnFit {
	/** Shown columns in the order of the table. */
	readonly visible: readonly string[];
	/** Columns hidden for lack of space, in the order in which they gave way. */
	readonly autoHidden: readonly string[];
	/** Width of every shown column that is not flexible. */
	readonly widths: Readonly<Record<string, number>>;
	/** Width left for the flexible column; null while the frame was not measured. */
	readonly flexWidth: number | null;
}

/**
 * Fits the columns into a frame of `available` CSS pixels (ADR-0030):
 * 1. Every column the user did not switch off; required ones always.
 * 2. Width from the preferences or the default, clamped to the bounds of the column.
 * 3. While the columns plus the minimum of the flexible one do not fit, columns give way in the
 *    order of `hideRank`. The widths of the user stay stored.
 * 4. If it still does not fit, the widths shrink evenly towards their minimum, only then the
 *    flexible column below its minimum, and as a last resort every column in proportion. The sum
 *    of the widths never exceeds `available`.
 * 5. With a width chosen for the flexible column (Nachtrag 3) it gets at most that width: the rest
 *    beyond it goes evenly to the other shown columns up to their maximum, what is left after that
 *    back to the flexible column. With less room than chosen the flexible column gives way first,
 *    as in 3 and 4, so the choice never hides a column.
 * Without a measured frame (`available` null or 0, e.g. before the first layout or in jsdom) no
 * column gives way.
 */
export function fitColumns(
	available: number | null,
	columns: readonly ColumnSpec[],
	prefs: ColumnPrefs
): ColumnFit {
	const hidden = new Set(prefs.hidden);
	const shown = columns.filter((entry) => entry.required || !hidden.has(entry.id));
	const widths = new Map(
		shown.filter((entry) => !entry.flexible).map((entry) => [entry.id, columnWidth(entry, prefs)])
	);
	const flexMin = shown.find((entry) => entry.flexible)?.min ?? 0;

	if (!isMeasured(available)) {
		return {
			visible: shown.map((entry) => entry.id),
			autoHidden: [],
			widths: Object.fromEntries(widths),
			flexWidth: null
		};
	}

	const sum = () => [...widths.values()].reduce((total, width) => total + width, 0);
	const autoHidden: string[] = [];
	const candidates = shown
		.filter((entry) => entry.hideRank !== null)
		.sort((a, b) => (a.hideRank ?? 0) - (b.hideRank ?? 0));
	for (const candidate of candidates) {
		if (sum() + flexMin <= available) break;
		widths.delete(candidate.id);
		autoHidden.push(candidate.id);
	}

	const specs = new Map(shown.map((entry) => [entry.id, entry]));
	let excess = sum() + flexMin - available;
	if (excess > 0) {
		// Shrink evenly towards the minimum of every column.
		const room = [...widths].reduce(
			(total, [id, width]) => total + width - (specs.get(id)?.min ?? width),
			0
		);
		const share = room > 0 ? Math.min(1, excess / room) : 0;
		for (const [id, width] of widths) {
			const min = specs.get(id)?.min ?? width;
			widths.set(id, Math.floor(width - (width - min) * share));
		}
		excess = sum() - available;
		if (excess > 0) {
			// Even the minimums do not fit: every column in proportion, the flexible one gets nothing.
			const total = sum();
			for (const [id, width] of widths) widths.set(id, Math.floor((width * available) / total));
		}
	}

	// A chosen width of the flexible column: the rest beyond it widens the others evenly.
	const target = flexibleTarget(shown, prefs);
	const surplus = target === null ? 0 : available - sum() - target;
	if (surplus > 0) {
		const roomOf = (id: string, width: number) => (specs.get(id)?.max ?? width) - width;
		const room = [...widths].reduce((total, [id, width]) => total + roomOf(id, width), 0);
		const share = room > 0 ? Math.min(1, surplus / room) : 0;
		let left = Math.floor(Math.min(surplus, room));
		for (const [id, width] of widths) {
			const grow = Math.floor(roomOf(id, width) * share);
			widths.set(id, width + grow);
			left -= grow;
		}
		// The pixels lost to rounding, one each in the order of the table: the title keeps its width.
		for (const [id, width] of widths) {
			if (left <= 0) break;
			if (roomOf(id, width) < 1) continue;
			widths.set(id, width + 1);
			left -= 1;
		}
	}

	return {
		visible: shown.filter((entry) => !autoHidden.includes(entry.id)).map((entry) => entry.id),
		autoHidden,
		widths: Object.fromEntries(widths),
		flexWidth: Math.max(0, Math.floor(available - sum()))
	};
}

function isMeasured(available: number | null): available is number {
	return available !== null && Number.isFinite(available) && available > 0;
}

/** Shown columns besides the flexible one with the width of their own (not the fitted one). */
function ownWidths(
	available: number,
	columns: readonly ColumnSpec[],
	prefs: ColumnPrefs
): [ColumnSpec, number][] {
	const visible = new Set(fitColumns(available, columns, prefs).visible);
	return columns
		.filter((entry) => !entry.flexible && visible.has(entry.id))
		.map((entry) => [entry, columnWidth(entry, prefs)]);
}

/**
 * How narrow and how wide the user can make the flexible column (ADR-0030 Nachtrag 3): at least
 * its minimum, and not so narrow that the others would pass their maximum; at most its maximum,
 * and not so wide that the others would pass their minimum (then the grip stops; it never hides a
 * column). Without a measured frame just the bounds of the column.
 */
export function flexibleBounds(
	available: number | null,
	columns: readonly ColumnSpec[],
	prefs: ColumnPrefs
): { min: number; max: number } {
	const flex = columns.find((entry) => entry.flexible);
	if (flex === undefined) return { min: 0, max: 0 };
	if (!isMeasured(available)) return { min: flex.min, max: flex.max };
	const own = ownWidths(available, columns, prefs);
	const rest = available - own.reduce((total, [, width]) => total + width, 0);
	const roomDown = own.reduce((total, [entry, width]) => total + width - entry.min, 0);
	const roomUp = own.reduce((total, [entry, width]) => total + entry.max - width, 0);
	const max = Math.floor(Math.min(flex.max, Math.max(flex.min, rest + roomDown)));
	const min = Math.ceil(Math.min(max, Math.max(flex.min, rest - roomUp)));
	return { min, max };
}

/**
 * The preferences after the user set the width of column `id` to `width` by grip, menu or double
 * click (ADR-0030 section 3 and Nachtrag 3):
 * - The flexible column gets `width` within `flexibleBounds` as its chosen width. Wider than the
 *   rest, the other shown columns shrink evenly towards their minimum by the missing room, and
 *   keep that width.
 * - Another column gets `width` within its bounds. While the flexible column has a chosen width,
 *   the shown columns keep the width they are shown with and the flexible one gives or takes the
 *   difference, as it did before it had a width; so nothing else moves.
 * Without a measured frame only the width of `id` changes.
 */
export function resizeColumn(
	available: number | null,
	columns: readonly ColumnSpec[],
	prefs: ColumnPrefs,
	id: string,
	width: number
): ColumnPrefs {
	const spec = columns.find((entry) => entry.id === id);
	if (spec === undefined || !isResizable(spec)) return prefs;
	const widths: Record<string, number> = { ...prefs.widths };

	if (spec.flexible) {
		const bounds = flexibleBounds(available, columns, prefs);
		const target = Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
		widths[id] = target;
		if (isMeasured(available)) {
			const own = ownWidths(available, columns, prefs);
			const missing = target - (available - own.reduce((total, [, px]) => total + px, 0));
			const room = own.reduce((total, [entry, px]) => total + px - entry.min, 0);
			if (missing > 0 && room > 0) {
				const share = Math.min(1, missing / room);
				for (const [entry, px] of own) {
					if (isResizable(entry)) widths[entry.id] = Math.floor(px - (px - entry.min) * share);
				}
			}
		}
		return { ...prefs, widths };
	}

	widths[id] = clampWidth(spec, width);
	const flex = columns.find((entry) => entry.flexible);
	if (flex !== undefined && flexibleTarget(columns, prefs) !== null && isMeasured(available)) {
		const fit = fitColumns(available, columns, prefs);
		if (fit.flexWidth !== null && fit.visible.includes(id)) {
			for (const shown of columns) {
				const px = fit.widths[shown.id];
				if (shown.id !== id && !shown.flexible && isResizable(shown) && px !== undefined) {
					widths[shown.id] = clampWidth(shown, px);
				}
			}
			const before = fit.widths[id] ?? columnWidth(spec, prefs);
			widths[flex.id] = clampWidth(flex, fit.flexWidth - (widths[id] - before));
		}
	}
	return { ...prefs, widths };
}

/** Width of a text in CSS pixels, e.g. through canvas; tests pass their own. */
export type MeasureText = (text: string) => number;

/** Rough width when nothing can be measured (jsdom): 0.6em per character. */
export function estimateTextWidth(text: string, fontSize: number): number {
	return text.length * fontSize * 0.6;
}

/** Text of the chip that stands for the tags left out. */
export function moreChipText(count: number): string {
	return `+${count}`;
}

/**
 * Which tag chips fit into one line of `available` pixels (ADR-0030, compact rows). `measure`
 * gives the width of a whole chip (text, padding, border), `gap` the space between two chips. If
 * not all fit, room is kept for the chip "+N". At least one chip is always shown; a single one
 * that is too long is shortened with an ellipsis by the stylesheet.
 */
export function fitChips(
	names: readonly string[],
	available: number,
	measure: MeasureText,
	gap = 4
): { shown: string[]; rest: string[] } {
	if (names.length === 0) return { shown: [], rest: [] };
	const widths = names.map((name) => measure(name));
	const lineOf = (count: number) =>
		widths.slice(0, count).reduce((total, width) => total + width, 0) +
		gap * Math.max(0, count - 1);
	if (lineOf(names.length) <= available) return { shown: [...names], rest: [] };
	for (let count = names.length - 1; count >= 1; count -= 1) {
		const more = measure(moreChipText(names.length - count));
		if (lineOf(count) + gap + more <= available) {
			return { shown: names.slice(0, count), rest: names.slice(count) };
		}
	}
	return { shown: names.slice(0, 1), rest: names.slice(1) };
}
