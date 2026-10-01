// Template of a recurrence rule (plan "Wiederholungen: Werte von Folgetickets", WV; ADR-0022
// addendum 8, ADR-0023 addendum 6, ADR-0024 addendum 3). Pure: what the next tickets of a series
// get, how a ticket becomes the template of a new rule, the line "Künftige Tickets: …" at the
// ticket, and which changes of an open ticket of a series the flag "Auch für künftige Tickets
// übernehmen" takes over into the template.

import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import type { RecurrenceRule } from './recurrence-rule';
import { joinWords } from './recurrence-text';
import { isPriority, type Priority } from './status';
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

/**
 * One sub-task of the template (plan WV-3, ADR-0022 addendum 10): every next ticket of the series
 * gets it as a new, open sub-task with this title and priority.
 */
export interface TemplateSubtask {
	title: string;
	priority: Priority;
}

/** At most so many sub-tasks per template; the same limit as TEMPLATE_SUBTASKS_MAX of the hook. */
export const TEMPLATE_SUBTASKS_MAX = 20;

/**
 * The sub-tasks of a stored template (`template_subtasks`): entries with a title, the priority
 * "Mittel" when it is missing; anything else (no list, broken entries) is left out. [] before the
 * migration of the field.
 */
export function templateSubtasksOf(value: unknown): TemplateSubtask[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry: unknown) => {
		if (typeof entry !== 'object' || entry === null) return [];
		const { title, priority } = entry as { title?: unknown; priority?: unknown };
		if (typeof title !== 'string' || title.trim() === '') return [];
		return [{ title, priority: isPriority(priority) ? priority : DEFAULT_PRIORITY }];
	});
}

/** What every next ticket of a rule gets. */
export interface RuleTemplate {
	title: string;
	description: string;
	projectId: string | null;
	tagIds: string[];
	priority: Priority;
	initialStatus: TemplateStatus;
	/** Sub-tasks every next ticket gets (plan WV-3); [] without any or before their migration. */
	subtasks: TemplateSubtask[];
}

/** The template of a rule as the server applies it: no priority means "Mittel" (ADR-0022 §2). */
export function templateOf(
	rule: Pick<RecurrenceRule, 'title' | 'description' | 'projectId' | 'tagIds' | 'priority'> &
		Partial<Pick<RecurrenceRule, 'initialStatus' | 'templateSubtasks'>>
): RuleTemplate {
	return {
		title: rule.title,
		description: rule.description,
		projectId: rule.projectId,
		tagIds: [...rule.tagIds],
		priority: rule.priority ?? DEFAULT_PRIORITY,
		initialStatus: templateStatusOf(rule.initialStatus),
		subtasks: copySubtasks(rule.templateSubtasks ?? [])
	};
}

function copySubtasks(subtasks: readonly TemplateSubtask[]): TemplateSubtask[] {
	return subtasks.map(({ title, priority }) => ({ title, priority }));
}

/**
 * A ticket as the template of a new rule ("Wiederholen…", "Neues Ticket" with "Wiederholen", a
 * series from a calendar): a snapshot of its values. The status the next tickets start with is
 * what the user chose (ADR-0022 addendum 9: asked, never taken silently from the ticket). Its
 * sub-tasks do not come along on their own; "Unteraufgaben dieses Tickets übernehmen" in the
 * template at the ticket takes them over (plan WV-3).
 */
export function ticketTemplate(
	ticket: Pick<TicketSummary, 'title' | 'projectId' | 'tagIds' | 'priority'> & {
		description: string;
	},
	initialStatus: TemplateStatus
): RuleTemplate {
	return {
		title: ticket.title,
		description: ticket.description,
		projectId: ticket.projectId,
		tagIds: [...ticket.tagIds],
		priority: ticket.priority,
		initialStatus,
		subtasks: []
	};
}

// --- "Folgetickets starten mit": the question when a rule is created (ADR-0022 addendum 9) ------

/** One answer of the question. */
export interface InitialStatusOption {
	value: TemplateStatus;
	label: string;
	/** "Offen" and the status of the ticket stand first, the other statuses below them. */
	first: boolean;
}

/**
 * The answers of "Folgetickets starten mit": "Offen" and, when it differs, the status of the
 * ticket ("Wie dieses Ticket: In Arbeit") first, then the other statuses of an open ticket in
 * their usual order. None is chosen in advance. Without a ticket ("Neue Regel") or with a done one
 * "Offen" stands first alone. The same answers start a duplicate (ADR-0045 §2), `like` "das
 * Original" then names the original ("Wie das Original: In Arbeit").
 */
export function initialStatusOptions(
	ticketStatus: string | null,
	like = 'dieses Ticket'
): InitialStatusOption[] {
	const own = isTemplateStatus(ticketStatus) ? ticketStatus : null;
	const first: InitialStatusOption[] = [
		{
			value: 'open',
			label: own === 'open' ? `${STATUS_LABELS.open} (wie ${like})` : STATUS_LABELS.open,
			first: true
		}
	];
	if (own !== null && own !== 'open') {
		first.push({ value: own, label: `Wie ${like}: ${STATUS_LABELS[own]}`, first: true });
	}
	const others = TEMPLATE_STATUSES.filter(
		(status) => !first.some((option) => option.value === status)
	).map((status) => ({ value: status, label: STATUS_LABELS[status], first: false }));
	return [...first, ...others];
}

/** Fields of a template as the data layer sends them (a part of RuleDraft). */
export interface TemplateBody {
	title?: string;
	description?: string;
	project?: string | null;
	tags?: string[];
	priority?: Priority;
	initial_status?: TemplateStatus;
	template_subtasks?: TemplateSubtask[];
}

/**
 * The whole template as request body. The sub-tasks only when there are some: a new rule from a
 * ticket has none, and a server before their migration would not know the field.
 */
export function templateBody(
	template: RuleTemplate
): Required<Omit<TemplateBody, 'template_subtasks'>> & Pick<TemplateBody, 'template_subtasks'> {
	return {
		title: template.title,
		description: template.description,
		project: template.projectId,
		tags: [...template.tagIds],
		priority: template.priority,
		initial_status: template.initialStatus,
		...(template.subtasks.length > 0 && { template_subtasks: copySubtasks(template.subtasks) })
	};
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether two lists of sub-tasks are the same, in the same order. */
export function sameSubtasks(
	a: readonly TemplateSubtask[],
	b: readonly TemplateSubtask[]
): boolean {
	return (
		a.length === b.length &&
		a.every(
			(entry, index) => entry.title === b[index]?.title && entry.priority === b[index]?.priority
		)
	);
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
	if (!sameSubtasks(before.subtasks, after.subtasks)) {
		body.template_subtasks = copySubtasks(after.subtasks);
	}
	return body;
}

// --- The list "Unteraufgaben" of the template (plan WV-3) ---------------------------------------

/** The list with its titles trimmed, as it is saved (the hook trims as well). */
export function trimmedSubtasks(subtasks: readonly TemplateSubtask[]): TemplateSubtask[] {
	return subtasks.map(({ title, priority }) => ({ title: title.trim(), priority }));
}

/** Indexes of entries without a title: the form refuses them before sending. */
export function subtasksWithoutTitle(subtasks: readonly TemplateSubtask[]): number[] {
	return subtasks.flatMap((entry, index) => (entry.title.trim() === '' ? [index] : []));
}

/** The list with one entry moved from `from` to `to` (both within the list); else unchanged. */
export function moveSubtask(
	subtasks: readonly TemplateSubtask[],
	from: number,
	to: number
): TemplateSubtask[] {
	const list = copySubtasks(subtasks);
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
	const [entry] = list.splice(from, 1);
	if (entry !== undefined) list.splice(to, 0, entry);
	return list;
}

/** A sub-task of the ticket as "Unteraufgaben dieses Tickets übernehmen" reads it. */
export type TicketSubtask = Pick<TicketSummary, 'id' | 'title' | 'priority' | 'created'>;

/**
 * The sub-tasks of a ticket as entries of the template, in the order they were made (open and
 * done ones: the template is the checklist of every next ticket).
 */
export function subtasksOfTicket(children: readonly TicketSubtask[]): TemplateSubtask[] {
	return [...children]
		.sort((a, b) =>
			a.created !== b.created ? (a.created < b.created ? -1 : 1) : a.id < b.id ? -1 : 1
		)
		.map((child) => ({ title: child.title, priority: child.priority }));
}

/** Titles compared without case and outer spaces: "Filter wechseln" is " filter Wechseln". */
function sameTitle(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Result of taking over the sub-tasks of the ticket into the list. */
export interface TakenSubtasks {
	subtasks: TemplateSubtask[];
	/** How many entries were added. */
	added: number;
	/** How many were left out because the list had them already (same title). */
	known: number;
	/** How many did not fit (more than TEMPLATE_SUBTASKS_MAX). */
	cut: number;
}

/**
 * "Unteraufgaben dieses Tickets übernehmen": `replace` puts the sub-tasks of the ticket in place of
 * the list, otherwise they are added after it, without one the list has already (same title).
 * Never more than TEMPLATE_SUBTASKS_MAX; what does not fit is counted.
 */
export function takeSubtasks(
	current: readonly TemplateSubtask[],
	incoming: readonly TemplateSubtask[],
	replace: boolean
): TakenSubtasks {
	const base = replace ? [] : copySubtasks(current);
	const fresh = replace
		? copySubtasks(incoming)
		: incoming.filter((entry) => !base.some((known) => sameTitle(known.title, entry.title)));
	const room = Math.max(0, TEMPLATE_SUBTASKS_MAX - base.length);
	const added = copySubtasks(fresh.slice(0, room));
	return {
		subtasks: [...base, ...added],
		added: added.length,
		known: incoming.length - fresh.length,
		cut: fresh.length - added.length
	};
}

/** "3 Unteraufgaben übernommen." with what was left out, for the polite status of the list. */
export function takenText(taken: TakenSubtasks): string {
	const parts = [`${subtaskCountText(taken.added)} übernommen.`];
	if (taken.known > 0) {
		parts.push(
			taken.known === 1
				? '1 stand schon in der Liste.'
				: `${taken.known} standen schon in der Liste.`
		);
	}
	if (taken.cut > 0) {
		parts.push(
			`${taken.cut} ${taken.cut === 1 ? 'passte' : 'passten'} nicht mehr (höchstens ${TEMPLATE_SUBTASKS_MAX}).`
		);
	}
	return parts.join(' ');
}

/** Names for the line of a template; null for a project or tag the catalog does not know. */
export interface TemplateNames {
	project(id: string): string | null;
	tag(id: string): string | null;
}

/**
 * "Priorität Hoch · Projekt Haus · Tags Garten, Müll · Status beim Anlegen Offen · 3 Unteraufgaben",
 * the line "Künftige Tickets: …" at the ticket. Without the migration of the status (`withStatus`
 * false) the status is left out, because every ticket then starts "open"; sub-tasks only when the
 * template has some (plan WV-3).
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
	if (template.subtasks.length > 0) parts.push(subtaskCountText(template.subtasks.length));
	return parts.join(' · ');
}

/** "1 Unteraufgabe" or "3 Unteraufgaben". */
export function subtaskCountText(count: number): string {
	return count === 1 ? '1 Unteraufgabe' : `${count} Unteraufgaben`;
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

/** Title of an offer about one ticket, also after a sub-task was added to it (plan WV-3). */
export const ONE_TICKET_CHANGED = 'Nur dieses Ticket geändert.';

/** "Nur dieses Ticket geändert." or, after a bulk action, "Nur diese 3 Tickets geändert." */
export function offerTitle(offers: readonly TemplateOffer[]): string {
	const count = offers.reduce((sum, offer) => sum + offer.keys.length, 0);
	return count === 1 ? ONE_TICKET_CHANGED : `Nur diese ${count} Tickets geändert.`;
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
export function appliedTitle(offers: readonly Pick<TemplateOffer, 'title'>[]): string {
	return offers.length === 1
		? `Vorlage von „${offers[0]?.title ?? ''}“ übernommen.`
		: `Vorlagen von ${offers.length} Serien übernommen.`;
}

// --- A sub-task added to an open ticket of a series (plan WV-3) --------------------------------

/** The ticket a sub-task was added to, as the offer needs it. */
export type SeriesParent = Pick<TicketSummary, 'key' | 'status' | 'recurrenceId'>;

/** What "Auch für künftige Tickets übernehmen" adds to the template of one rule. */
export interface SubtaskOffer {
	ruleId: string;
	/** Title of the rule, for the flags. */
	title: string;
	/** The sub-tasks to add, in the order they were added. */
	subtasks: TemplateSubtask[];
	/** The whole list of the template with them. */
	patch: { template_subtasks: TemplateSubtask[] };
}

/**
 * The offer after sub-tasks were added to an open ticket of a series (only "added": removing or
 * renaming one at the ticket offers nothing, the template is edited for that): the sub-tasks the
 * template does not have yet (same title), as many as fit (TEMPLATE_SUBTASKS_MAX). Null for a done
 * ticket, a ticket without a series, an unknown rule, nothing new or a full template.
 */
export function subtaskOffer(
	parent: SeriesParent,
	added: readonly TemplateSubtask[],
	ruleById: (id: string) => RecurrenceRule | null
): SubtaskOffer | null {
	if (!parent.recurrenceId || parent.status === 'done') return null;
	const rule = ruleById(parent.recurrenceId);
	if (rule === null) return null;
	const taken = takeSubtasks(rule.templateSubtasks ?? [], added, false);
	if (taken.added === 0) return null;
	return {
		ruleId: rule.id,
		title: rule.title,
		subtasks: taken.subtasks.slice(taken.subtasks.length - taken.added),
		patch: { template_subtasks: taken.subtasks }
	};
}

/**
 * "Künftige Tickets von „Müll“ bekommen die Unteraufgabe „Filter wechseln“ nicht." or, for several,
 * "… die Unteraufgaben „Filter wechseln“ und „Deckel putzen“ nicht."
 */
export function subtaskOfferDescription(offer: SubtaskOffer): string {
	const titles = joinWords(offer.subtasks.map((entry) => `„${entry.title}“`));
	const what = offer.subtasks.length === 1 ? 'die Unteraufgabe' : 'die Unteraufgaben';
	return `Künftige Tickets von „${offer.title}“ bekommen ${what} ${titles} nicht.`;
}

/**
 * What the ticket stores need of the rules: the offer after a change of tickets of a series (an
 * info flag with the action; its ID, or null when there is nothing to offer), the offer after a
 * sub-task was added to an open ticket of a series (plan WV-3), and withdrawing an offer when the
 * change was undone ("Rückgängig" of a bulk action).
 */
export interface SeriesChangeSink {
	offerTemplate(changes: readonly SeriesChange[]): string | null;
	offerSubtask(parent: SeriesParent, subtask: TemplateSubtask): string | null;
	withdrawTemplateOffer(id: string): void;
}

/** No offers (tests and views without rules). */
export const NO_SERIES: SeriesChangeSink = {
	offerTemplate: () => null,
	offerSubtask: () => null,
	withdrawTemplateOffer: () => undefined
};
