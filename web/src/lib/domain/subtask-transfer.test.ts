// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070), the pure part of the dialog: the checkboxes with
// the values of the ticket and why one is locked, the choice in advance and how a device remembers it
// (never the project), open and done sub-tasks, the targets and how many of them change, the request
// it sends and the answer it reads.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TRANSFER_FIELDS,
	FIELD_TEXTS,
	NO_TRANSFER_FIELDS,
	OPEN_TARGETS,
	SUBTASK_TRANSFER_STORAGE_KEY,
	TRANSFER_TEXTS,
	chosenInAdvance,
	fieldOffers,
	fieldsOf,
	hasFields,
	initialFields,
	isOpenSubtask,
	parseRememberedFields,
	rememberedOf,
	serializeRememberedFields,
	summaryText,
	targetFailureText,
	targetsOf,
	targetsRequest,
	toTransferOutcome,
	transferRequestBody,
	transferSummary,
	transferredText,
	type TransferNames
} from './subtask-transfer';
import type { ProjectRef, TicketSummary } from './ticket';

const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARDEN: ProjectRef = {
	id: 'proj00000000002',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS' }
};

let sequence = 0;
function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-10-01 10:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z',
		...overrides
	};
}

const NAMES: TransferNames = { project: null, tags: [], assignee: null };
const fieldsOfOffers = (parent: TicketSummary, names: TransferNames = NAMES) =>
	fieldOffers(parent, names).map((offer) => offer.field);

describe('the checkboxes', () => {
	it('name every field with the value of the ticket, the assignee only where the area has one', () => {
		const parent = ticket({ due: '2026-10-12', priority: 'high', status: 'in_progress' });
		const offers = fieldOffers(parent, {
			project: GARDEN,
			tags: ['Garten', 'Haus'],
			assignee: 'Anna Beispiel'
		});
		expect(offers.map((offer) => [offer.field, `${offer.label}: ${offer.value}`])).toEqual([
			['due', 'Gleiche Fälligkeit wie das Hauptticket: 12.10.2026'],
			['priority', 'Priorität: Hoch'],
			['status', 'Status: In Arbeit'],
			['assignee', 'Zuständigkeit: Anna Beispiel'],
			['tags', 'Tags hinzufügen: Garten, Haus'],
			['project', 'Projekt: Haus › Garten']
		]);
		expect(offers.every((offer) => offer.locked === null)).toBe(true);
		expect(fieldsOfOffers(parent)).toEqual(['due', 'priority', 'status', 'tags', 'project']);
		expect(
			fieldOffers(parent, { ...NAMES, assignee: '' }).find((offer) => offer.field === 'assignee')
				?.value
		).toBe('Niemand');
	});

	it('keep "no due date" offered with its consequence, and say that a project gives new keys', () => {
		const offers = fieldOffers(ticket(), NAMES);
		expect(offers[0]).toMatchObject({ value: 'keine', hint: FIELD_TEXTS.dueLost, locked: null });
		expect(FIELD_TEXTS.dueLost).toBe('Die Unteraufgaben verlieren ihre Fälligkeit.');
		expect(offers.find((offer) => offer.field === 'project')).toMatchObject({
			value: 'kein Projekt',
			hint: 'Die Unteraufgaben erhalten neue Schlüssel.',
			locked: null
		});
		expect(offers.find((offer) => offer.field === 'tags')?.hint).toBeNull();
	});

	it('lock tags without any and an archived project, each with the reason; never the status', () => {
		const offers = fieldOffers(ticket({ status: 'done' }), {
			...NAMES,
			project: { ...HOUSE, archived: true }
		});
		expect(offers.find((offer) => offer.field === 'tags')?.locked).toBe(
			'Das Hauptticket hat keine Tags.'
		);
		expect(offers.find((offer) => offer.field === 'project')?.locked).toBe(
			'Das Projekt des Haupttickets ist archiviert.'
		);
		expect(offers.find((offer) => offer.field === 'status')?.locked).toBeNull();
	});
});

describe('the choice in advance', () => {
	it('is due date and priority, the due date only when the ticket has one', () => {
		const offers = (parent: TicketSummary) => fieldOffers(parent, NAMES);
		const dated = ticket({ due: '2026-10-12' });
		expect([...initialFields(DEFAULT_TRANSFER_FIELDS, offers(dated), dated)]).toEqual([
			'due',
			'priority'
		]);
		const undated = ticket();
		expect([...initialFields(DEFAULT_TRANSFER_FIELDS, offers(undated), undated)]).toEqual([
			'priority'
		]);
	});

	it('takes the remembered fields that are offered and unlocked, never the project', () => {
		const parent = ticket({ due: '2026-10-12' });
		const offers = fieldOffers(parent, { ...NAMES, assignee: 'Anna Beispiel' });
		expect([...initialFields(['status', 'assignee', 'tags', 'project'], offers, parent)]).toEqual([
			'status',
			'assignee'
		]);
		// Without assignees in the area the remembered assignee is left out.
		expect([...initialFields(['assignee'], fieldOffers(parent, NAMES), parent)]).toEqual([]);
	});

	it('is remembered per device without the project, under byl-subtask-transfer-fields', () => {
		expect(SUBTASK_TRANSFER_STORAGE_KEY).toBe('byl-subtask-transfer-fields');
		expect(rememberedOf(['project', 'tags', 'due'])).toEqual(['due', 'tags']);
		expect(serializeRememberedFields(['project', 'status', 'priority'])).toBe(
			'["priority","status"]'
		);
		expect(parseRememberedFields('["status","project","unbekannt","status"]')).toEqual(['status']);
		// The project alone was the last choice: nothing in advance.
		expect(parseRememberedFields('[]')).toEqual([]);
		for (const raw of [null, undefined, 'kaputt', '{"due":true}', '"due"']) {
			expect(parseRememberedFields(raw), String(raw)).toEqual(['due', 'priority']);
		}
	});
});

describe('the targets', () => {
	const parent = ticket({ id: 'parent000000001' });
	const open = ticket({ parentId: parent.id, status: 'open' });
	const waiting = ticket({ parentId: parent.id, status: 'waiting' });
	const backlog = ticket({ parentId: parent.id, status: 'backlog' });
	const done = ticket({ parentId: parent.id, status: 'done' });
	const subtasks = [open, waiting, backlog, done];

	it('count every status but "Erledigt" as open (the category "abgeschlossen")', () => {
		expect(subtasks.map(isOpenSubtask)).toEqual([true, true, true, false]);
	});

	it('are the open sub-tasks with "Alle offenen", sent as "open" for the server to decide', () => {
		expect(targetsOf(subtasks, OPEN_TARGETS)).toEqual([open, waiting, backlog]);
		expect(targetsRequest(subtasks, OPEN_TARGETS)).toBe('open');
		expect(TRANSFER_TEXTS.allOpen(3)).toBe('Alle offenen Unteraufgaben (3)');
	});

	it('start "Auswählen …" with the open ones; done ones stand in the list but are not chosen', () => {
		const advance = chosenInAdvance(subtasks);
		expect(advance.mode === 'chosen' && [...advance.ids]).toEqual([
			open.id,
			waiting.id,
			backlog.id
		]);
		const chosen = { mode: 'chosen' as const, ids: new Set([done.id, open.id]) };
		// In the order of the list (one level of sub-tasks, ADR-0033), sent as IDs.
		expect(targetsOf(subtasks, chosen)).toEqual([open, done]);
		expect(targetsRequest(subtasks, chosen)).toEqual([open.id, done.id]);
		expect(targetsOf(subtasks, { mode: 'chosen', ids: new Set() })).toEqual([]);
	});
});

describe('what changes', () => {
	const tagA = 'tag000000000001';
	const parent = ticket({
		due: '2026-10-12',
		priority: 'high',
		status: 'done',
		tagIds: [tagA],
		projectId: HOUSE.id,
		assignee: 'user0000000000a'
	});

	it('counts only sub-tasks that do not have every chosen value already', () => {
		const same = ticket({ priority: 'high', due: '2026-10-12' });
		const other = ticket({ priority: 'low' });
		const fields = fieldsOf(new Set(['due', 'priority'] as const), parent);
		const summary = transferSummary(parent, [same, other, ticket()], fields);
		expect(summary).toEqual({ total: 3, changing: 2, ongoing: 0 });
		expect(summaryText(summary)).toBe('Ändert 2 von 3 Unteraufgaben.');
		expect(summaryText(transferSummary(parent, [same], fields))).toBe(
			'Ändert keine der 1 gewählten Unteraufgabe: Sie haben diese Werte schon.'
		);
		expect(summaryText(transferSummary(parent, [], fields))).toBe('Keine Unteraufgabe gewählt.');
	});

	it('adds the tags of the ticket and keeps the own ones (only adding in UE-1)', () => {
		const fields = fieldsOf(new Set(['tags'] as const), parent);
		expect(fields.tags).toEqual({ add: [tagA], remove: [] });
		const tagged = ticket({ tagIds: ['tag000000000009', tagA] });
		expect(transferSummary(parent, [tagged, ticket()], fields).changing).toBe(1);
		// Without tags of the ticket there is nothing to add.
		expect(fieldsOf(new Set(['tags'] as const), ticket()).tags).toBeNull();
	});

	it('names the ongoing projects a status "Erledigt" completes, like the question of a single change', () => {
		const fields = fieldsOf(new Set(['status'] as const), parent);
		const ongoing = ticket({ kind: 'ongoing' });
		const summary = transferSummary(
			parent,
			[ongoing, ticket(), ticket({ kind: 'ongoing' })],
			fields
		);
		expect(summary).toEqual({ total: 3, changing: 3, ongoing: 2 });
		expect(summaryText(summary)).toBe(
			'Ändert 3 von 3 Unteraufgaben. Darunter sind 2 laufende Vorhaben; sie werden damit abgeschlossen.'
		);
		expect(summaryText({ total: 1, changing: 1, ongoing: 1 })).toBe(
			'Ändert 1 von 1 Unteraufgabe. Darunter ist ein laufendes Vorhaben; es wird damit abgeschlossen.'
		);
	});

	it('needs at least one field', () => {
		expect(hasFields(NO_TRANSFER_FIELDS)).toBe(false);
		expect(hasFields(fieldsOf(new Set(['project'] as const), parent))).toBe(true);
		expect(hasFields(fieldsOf(new Set(['tags'] as const), ticket()))).toBe(false);
	});
});

describe('request, answer and texts', () => {
	it('sends the chosen fields and the targets with the known state of the ticket', () => {
		expect(
			transferRequestBody({
				expectedUpdated: '2026-10-02 10:00:00.000Z',
				fields: { ...NO_TRANSFER_FIELDS, due: { mode: 'same' }, priority: true },
				targets: ['child0000000001']
			})
		).toEqual({
			expected_updated: '2026-10-02 10:00:00.000Z',
			fields: { due: { mode: 'same' }, priority: true },
			targets: ['child0000000001']
		});
	});

	it('reads the answer with the keys before and after', () => {
		expect(
			toTransferOutcome({
				parent: { id: 'p', key: 'HAUS-1' },
				changed: 1,
				unchanged: 2,
				tickets: [{ id: 'c', key: 'GART-4', previous_key: 'HAUS-2' }]
			})
		).toEqual({
			parent: { id: 'p', key: 'HAUS-1' },
			changed: 1,
			unchanged: 2,
			tickets: [{ id: 'c', key: 'GART-4', previousKey: 'HAUS-2' }]
		});
		expect(
			toTransferOutcome({ parent: { id: 'p' }, changed: 1, unchanged: 0, tickets: [] })
		).toBeNull();
		expect(toTransferOutcome('ok')).toBeNull();
	});

	it('words the flag and a refused sub-task', () => {
		expect(transferredText(3)).toBe('Auf 3 Unteraufgaben übertragen.');
		expect(transferredText(1)).toBe('Auf 1 Unteraufgabe übertragen.');
		expect(transferredText(0)).toBe(
			'Nichts übertragen: Die Unteraufgaben hatten diese Werte schon.'
		);
		expect(targetFailureText('GART-3', 'Das Projekt ist archiviert.')).toBe(
			'GART-3: Das Projekt ist archiviert.'
		);
		expect(TRANSFER_TEXTS.action).toBe('Auf Unteraufgaben übertragen …');
		expect(TRANSFER_TEXTS.restart).toBe(
			'Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.'
		);
	});
});
