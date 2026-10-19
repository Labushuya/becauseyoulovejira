// "Übertragen …" after a change of a parent (UE-2, ADR-0070 addendum UE-2), pure: which fields of a
// change the user made in this tab count, how several changes of the same parent add up while its
// flag stands (the value before the first change stays the old one), the distance of the due date,
// the tags added and removed, whether the flag "Übertragen …" or the offer of the series appears,
// the texts of the flag and what the dialog chooses in advance and sends in its mode "nach
// Änderung". The route of UE-1 takes it as it is (`shift`, `remove`).

import { parseCalendarDate } from './berlin-date';
import { formatCalendarDate } from './format';
import { joinWords } from './recurrence-text';
import {
	TEMPLATE_FIELD_LABELS,
	type SeriesChangeSink,
	type TemplateOffer
} from './series-template';
import {
	TRANSFER_FIELDS,
	TRANSFER_SHIFT_DAYS_MAX,
	fieldOffers,
	transferValuesOf,
	type FieldOffer,
	type TagsTransfer,
	type TransferField,
	type TransferFields,
	type TransferNames,
	type TransferValues
} from './subtask-transfer';
import type { TicketSummary } from './ticket';

const DAY_MS = 86_400_000;

/** A ticket as a change reports it; the detail knows its description, the list does not. */
export type ChangedTicket = TicketSummary & { description?: string };

/**
 * One change the user made in this tab at one ticket: in the panel or the full view (the
 * TicketDetailStore), in a cell, with the check mark or in the calendar (the TicketListStore). Never
 * a change of another person or tab (realtime), of the server (series, rules), of the dialog
 * "Übertragen" itself (it changes the sub-tasks, which arrive by realtime) or of a bulk action.
 */
export interface TicketChange {
	before: ChangedTicket;
	after: ChangedTicket;
	/**
	 * Fields whose sub-tasks a question already settled for this change: the status after "N
	 * Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 §2).
	 */
	answered?: readonly TransferField[];
	/** "Rückgängig" of an earlier change: it updates a shown flag, it never starts one. */
	undo?: boolean;
}

/** Where the ticket stores report such a change. */
export interface TicketChangeSink {
	changed(change: TicketChange): void;
}

/**
 * The sink of stores without the flag "Übertragen …" (tests, views without the layout): every change
 * goes to the offer of the series as before UE-2; "Rückgängig" offers nothing.
 */
export function seriesChanges(series: Pick<SeriesChangeSink, 'offerTemplate'>): TicketChangeSink {
	return {
		changed: (change) => {
			if (!change.undo) series.offerTemplate([{ before: change.before, after: change.after }]);
		}
	};
}

/** Names of the fields in the flag and the dialog, in the order of the dialog. */
export const CHANGED_FIELD_LABELS: Readonly<Record<TransferField, string>> = Object.freeze({
	due: 'Fälligkeit',
	priority: 'Priorität',
	status: 'Status',
	assignee: 'Zuständigkeit',
	tags: 'Tags',
	project: 'Projekt'
});

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id) => b.includes(id));
}

function differs(field: TransferField, a: TransferValues, b: TransferValues): boolean {
	return field === 'tags' ? !sameSet(a.tags, b.tags) : a[field] !== b[field];
}

/** The fields of the dialog whose value differs between two states of a ticket, in its order. */
export function changedFields(
	before: Parameters<typeof transferValuesOf>[0],
	after: Parameters<typeof transferValuesOf>[0]
): TransferField[] {
	const a = transferValuesOf(before);
	const b = transferValuesOf(after);
	return TRANSFER_FIELDS.filter((field) => differs(field, a, b));
}

// --- Several changes of one parent ------------------------------------------------------------------

/** The change of a parent while its flag stands: from before the first change to the latest one. */
export interface ParentChange {
	/** The parent before the first change: its values are the old ones. */
	readonly before: ChangedTicket;
	/** The parent as the latest change saved it. */
	readonly after: ChangedTicket;
	/**
	 * Fields the user changed meanwhile, in the order of the dialog. Only these count: a field another
	 * person changed in between differs as well, but the user did not change it.
	 */
	readonly touched: readonly TransferField[];
}

function ordered(fields: Iterable<TransferField>): TransferField[] {
	const set = new Set(fields);
	return TRANSFER_FIELDS.filter((field) => set.has(field));
}

function touchedBy(change: TicketChange): TransferField[] {
	const answered = change.answered ?? [];
	return changedFields(change.before, change.after).filter((field) => !answered.includes(field));
}

/**
 * The first change of a parent. `earlier` is a change of the same parent whose offer of the series
 * still stands (it gives way to the flag): its old values and its fields count as well.
 */
export function startParentChange(
	change: TicketChange,
	earlier: { before: ChangedTicket; after: ChangedTicket } | null = null
): ParentChange {
	const touched = touchedBy(change);
	if (earlier !== null) touched.push(...changedFields(earlier.before, earlier.after));
	return {
		before: earlier?.before ?? change.before,
		after: change.after,
		touched: ordered(touched)
	};
}

/**
 * A further change of the same parent: the old values stay, the new ones are those of the latest
 * change, and its fields join. A field a question settled leaves (the status after the question about
 * open sub-tasks).
 */
export function nextParentChange(current: ParentChange, change: TicketChange): ParentChange {
	const answered = change.answered ?? [];
	const touched = [...current.touched, ...touchedBy(change)].filter(
		(field) => !answered.includes(field)
	);
	return { before: current.before, after: change.after, touched: ordered(touched) };
}

/** The fields the flag names: changed by the user and still different from before (not undone). */
export function pendingFields(change: ParentChange): TransferField[] {
	const before = transferValuesOf(change.before);
	const after = transferValuesOf(change.after);
	return change.touched.filter((field) => differs(field, before, after));
}

/**
 * The distance of the due date in days (new minus old), for "Um denselben Abstand verschieben"; null
 * when one of them is missing, when they are equal, or beyond what the route takes (3650 days).
 */
export function dueShiftOf(change: Pick<ParentChange, 'before' | 'after'>): number | null {
	const { due: from } = change.before;
	const { due: to } = change.after;
	if (from === null || to === null) return null;
	const days = Math.round((parseCalendarDate(to) - parseCalendarDate(from)) / DAY_MS);
	return days === 0 || Math.abs(days) > TRANSFER_SHIFT_DAYS_MAX ? null : days;
}

/**
 * The tags of the change: added and removed ones, not all tags of the parent. Measured against the
 * parent as it is now (`current`), because the route adds only tags it has and removes only tags it
 * does not have; null when nothing is left.
 */
export function tagChangeOf(
	change: Pick<ParentChange, 'before' | 'after'>,
	current: Pick<TicketSummary, 'tagIds'> = change.after
): TagsTransfer | null {
	const add = change.after.tagIds.filter(
		(id) => !change.before.tagIds.includes(id) && current.tagIds.includes(id)
	);
	const remove = change.before.tagIds.filter(
		(id) => !change.after.tagIds.includes(id) && !current.tagIds.includes(id)
	);
	return add.length + remove.length === 0 ? null : { add, remove };
}

// --- Flag or offer of the series -------------------------------------------------------------------

/**
 * What a change of one ticket brings (ADR-0070 addendum UE-2): the flag "Übertragen …" when it has
 * at least one open sub-task, at least one field of the dialog differs and the server is not known to
 * lack the route; then it stands alone, and the offer of the series is a checkbox in its dialog.
 * Otherwise the offer of the series as before (`series`; it may have nothing to offer).
 */
export function offerChoice(
	fields: readonly TransferField[],
	openSubtasks: number,
	routeMissing: boolean
): 'transfer' | 'series' {
	return fields.length > 0 && openSubtasks > 0 && !routeMissing ? 'transfer' : 'series';
}

export const CHANGE_TEXTS = Object.freeze({
	action: 'Übertragen …',
	question: 'Auch für die Unteraufgaben?',
	none: 'Keine',
	series: 'Auch für künftige Tickets übernehmen',
	seriesOnly: 'Für künftige Tickets übernehmen',
	seriesBusy: 'Wird übernommen …',
	seriesLost: 'Die Anfrage ist nicht angekommen. Bitte erneut versuchen.',
	sameDue: 'Gleiches Datum wie das Hauptticket',
	keepWithout: 'Unteraufgaben ohne Fälligkeit bleiben ohne.',
	dueChoice: 'Fälligkeit der Unteraufgaben',
	tagsKept: 'Andere Tags der Unteraufgaben bleiben.',
	untouched: 'Die Unteraufgaben bleiben, wie sie sind.',
	nothing: 'Nichts gewählt.',
	close: 'Schließen',
	describe: (key: string) =>
		`Was du an ${key} geändert hast, ist vorausgewählt. Titel, Beschreibung, Wiederholung und Art bleiben.`
});

/** "Fälligkeit und Priorität von HAUS-12 geändert. Auch für die Unteraufgaben?" */
export function changedTitle(fields: readonly TransferField[], key: string): string {
	const names = ordered(fields).map((field) => CHANGED_FIELD_LABELS[field]);
	return `${joinWords(names)} von ${key} geändert. ${CHANGE_TEXTS.question}`;
}

/** The line below the title when the dialog also offers the series; '' otherwise. */
export function changedDescription(seriesTitle: string | null): string {
	return seriesTitle === null
		? ''
		: `Im Dialog lässt sich die Änderung auch für künftige Tickets von „${seriesTitle}“ übernehmen.`;
}

// --- The dialog "nach Änderung" ---------------------------------------------------------------------

/** "+3 Tage", "−1 Tag". */
export function shiftText(days: number): string {
	const sign = days > 0 ? '+' : '−';
	const count = Math.abs(days);
	return `${sign}${count} ${count === 1 ? 'Tag' : 'Tage'}`;
}

/** "Um denselben Abstand verschieben (+3 Tage)" */
export function shiftLabel(days: number): string {
	return `Um denselben Abstand verschieben (${shiftText(days)})`;
}

/** Names of the tags of the change, in its order (unknown ones left out). */
export interface TagChangeNames {
	added: readonly string[];
	removed: readonly string[];
}

/** "Garten hinzufügen, Müll entfernen" */
export function tagChangeText(names: TagChangeNames): string {
	const parts: string[] = [];
	if (names.added.length > 0) parts.push(`${joinWords(names.added)} hinzufügen`);
	if (names.removed.length > 0) parts.push(`${joinWords(names.removed)} entfernen`);
	return parts.join(', ');
}

/**
 * The checkboxes of the dialog after a change: those of UE-1, but a changed due date with the date
 * alone when the dialog offers to move it (the choice stands below), and changed tags as the
 * change, not as all tags of the parent.
 */
export function changeFieldOffers(
	parent: Pick<TicketSummary, 'due' | 'priority' | 'status' | 'tagIds'>,
	names: TransferNames,
	change: ParentChange,
	tagNames: TagChangeNames
): FieldOffer[] {
	const fields = pendingFields(change);
	const shift = fields.includes('due') ? dueShiftOf(change) : null;
	const tags = fields.includes('tags') ? tagChangeOf(change, parent) : null;
	return fieldOffers(parent, names).map((offer): FieldOffer => {
		if (offer.field === 'due' && shift !== null && parent.due !== null) {
			return {
				...offer,
				label: CHANGED_FIELD_LABELS.due,
				value: formatCalendarDate(parent.due),
				hint: null
			};
		}
		if (offer.field === 'tags' && tags !== null) {
			return {
				...offer,
				label: CHANGED_FIELD_LABELS.tags,
				value: tagChangeText(tagNames),
				hint: CHANGE_TEXTS.tagsKept,
				locked: null
			};
		}
		return offer;
	});
}

/**
 * Checked when the dialog opens after a change: exactly the changed fields it offers unlocked, the
 * project included; the remembered choice of the device does not count here.
 */
export function changeInitialFields(
	offers: readonly FieldOffer[],
	change: ParentChange
): Set<TransferField> {
	const fields = pendingFields(change);
	return new Set(
		offers
			.filter((offer) => offer.locked === null && fields.includes(offer.field))
			.map((offer) => offer.field)
	);
}

/** "Gleiches Datum wie das Hauptticket" or "Um denselben Abstand verschieben". */
export type DueChoice = 'same' | 'shift';

/**
 * The fields of the request after a change: the due date the same or moved by the distance, the
 * tags as the change when they changed (else, like UE-1, the tags of the parent to add), the others
 * with the value of the parent.
 */
export function changeFieldsOf(
	chosen: ReadonlySet<TransferField>,
	parent: Pick<TicketSummary, 'tagIds'>,
	change: ParentChange,
	due: DueChoice
): TransferFields {
	const fields = pendingFields(change);
	const shift = fields.includes('due') ? dueShiftOf(change) : null;
	const tags = fields.includes('tags') ? tagChangeOf(change, parent) : null;
	return {
		due: !chosen.has('due')
			? null
			: due === 'shift' && shift !== null
				? { mode: 'shift', days: shift }
				: { mode: 'same' },
		priority: chosen.has('priority'),
		status: chosen.has('status'),
		assignee: chosen.has('assignee'),
		project: chosen.has('project'),
		tags: !chosen.has('tags')
			? null
			: tags !== null
				? tags
				: parent.tagIds.length > 0
					? { add: [...parent.tagIds], remove: [] }
					: null
	};
}

/** Chosen sub-tasks without a due date, which keep none when it moves. */
export function withoutDueCount(
	targets: readonly Pick<TicketSummary, 'due'>[],
	fields: Pick<TransferFields, 'due'>
): number {
	return fields.due?.mode === 'shift' ? targets.filter((target) => target.due === null).length : 0;
}

/**
 * The hint of "Auch für künftige Tickets übernehmen": what the template gets, the fields of the
 * offer of the series ("Die Vorlage von „Müll“ bekommt Priorität und Tags.").
 */
export function seriesHint(offer: Pick<TemplateOffer, 'title' | 'fields'>): string {
	const fields = offer.fields.map((field) => TEMPLATE_FIELD_LABELS[field]);
	return `Die Vorlage von „${offer.title}“ bekommt ${joinWords(fields)}; dieses Ticket und seine Unteraufgaben ändert das nicht.`;
}

/** "1 Unteraufgabe ohne Fälligkeit bleibt ohne." for the line above the buttons; '' for none. */
export function withoutDueText(count: number): string {
	if (count === 0) return '';
	return count === 1
		? '1 Unteraufgabe ohne Fälligkeit bleibt ohne.'
		: `${count} Unteraufgaben ohne Fälligkeit bleiben ohne.`;
}
