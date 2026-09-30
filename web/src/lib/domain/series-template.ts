// Template of a recurrence rule (plan "Wiederholungen: Werte von Folgetickets", WV; ADR-0022
// addendum 8, ADR-0023 addendum 6, ADR-0024 addendum 3). Pure: what the next tickets of a series
// get, how a ticket becomes the template of a new rule, the line "Künftige Tickets: …" at the
// ticket, and which changes of an open ticket of a series the flag "Auch für künftige Tickets
// übernehmen" takes over into the template.

import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import type { RecurrenceRule } from './recurrence-rule';
import type { Priority } from './status';
import { DEFAULT_PRIORITY, type TicketSummary } from './ticket';

/**
 * "Status beim Anlegen": the status the next tickets start with, every one but "done" (a ticket
 * done at once would never be an open instance). The same list as INITIAL_STATUSES of the hook.
 */
export const TEMPLATE_STATUSES = ['backlog', 'open', 'in_progress', 'waiting'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Default of "Status beim Anlegen", and the status of rules from before its migration. */
export const DEFAULT_TEMPLATE_STATUS: TemplateStatus = 'open';

export function isTemplateStatus(value: unknown): value is TemplateStatus {
	return (TEMPLATE_STATUSES as readonly unknown[]).includes(value);
}

/** The status a template takes from a value: "open" for "done", '' and anything unknown. */
export function templateStatusOf(value: unknown): TemplateStatus {
	return isTemplateStatus(value) ? value : DEFAULT_TEMPLATE_STATUS;
}

/** What every next ticket of a rule gets. */
export interface RuleTemplate {
	title: string;
	description: string;
	projectId: string | null;
	tagIds: string[];
	priority: Priority;
	initialStatus: TemplateStatus;
}

/** The template of a rule as the server applies it: no priority means "Mittel" (ADR-0022 §2). */
export function templateOf(
	rule: Pick<RecurrenceRule, 'title' | 'description' | 'projectId' | 'tagIds' | 'priority'> &
		Partial<Pick<RecurrenceRule, 'initialStatus'>>
): RuleTemplate {
	return {
		title: rule.title,
		description: rule.description,
		projectId: rule.projectId,
		tagIds: [...rule.tagIds],
		priority: rule.priority ?? DEFAULT_PRIORITY,
		initialStatus: templateStatusOf(rule.initialStatus)
	};
}

/**
 * A ticket as the template of a new rule ("Wiederholen…", "Neues Ticket" with "Wiederholen", a
 * series from a calendar): a snapshot of its values, its status included (the user report of WV:
 * the next ticket came "open" instead of the chosen status). A done ticket never starts a series;
 * it would give "open".
 */
export function ticketTemplate(
	ticket: Pick<TicketSummary, 'title' | 'projectId' | 'tagIds' | 'priority' | 'status'> & {
		description: string;
	}
): RuleTemplate {
	return {
		title: ticket.title,
		description: ticket.description,
		projectId: ticket.projectId,
		tagIds: [...ticket.tagIds],
		priority: ticket.priority,
		initialStatus: templateStatusOf(ticket.status)
	};
}

/** Fields of a template as the data layer sends them (a part of RuleDraft). */
export interface TemplateBody {
	title?: string;
	description?: string;
	project?: string | null;
	tags?: string[];
	priority?: Priority;
	initial_status?: TemplateStatus;
}

/** The whole template as request body. */
export function templateBody(template: RuleTemplate): Required<TemplateBody> {
	return {
		title: template.title,
		description: template.description,
		project: template.projectId,
		tags: [...template.tagIds],
		priority: template.priority,
		initial_status: template.initialStatus
	};
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * The fields of a template that differ from another one, as request body; empty when they are
 * the same. The inline editor at the ticket sends only these.
 */
export function templateChanges(before: RuleTemplate, after: RuleTemplate): TemplateBody {
	const body: TemplateBody = {};
	if (before.title !== after.title) body.title = after.title;
	if (before.description !== after.description) body.description = after.description;
	if (before.projectId !== after.projectId) body.project = after.projectId;
	if (!sameList(before.tagIds, after.tagIds)) body.tags = [...after.tagIds];
	if (before.priority !== after.priority) body.priority = after.priority;
	if (before.initialStatus !== after.initialStatus) body.initial_status = after.initialStatus;
	return body;
}

/** Names for the line of a template; null for a project or tag the catalog does not know. */
export interface TemplateNames {
	project(id: string): string | null;
	tag(id: string): string | null;
}

/**
 * "Priorität Hoch · Projekt Haus · Tags Garten, Müll · Status beim Anlegen Offen", the line
 * "Künftige Tickets: …" at the ticket. Without the migration of the status (`withStatus` false)
 * the status is left out, because every ticket then starts "open".
 */
export function templateSummary(
	template: RuleTemplate,
	names: TemplateNames,
	withStatus: boolean
): string {
	const parts = [`Priorität ${PRIORITY_LABELS[template.priority]}`];
	if (template.projectId === null) parts.push('ohne Projekt');
	else parts.push(`Projekt ${names.project(template.projectId) ?? 'unbekannt'}`);
	const tags = template.tagIds.flatMap((id) => names.tag(id) ?? []);
	parts.push(tags.length === 0 ? 'ohne Tags' : `Tags ${tags.join(', ')}`);
	if (withStatus) parts.push(`Status beim Anlegen ${STATUS_LABELS[template.initialStatus]}`);
	return parts.join(' · ');
}

// --- Changes of an open ticket of a series (ADR-0023 addendum 6) -------------------------------

/**
 * Fields of a ticket the flag "Auch für künftige Tickets übernehmen" may take over. Not status and
 * due date: they belong to the one ticket (a date of the series, how far it got).
 */
export const TEMPLATE_FIELDS = ['title', 'description', 'priority', 'project', 'tags'] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

export const TEMPLATE_FIELD_LABELS: Readonly<Record<TemplateField, string>> = Object.freeze({
	title: 'Titel',
	description: 'Beschreibung',
	priority: 'Priorität',
	project: 'Projekt',
	tags: 'Tags'
});

/** A ticket as a change of it shows; the list knows no description (then it is left out). */
export type SeriesTicket = Pick<
	TicketSummary,
	'id' | 'key' | 'status' | 'title' | 'priority' | 'projectId' | 'tagIds' | 'recurrenceId'
> & { description?: string };

/** One ticket before and after a change the user made (panel, full view, cell, bulk action). */
export interface SeriesChange {
	before: SeriesTicket;
	after: SeriesTicket;
}

/**
 * Fields of the template a change touched: only for an open ticket that stays in its series,
 * never status or due date. Empty for anything else.
 */
export function changedTemplateFields(change: SeriesChange): TemplateField[] {
	const { before, after } = change;
	if (
		!after.recurrenceId ||
		after.recurrenceId !== before.recurrenceId ||
		after.status === 'done'
	) {
		return [];
	}
	const fields: TemplateField[] = [];
	if (before.title !== after.title) fields.push('title');
	if (
		before.description !== undefined &&
		after.description !== undefined &&
		before.description !== after.description
	) {
		fields.push('description');
	}
	if (before.priority !== after.priority) fields.push('priority');
	if (before.projectId !== after.projectId) fields.push('project');
	if (!sameList(before.tagIds, after.tagIds)) fields.push('tags');
	return fields;
}

/** What "Auch für künftige Tickets übernehmen" writes into the template of one rule. */
export interface TemplateOffer {
	ruleId: string;
	/** Title of the rule, for the flags. */
	title: string;
	fields: TemplateField[];
	patch: TemplateBody;
	/** Keys of the changed tickets of the rule. */
	keys: string[];
}

/**
 * The offers for the rules of the changed tickets: exactly the changed fields with their new
 * value, and only where the template differs (nothing to offer when it has the value already).
 * Tags go over as the change the tickets got (added and removed), applied to the tags of the
 * template, so a bulk action "Tags hinzufügen" adds the same tags to it. Rules the store does not
 * know are left out.
 */
export function templateOffers(
	changes: readonly SeriesChange[],
	ruleById: (id: string) => RecurrenceRule | null
): TemplateOffer[] {
	const byRule = new Map<string, SeriesChange[]>();
	for (const change of changes) {
		if (changedTemplateFields(change).length === 0 || !change.after.recurrenceId) continue;
		const list = byRule.get(change.after.recurrenceId) ?? [];
		list.push(change);
		byRule.set(change.after.recurrenceId, list);
	}
	const offers: TemplateOffer[] = [];
	for (const [ruleId, list] of byRule) {
		const rule = ruleById(ruleId);
		if (rule === null) continue;
		const offer = offerFor(rule, list);
		if (offer !== null) offers.push(offer);
	}
	return offers;
}

function offerFor(rule: RecurrenceRule, changes: readonly SeriesChange[]): TemplateOffer | null {
	const template = templateOf(rule);
	const patch: TemplateBody = {};
	const added: string[] = [];
	const removed: string[] = [];
	for (const change of changes) {
		const fields = changedTemplateFields(change);
		const { before, after } = change;
		if (fields.includes('title')) patch.title = after.title;
		if (fields.includes('description') && after.description !== undefined) {
			patch.description = after.description;
		}
		if (fields.includes('priority')) patch.priority = after.priority;
		if (fields.includes('project')) patch.project = after.projectId;
		if (fields.includes('tags')) {
			for (const id of after.tagIds) if (!before.tagIds.includes(id)) added.push(id);
			for (const id of before.tagIds) if (!after.tagIds.includes(id)) removed.push(id);
		}
	}
	if (patch.title === template.title) delete patch.title;
	if (patch.description === template.description) delete patch.description;
	if (patch.priority === template.priority) delete patch.priority;
	if (patch.project === template.projectId) delete patch.project;
	const tags = [
		...template.tagIds.filter((id) => !removed.includes(id)),
		...added.filter((id, index) => !template.tagIds.includes(id) && added.indexOf(id) === index)
	];
	if (!sameList(tags, template.tagIds)) patch.tags = tags;
	const fields = TEMPLATE_FIELDS.filter((field) => field in patch);
	if (fields.length === 0) return null;
	return {
		ruleId: rule.id,
		title: rule.title,
		fields,
		patch,
		keys: changes.map((change) => change.after.key)
	};
}

/** Label of the action of the flag. */
export const OFFER_ACTION = 'Auch für künftige Tickets übernehmen';

/** "Nur dieses Ticket geändert." or, after a bulk action, "Nur diese 3 Tickets geändert." */
export function offerTitle(offers: readonly TemplateOffer[]): string {
	const count = offers.reduce((sum, offer) => sum + offer.keys.length, 0);
	return count === 1 ? 'Nur dieses Ticket geändert.' : `Nur diese ${count} Tickets geändert.`;
}

/**
 * "Künftige Tickets von „Müll“ kommen weiter mit der bisherigen Vorlage (Priorität)." or, for
 * several rules, "… von 2 Serien …" with every changed field once.
 */
export function offerDescription(offers: readonly TemplateOffer[]): string {
	const fields = TEMPLATE_FIELDS.filter((field) =>
		offers.some((offer) => offer.fields.includes(field))
	).map((field) => TEMPLATE_FIELD_LABELS[field]);
	const series = offers.length === 1 ? `„${offers[0]?.title ?? ''}“` : `${offers.length} Serien`;
	return `Künftige Tickets von ${series} kommen weiter mit der bisherigen Vorlage (${fields.join(', ')}).`;
}

/** Success flag of the action: "Vorlage von „Müll“ übernommen." or "Vorlagen von 2 Serien …". */
export function appliedTitle(offers: readonly TemplateOffer[]): string {
	return offers.length === 1
		? `Vorlage von „${offers[0]?.title ?? ''}“ übernommen.`
		: `Vorlagen von ${offers.length} Serien übernommen.`;
}

/**
 * What the ticket stores need of the rules: the offer after a change of tickets of a series (an
 * info flag with the action; its ID, or null when there is nothing to offer), and withdrawing it
 * when the change was undone ("Rückgängig" of a bulk action).
 */
export interface SeriesChangeSink {
	offerTemplate(changes: readonly SeriesChange[]): string | null;
	withdrawTemplateOffer(id: string): void;
}

/** No offers (tests and views without rules). */
export const NO_SERIES: SeriesChangeSink = {
	offerTemplate: () => null,
	withdrawTemplateOffer: () => undefined
};
