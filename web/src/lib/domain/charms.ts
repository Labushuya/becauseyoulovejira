// Charms (ADR-0062): a small symbol before the title of a ticket or of the template of a rule, like
// the charms of the Outlook calendar. One per ticket and one per rule, optional, from this fixed,
// curated catalog in groups. Pure: the catalog with key, German name, group, search words and
// symbol, the search of the dialog and the moves of its keys through the grid. The server knows
// only the keys (CHARM_KEYS of app/pb_hooks/lib/charms.js; tests/unit/web-charms.test.mjs keeps
// both and the texts equal) and refuses any other with `validation_charm_unknown`.

import type { CharmIconName } from './charm-icons';

/** The groups in the order of the dialog. */
export const CHARM_GROUPS = [
	'alltag',
	'haushalt',
	'gesundheit',
	'familie',
	'arbeit',
	'reise',
	'finanzen',
	'freizeit'
] as const;
export type CharmGroup = (typeof CHARM_GROUPS)[number];

export const CHARM_GROUP_LABELS: Readonly<Record<CharmGroup, string>> = Object.freeze({
	alltag: 'Alltag',
	haushalt: 'Haushalt',
	gesundheit: 'Gesundheit',
	familie: 'Familie',
	arbeit: 'Arbeit',
	reise: 'Reise',
	finanzen: 'Finanzen',
	freizeit: 'Freizeit'
});

/** One charm of the catalog. */
export interface CharmDefinition {
	/** Stored in `tickets.charm` and `recurrence_rules.charm`; never changes. */
	readonly key: string;
	/** German name: tooltip, screen readers, the trigger of the dialog and the history. */
	readonly name: string;
	readonly group: CharmGroup;
	/** Further words the search finds it by (lower case). */
	readonly keywords: readonly string[];
	/** Its symbol in charm-icons.ts. */
	readonly icon: CharmIconName;
}

const charm = (
	key: string,
	name: string,
	group: CharmGroup,
	icon: CharmIconName,
	keywords: readonly string[]
): CharmDefinition =>
	Object.freeze({ key, name, group, icon, keywords: Object.freeze([...keywords]) });

/** The catalog, by group in the order of CHARM_GROUPS. */
export const CHARMS: readonly CharmDefinition[] = Object.freeze([
	charm('einkaufen', 'Einkaufen', 'alltag', 'shopping-cart', [
		'einkauf',
		'supermarkt',
		'laden',
		'besorgen',
		'liste'
	]),
	charm('paket', 'Paket', 'alltag', 'package', [
		'post',
		'lieferung',
		'sendung',
		'versand',
		'abholen'
	]),
	charm('erinnerung', 'Erinnerung', 'alltag', 'alarm-clock', ['wecker', 'frist', 'uhr', 'zeit']),
	charm('idee', 'Idee', 'alltag', 'lightbulb', ['einfall', 'gedanke', 'notiz']),
	charm('behoerde', 'Behörde', 'alltag', 'landmark', [
		'amt',
		'rathaus',
		'antrag',
		'formular',
		'bank'
	]),
	charm('muell', 'Müll', 'haushalt', 'trash-2', [
		'abfall',
		'tonne',
		'mülltonne',
		'entsorgen',
		'recycling',
		'gelber sack'
	]),
	charm('putzen', 'Putzen', 'haushalt', 'spray-can', [
		'sauber',
		'reinigen',
		'staubsaugen',
		'fenster',
		'bad'
	]),
	charm('waesche', 'Wäsche', 'haushalt', 'washing-machine', [
		'waschen',
		'waschmaschine',
		'kleidung',
		'bügeln'
	]),
	charm('reparatur', 'Reparatur', 'haushalt', 'wrench', [
		'werkzeug',
		'handwerker',
		'reparieren',
		'heimwerken',
		'kaputt'
	]),
	charm('garten', 'Garten', 'haushalt', 'sprout', [
		'pflanzen',
		'gießen',
		'rasen',
		'blumen',
		'beet'
	]),
	charm('kochen', 'Kochen', 'haushalt', 'cooking-pot', ['rezept', 'küche', 'topf', 'mahlzeit']),
	charm('arzt', 'Arzt', 'gesundheit', 'stethoscope', [
		'ärztin',
		'praxis',
		'doktor',
		'vorsorge',
		'untersuchung'
	]),
	charm('medikament', 'Medikament', 'gesundheit', 'pill', [
		'tablette',
		'arznei',
		'apotheke',
		'medizin'
	]),
	charm('sport', 'Sport', 'gesundheit', 'dumbbell', ['training', 'fitness', 'hantel', 'workout']),
	charm('laufen', 'Laufen', 'gesundheit', 'footprints', [
		'joggen',
		'spaziergang',
		'gehen',
		'wandern',
		'schritte'
	]),
	charm('gesundheit', 'Gesundheit', 'gesundheit', 'heart-pulse', [
		'herz',
		'puls',
		'blutdruck',
		'wohlbefinden'
	]),
	charm('geburtstag', 'Geburtstag', 'familie', 'cake', ['torte', 'kuchen', 'jahrestag', 'feier']),
	charm('geschenk', 'Geschenk', 'familie', 'gift', ['überraschung', 'präsent', 'weihnachten']),
	charm('kind', 'Kind', 'familie', 'baby', ['baby', 'kinder', 'schule', 'kita', 'kindergarten']),
	charm('haustier', 'Haustier', 'familie', 'paw-print', [
		'hund',
		'katze',
		'tierarzt',
		'futter',
		'gassi'
	]),
	charm('familie', 'Familie', 'familie', 'users', ['eltern', 'besuch', 'verwandte', 'freunde']),
	charm('meeting', 'Meeting', 'arbeit', 'presentation', [
		'besprechung',
		'präsentation',
		'sitzung',
		'termin'
	]),
	charm('telefon', 'Telefon', 'arbeit', 'phone', ['anruf', 'anrufen', 'telefonat', 'zurückrufen']),
	charm('dokument', 'Dokument', 'arbeit', 'file-text', [
		'unterlagen',
		'vertrag',
		'papier',
		'formular'
	]),
	charm('mail', 'E-Mail', 'arbeit', 'mail', ['mail', 'nachricht', 'brief', 'antworten']),
	charm('computer', 'Computer', 'arbeit', 'laptop', [
		'laptop',
		'pc',
		'rechner',
		'software',
		'update'
	]),
	charm('flugzeug', 'Flugzeug', 'reise', 'plane', ['flug', 'fliegen', 'flughafen']),
	charm('zug', 'Zug', 'reise', 'train-front', ['bahn', 'bahnfahrt', 'fahrkarte']),
	charm('auto', 'Auto', 'reise', 'car', ['wagen', 'tüv', 'werkstatt', 'tanken', 'fahrt']),
	charm('koffer', 'Koffer', 'reise', 'luggage', ['packen', 'gepäck']),
	charm('urlaub', 'Urlaub', 'reise', 'tree-palm', ['ferien', 'strand', 'palme', 'erholung']),
	charm('rechnung', 'Rechnung', 'finanzen', 'receipt', [
		'bezahlen',
		'quittung',
		'beleg',
		'zahlung'
	]),
	charm('geld', 'Geld', 'finanzen', 'banknote', ['bargeld', 'überweisung', 'euro']),
	charm('karte', 'Karte', 'finanzen', 'credit-card', ['kreditkarte', 'bankkarte', 'ec-karte']),
	charm('sparen', 'Sparen', 'finanzen', 'piggy-bank', ['sparschwein', 'rücklage', 'budget']),
	charm('film', 'Film', 'freizeit', 'clapperboard', ['kino', 'serie', 'fernsehen', 'video']),
	charm('musik', 'Musik', 'freizeit', 'music', ['konzert', 'lied', 'instrument']),
	charm('buch', 'Buch', 'freizeit', 'book-open', ['lesen', 'bibliothek', 'roman', 'lernen']),
	charm('essen', 'Essen', 'freizeit', 'utensils', [
		'restaurant',
		'essen gehen',
		'abendessen',
		'mittagessen'
	]),
	charm('kaffee', 'Kaffee', 'freizeit', 'coffee', ['café', 'tee', 'treffen', 'pause']),
	charm('spiel', 'Spiel', 'freizeit', 'gamepad-2', ['spielen', 'konsole', 'gaming', 'brettspiel']),
	charm('feier', 'Feier', 'freizeit', 'party-popper', ['party', 'fest', 'feiern', 'silvester']),
	charm('fahrrad', 'Fahrrad', 'freizeit', 'bike', ['rad', 'radtour', 'radfahren'])
]);

/** Every key, in the order of the catalog (the allowlist of the server, ADR-0062). */
export const CHARM_KEYS: readonly string[] = Object.freeze(CHARMS.map((entry) => entry.key));

/** Texts of the codes of the server, the same as MESSAGES of app/pb_hooks/lib/charms.js. */
export const CHARM_MESSAGES = Object.freeze({
	validation_charm_unknown: 'Diesen Charm gibt es nicht. Bitte einen aus der Liste wählen.'
});

const BY_KEY: ReadonlyMap<string, CharmDefinition> = new Map(
	CHARMS.map((entry) => [entry.key, entry])
);

export function isCharmKey(value: unknown): value is string {
	return typeof value === 'string' && BY_KEY.has(value);
}

/** The charm of a stored value; null for none, '' and a key the catalog does not know. */
export function charmOf(value: string | null | undefined): CharmDefinition | null {
	return value ? (BY_KEY.get(value) ?? null) : null;
}

/** A stored value as the domain keeps it: a known key, else null (none). */
export function charmKeyOf(value: unknown): string | null {
	return isCharmKey(value) ? value : null;
}

/** "Charm: Geburtstag", the hidden text and the tooltip of a shown charm. */
export function charmText(entry: Pick<CharmDefinition, 'name'>): string {
	return `Charm: ${entry.name}`;
}

/** The name of a stored value for the history: '' for none, the key for an unknown one. */
export function charmName(value: string): string {
	if (value === '') return '';
	return charmOf(value)?.name ?? value;
}

/** Text without case, with umlauts once as "ue" and once as "u", so "muell" and "müll" find "Müll". */
function foldings(text: string): [string, string] {
	const lower = text.toLowerCase().replaceAll('ß', 'ss');
	const spelled = lower.replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue');
	const plain = lower.normalize('NFD').replace(/\p{Diacritic}/gu, '');
	return [spelled, plain];
}

/** Everything the search looks into: name, search words, group and key. */
function haystack(entry: CharmDefinition): [string, string] {
	const text = [entry.name, ...entry.keywords, CHARM_GROUP_LABELS[entry.group], entry.key].join(
		' '
	);
	return foldings(text);
}

const HAYSTACKS: ReadonlyMap<string, [string, string]> = new Map(
	CHARMS.map((entry) => [entry.key, haystack(entry)])
);

/**
 * The charms the search of the dialog shows for `query`, in the order of the catalog: every word of
 * the query (separated by spaces) is part of the name, a search word, the group or the key, in any
 * case and with or without umlauts. An empty query shows all.
 */
export function searchCharms(query: string): CharmDefinition[] {
	const words = query
		.trim()
		.split(/\s+/)
		.filter((word) => word !== '');
	if (words.length === 0) return [...CHARMS];
	const folded = words.map(foldings);
	return CHARMS.filter((entry) => {
		const [spelled, plain] = HAYSTACKS.get(entry.key) ?? ['', ''];
		return folded.every(([word, bare]) => spelled.includes(word) || plain.includes(bare));
	});
}

/** One group of the dialog with its charms (only groups with at least one). */
export interface CharmSection {
	group: CharmGroup;
	label: string;
	charms: CharmDefinition[];
}

/** Charms by group, in the order of CHARM_GROUPS; empty groups are left out. */
export function charmSections(charms: readonly CharmDefinition[]): CharmSection[] {
	return CHARM_GROUPS.flatMap((group) => {
		const inGroup = charms.filter((entry) => entry.group === group);
		return inGroup.length === 0
			? []
			: [{ group, label: CHARM_GROUP_LABELS[group], charms: inGroup }];
	});
}

/** Columns of the grid of the dialog; each group starts a new row. */
export const CHARM_COLUMNS = 6;

/**
 * The rows of the grid as the keys of the options: "Kein Charm" (`none`) alone in the first row,
 * then the charms of every section in rows of CHARM_COLUMNS.
 */
export function charmRows(sections: readonly CharmSection[], none: string): string[][] {
	const rows: string[][] = [[none]];
	for (const section of sections) {
		for (let start = 0; start < section.charms.length; start += CHARM_COLUMNS) {
			rows.push(section.charms.slice(start, start + CHARM_COLUMNS).map((entry) => entry.key));
		}
	}
	return rows;
}

/**
 * The option the focus moves to from `current` with `key` (APG grid, without wrapping): the arrows
 * left and right go through all options in reading order, up and down to the same column of the row
 * above or below (or its last option, when that row is shorter); Home and End to the first and the
 * last option. `null` when the key does not move (also up from the first row: the dialog then goes
 * back to the search).
 */
export function charmMove(
	rows: readonly (readonly string[])[],
	current: string,
	key: string
): string | null {
	const flat = rows.flat();
	const index = flat.indexOf(current);
	if (index === -1) return flat[0] ?? null;
	const row = rows.findIndex((entries) => entries.includes(current));
	const column = rows[row]?.indexOf(current) ?? 0;
	switch (key) {
		case 'ArrowRight':
			return flat[index + 1] ?? null;
		case 'ArrowLeft':
			return index > 0 ? (flat[index - 1] ?? null) : null;
		case 'ArrowDown': {
			const below = rows[row + 1];
			return below ? (below[Math.min(column, below.length - 1)] ?? null) : null;
		}
		case 'ArrowUp': {
			const above = row > 0 ? rows[row - 1] : undefined;
			return above ? (above[Math.min(column, above.length - 1)] ?? null) : null;
		}
		case 'Home':
			return flat[0] ?? null;
		case 'End':
			return flat.at(-1) ?? null;
		default:
			return null;
	}
}
