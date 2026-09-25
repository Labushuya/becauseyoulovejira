// Templates of the manual capture (E4 plan, package 5; OF-E4-1, recommendation (a)): fixed forms
// per kind of object with their own fields, title pattern and tag. Pure: the form collects the
// input, `buildCapture` checks it and turns it into a ticket draft or an inbox draft. Which of
// both is the default follows OF-E4-3 (DEFAULT_CAPTURE_TARGET).

import {
	berlinWallClockToUtc,
	isCalendarDate,
	isTimeOfDay,
	type CalendarDate
} from './berlin-date';
import { formatCalendarDate, toPocketBaseTimestamp } from './format';
import {
	PRESET_META_KEY,
	escapeMarkdown,
	presetMeta,
	type InboxDraft,
	type InboxKind
} from './inbox';
import type { Priority } from './status';
import {
	DEFAULT_PRIORITY,
	DEFAULT_STATUS,
	DESCRIPTION_MAX_LENGTH,
	TITLE_MAX_LENGTH,
	type TicketDraft
} from './ticket';

export const CAPTURE_TEMPLATES = ['todo', 'call', 'shopping', 'event', 'project_task'] as const;
export type CaptureTemplate = (typeof CAPTURE_TEMPLATES)[number];

export const DEFAULT_CAPTURE_TEMPLATE: CaptureTemplate = 'todo';

/** Query parameter of the chosen template; the last choice stays in the URL (package 5). */
export const TEMPLATE_PARAM = 'vorlage';

/** Values of `?vorlage=`. */
export const TEMPLATE_VALUES: Readonly<Record<CaptureTemplate, string>> = Object.freeze({
	todo: 'todo',
	call: 'anruf',
	shopping: 'einkauf',
	event: 'termin',
	project_task: 'projektaufgabe'
});

export const TEMPLATE_LABELS: Readonly<Record<CaptureTemplate, string>> = Object.freeze({
	todo: 'To-do',
	call: 'Anruf',
	shopping: 'Einkauf',
	event: 'Termin',
	project_task: 'Projektaufgabe'
});

/** Kind of the inbox entry per template (ADR-0014 section 1); never a ticket type (ADR-0012). */
export const TEMPLATE_KINDS: Readonly<Record<CaptureTemplate, InboxKind>> = Object.freeze({
	todo: 'todo',
	call: 'task',
	shopping: 'task',
	event: 'event',
	project_task: 'project_task'
});

/** Tag a template gives its tickets; created through the catalog if it does not exist yet. */
export const TEMPLATE_TAGS: Readonly<Record<CaptureTemplate, string | null>> = Object.freeze({
	todo: null,
	call: 'Anruf',
	shopping: 'Einkauf',
	event: 'Termin',
	project_task: null
});

/**
 * Where typed-in objects go (OF-E4-3, recommendation): straight to a ticket, since the user has
 * decided on them already; on request (Alt+Enter, switch) into the inbox.
 */
export type CaptureTarget = 'ticket' | 'inbox';
export const DEFAULT_CAPTURE_TARGET: CaptureTarget = 'ticket';

export type CaptureField =
	| 'what'
	| 'who'
	| 'phone'
	| 'reason'
	| 'items'
	| 'store'
	| 'date'
	| 'time'
	| 'place'
	| 'project'
	| 'priority'
	| 'due'
	| 'tags';

export interface CaptureFieldSpec {
	field: CaptureField;
	label: string;
	required: boolean;
}

const spec = (field: CaptureField, label: string, required = false): CaptureFieldSpec =>
	Object.freeze({ field, label, required });

/** Fields per template in the order of the form (E4 plan, package 5, table of templates). */
export const TEMPLATE_FIELDS: Readonly<Record<CaptureTemplate, readonly CaptureFieldSpec[]>> =
	Object.freeze({
		todo: [spec('what', 'Was?', true), spec('due', 'Fällig'), spec('priority', 'Priorität')],
		call: [
			spec('who', 'Wen?', true),
			spec('phone', 'Nummer'),
			spec('reason', 'Anlass'),
			spec('due', 'Fällig')
		],
		shopping: [
			spec('items', 'Artikel (einer je Zeile)', true),
			spec('store', 'Laden'),
			spec('due', 'Fällig')
		],
		event: [
			spec('what', 'Was?', true),
			spec('date', 'Datum', true),
			spec('time', 'Uhrzeit'),
			spec('place', 'Ort')
		],
		project_task: [
			spec('project', 'Projekt', true),
			spec('what', 'Was?', true),
			spec('priority', 'Priorität'),
			spec('due', 'Fällig'),
			spec('tags', 'Tags')
		]
	});

/** Everything the form can hold; a template reads only its own fields. */
export interface CaptureInput {
	what: string;
	who: string;
	phone: string;
	reason: string;
	/** One article per line. */
	items: string;
	store: string;
	/** `YYYY-MM-DD` or ''. */
	date: string;
	/** `HH:MM` or ''. */
	time: string;
	place: string;
	/** Project ID or ''. */
	project: string;
	priority: Priority;
	/** `YYYY-MM-DD` or ''. */
	due: string;
	/** Tag IDs chosen in the form. */
	tagIds: string[];
}

export const EMPTY_CAPTURE_INPUT: Readonly<CaptureInput> = Object.freeze({
	what: '',
	who: '',
	phone: '',
	reason: '',
	items: '',
	store: '',
	date: '',
	time: '',
	place: '',
	project: '',
	priority: DEFAULT_PRIORITY,
	due: '',
	tagIds: []
});

/** Checked result of a template, before the tags are resolved. */
export interface Capture {
	template: CaptureTemplate;
	kind: InboxKind;
	title: string;
	/** Description of the ticket (Markdown). */
	description: string;
	/** Text of the inbox entry; an event keeps date and place in its own fields instead. */
	body: string;
	priority: Priority;
	due: CalendarDate | null;
	project: string | null;
	/** Tags chosen in the form. */
	tagIds: string[];
	/** Tag names of the template, resolved through the catalog. */
	tagNames: string[];
	/** Begin of an event (UTC, PocketBase format); never the due date (P-5). */
	sourceDate: string | null;
	/** Place and all-day flag of an event. */
	sourceMeta: Record<string, unknown>;
}

export type CaptureErrors = Partial<Record<CaptureField, string>>;
export type CaptureOutcome = { ok: true; capture: Capture } | { ok: false; errors: CaptureErrors };

export const REQUIRED_MESSAGE = 'Pflichtfeld.';
export const INVALID_DATE_MESSAGE = 'Ungültiges Datum.';
export const INVALID_TIME_MESSAGE = 'Ungültige Uhrzeit.';

/** Template of `?vorlage=`; missing, repeated or unknown values give the default. */
export function templateFrom(params: URLSearchParams): CaptureTemplate {
	const values = params.getAll(TEMPLATE_PARAM);
	if (values.length !== 1) return DEFAULT_CAPTURE_TEMPLATE;
	const found = CAPTURE_TEMPLATES.find((template) => TEMPLATE_VALUES[template] === values[0]);
	return found ?? DEFAULT_CAPTURE_TEMPLATE;
}

/** Whitespace runs as one space, trimmed: titles and single-line fields. */
function line(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Articles of the shopping list: one per non-empty line. */
export function shoppingItems(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map(line)
		.filter((item) => item !== '');
}

/** A title cut to the limit of the schema, marked with "…" (like the hook does for the inbox). */
export function fitTitle(title: string): string {
	return title.length <= TITLE_MAX_LENGTH ? title : `${title.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

function titleOf(template: CaptureTemplate, input: CaptureInput): string {
	switch (template) {
		case 'call':
			return `Anrufen: ${line(input.who)}`;
		case 'shopping': {
			const store = line(input.store);
			if (store !== '') return `Einkauf: ${store}`;
			const items = shoppingItems(input.items);
			return `Einkauf: ${items[0] ?? ''}${items.length > 1 ? ' …' : ''}`;
		}
		default:
			return line(input.what);
	}
}

const detail = (label: string, value: string) =>
	value === '' ? [] : [`- **${label}:** ${escapeMarkdown(value)}`];

/** Description lines of the template (Markdown, typed values escaped). */
function descriptionOf(template: CaptureTemplate, input: CaptureInput, withEvent: boolean): string {
	switch (template) {
		case 'call':
			return [...detail('Nummer', line(input.phone)), ...detail('Anlass', line(input.reason))].join(
				'\n'
			);
		case 'shopping':
			return shoppingItems(input.items)
				.map((item) => `- [ ] ${escapeMarkdown(item)}`)
				.join('\n');
		case 'event': {
			if (!withEvent) return '';
			const when = `${formatCalendarDate(input.date)}${input.time === '' ? '' : ` ${input.time}`}`;
			// The date is formatted here, not typed in: it needs no escaping.
			return [`- **Termin:** ${when}`, ...detail('Ort', line(input.place))].join('\n');
		}
		default:
			return '';
	}
}

/** Fields of the template that a value was given for; others are ignored. */
function has(template: CaptureTemplate, field: CaptureField): boolean {
	return TEMPLATE_FIELDS[template].some((entry) => entry.field === field);
}

function check(template: CaptureTemplate, input: CaptureInput): CaptureErrors {
	const errors: CaptureErrors = {};
	for (const { field, required } of TEMPLATE_FIELDS[template]) {
		if (!required) continue;
		const value =
			field === 'items'
				? shoppingItems(input.items).join('')
				: field === 'tags'
					? input.tagIds.join('')
					: input[field];
		if (line(value) === '') errors[field] = REQUIRED_MESSAGE;
	}
	if (has(template, 'date') && errors.date === undefined && !isCalendarDate(input.date)) {
		errors.date = INVALID_DATE_MESSAGE;
	}
	if (has(template, 'time') && input.time !== '' && !isTimeOfDay(input.time)) {
		errors.time = INVALID_TIME_MESSAGE;
	}
	if (has(template, 'due') && input.due !== '' && !isCalendarDate(input.due)) {
		errors.due = INVALID_DATE_MESSAGE;
	}
	return errors;
}

/**
 * Checks the input of a template and builds the capture: title pattern, description (checklist
 * of a shopping list, number and reason of a call, date and place of an event), priority, due
 * date, project and tags. Fields of other templates are ignored. The date of an event becomes
 * the date at the sender of an inbox entry, never a due date (P-5).
 */
export function buildCapture(template: CaptureTemplate, input: CaptureInput): CaptureOutcome {
	const errors = check(template, input);
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	const event = template === 'event';
	const tag = TEMPLATE_TAGS[template];
	return {
		ok: true,
		capture: {
			template,
			kind: TEMPLATE_KINDS[template],
			title: fitTitle(titleOf(template, input)),
			description: descriptionOf(template, input, true).slice(0, DESCRIPTION_MAX_LENGTH),
			body: descriptionOf(template, input, false).slice(0, DESCRIPTION_MAX_LENGTH),
			priority: has(template, 'priority') ? input.priority : DEFAULT_PRIORITY,
			due: has(template, 'due') && input.due !== '' ? input.due : null,
			project: has(template, 'project') && input.project !== '' ? input.project : null,
			tagIds: has(template, 'tags') ? [...new Set(input.tagIds)] : [],
			tagNames: tag === null ? [] : [tag],
			sourceDate: event
				? toPocketBaseTimestamp(berlinWallClockToUtc(input.date, input.time || '00:00'))
				: null,
			sourceMeta: event
				? {
						...(line(input.place) === '' ? {} : { location: line(input.place) }),
						...(input.time === '' ? { all_day: true } : {})
					}
				: {}
		}
	};
}

/** Tag IDs of a capture: those chosen in the form, then those of the template, each once. */
function allTags(capture: Capture, templateTagIds: readonly string[]): string[] {
	return [...new Set([...capture.tagIds, ...templateTagIds])];
}

/** Ticket of a capture (target "ticket", source "manual"). */
export function captureTicketDraft(
	capture: Capture,
	templateTagIds: readonly string[]
): TicketDraft {
	return {
		title: capture.title,
		description: capture.description,
		status: DEFAULT_STATUS,
		priority: capture.priority,
		due: capture.due,
		project: capture.project,
		tags: allTags(capture, templateTagIds)
	};
}

/**
 * Inbox entry of a capture (target "inbox", channel "manual", kind of the template). Project,
 * tags, priority and due date travel as preset and fill the form when the entry is converted.
 */
export function captureInboxDraft(capture: Capture, templateTagIds: readonly string[]): InboxDraft {
	const preset = presetMeta({
		project: capture.project,
		tagIds: allTags(capture, templateTagIds),
		priority: capture.priority === DEFAULT_PRIORITY ? null : capture.priority,
		due: capture.due
	});
	return {
		channel: 'manual',
		kind: capture.kind,
		title: capture.title,
		body: capture.body,
		sourceDate: capture.sourceDate,
		sourceMeta: {
			...capture.sourceMeta,
			template: TEMPLATE_VALUES[capture.template],
			...(Object.keys(preset).length > 0 ? { [PRESET_META_KEY]: preset } : {})
		}
	};
}
