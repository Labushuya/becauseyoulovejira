// Sub-tasks (ADR-0033): order and progress of the section "Unteraufgaben", the path of a sub-task
// and the texts. The texts of the hook codes are compared with the hook in
// tests/unit/web-subtasks.test.mjs.

import { describe, expect, it } from 'vitest';
import type { TicketSummary } from './ticket';
import {
	COMPLETION_CHOICES,
	COMPLETION_LABELS,
	arrangeBy,
	arrangeRows,
	compareSubtasks,
	completionHint,
	isKnownParent,
	keysText,
	limitBlocks,
	nestedInOrder,
	openBlocking,
	openChildrenMessage,
	openChildrenQuestion,
	parentOf,
	parentSeriesOf,
	parentTicketOf,
	parentSeriesText,
	progressLabel,
	progressPercent,
	progressText,
	SERIES_ORIGIN_TEXTS,
	UNKNOWN_PARENT_KEY,
	subtaskCountText,
	subtaskOfText,
	subtaskProgress,
	subtaskSeriesOrigin
} from './subtasks';

describe('texts of the sub-tasks', () => {
	it('counts one and several sub-tasks', () => {
		expect(subtaskCountText(1)).toBe('1 Unteraufgabe');
		expect(subtaskCountText(3)).toBe('3 Unteraufgaben');
		expect(openChildrenMessage(1)).toBe('1 Unteraufgabe ist noch offen.');
		expect(openChildrenMessage(4)).toBe('4 Unteraufgaben sind noch offen.');
	});
});

describe('order of the sub-tasks', () => {
	const sub = (id: string, status: 'open' | 'done' | 'waiting', created: string) => ({
		id,
		status,
		created
	});

	it('puts open ones first, then sorts by creation and ID', () => {
		const list = [
			sub('d', 'done', '2026-09-01 10:00:00.000Z'),
			sub('c', 'open', '2026-09-03 10:00:00.000Z'),
			sub('b', 'waiting', '2026-09-02 10:00:00.000Z'),
			sub('a', 'open', '2026-09-03 10:00:00.000Z'),
			sub('e', 'done', '2026-08-01 10:00:00.000Z')
		];

		expect([...list].sort(compareSubtasks).map((entry) => entry.id)).toEqual([
			'b',
			'a',
			'c',
			'e',
			'd'
		]);
	});
});

describe('progress of the sub-tasks', () => {
	it('counts the done ones of all', () => {
		const progress = subtaskProgress([
			{ status: 'done' },
			{ status: 'open' },
			{ status: 'done' },
			{ status: 'in_progress' },
			{ status: 'backlog' }
		]);

		expect(progress).toEqual({ done: 2, total: 5 });
		expect(progressText(progress)).toBe('2/5 erledigt');
		expect(progressLabel(progress)).toBe('2 von 5 Unteraufgaben erledigt');
		expect(progressPercent(progress)).toBe(40);
	});

	it('has nothing to show without sub-tasks', () => {
		const progress = subtaskProgress([]);

		expect(progress).toEqual({ done: 0, total: 0 });
		expect(progressPercent(progress)).toBe(0);
		expect(progressLabel({ done: 0, total: 1 })).toBe('0 von 1 Unteraufgabe erledigt');
	});
});

describe('question before completing (ADR-0033 section 2)', () => {
	it('asks with the number of open sub-tasks', () => {
		expect(openChildrenQuestion(1)).toBe('1 Unteraufgabe ist noch offen – trotzdem erledigen?');
		expect(openChildrenQuestion(3)).toBe('3 Unteraufgaben sind noch offen – trotzdem erledigen?');
	});

	it('names up to three keys and counts the rest', () => {
		expect(keysText([])).toBe('');
		expect(keysText(['HAUS-13'])).toBe('HAUS-13');
		expect(keysText(['HAUS-13', 'HAUS-14'])).toBe('HAUS-13 und HAUS-14');
		expect(keysText(['HAUS-13', 'HAUS-14', 'HAUS-15'])).toBe('HAUS-13, HAUS-14 und HAUS-15');
		expect(keysText(['A-1', 'A-2', 'A-3', 'A-4'])).toBe('A-1, A-2, A-3 und 1 weitere');
		expect(keysText(['A-1', 'A-2', 'A-3', 'A-4', 'A-5'], 7)).toBe('A-1, A-2, A-3 und 4 weitere');
	});

	it('says what each answer does', () => {
		expect(COMPLETION_CHOICES).toEqual(['complete_children', 'force']);
		expect(COMPLETION_LABELS).toEqual({
			complete_children: 'Unteraufgaben mit erledigen',
			force: 'Trotzdem erledigen'
		});
		expect(completionHint('complete_children', ['HAUS-13'], 1)).toBe(
			'HAUS-13 wird ebenfalls erledigt.'
		);
		expect(completionHint('complete_children', ['HAUS-13', 'HAUS-14'], 2)).toBe(
			'HAUS-13 und HAUS-14 werden ebenfalls erledigt.'
		);
		expect(completionHint('force', ['HAUS-13'], 1)).toBe('Die Unteraufgabe bleibt offen.');
		expect(completionHint('force', ['HAUS-13', 'HAUS-14'], 2)).toBe(
			'Die Unteraufgaben bleiben offen.'
		);
	});

	it('counts only open sub-tasks that block', () => {
		const list = [
			{ id: 'a', status: 'open' as const, blocksParent: true },
			{ id: 'b', status: 'done' as const, blocksParent: true },
			{ id: 'c', status: 'waiting' as const, blocksParent: false },
			{ id: 'd', status: 'in_progress' as const }
		];

		expect(openBlocking(list).map((entry) => entry.id)).toEqual(['a', 'd']);
	});
});

describe('arrangeRows (ADR-0033 section 5)', () => {
	const row = (id: string, parentId: string | null = null) =>
		({ id, key: id.toUpperCase(), title: `Titel ${id}`, parentId }) as TicketSummary;
	const find = (id: string) => ({ id, key: id.toUpperCase(), title: `Titel ${id}` });
	const shape = (rows: ReturnType<typeof arrangeRows<TicketSummary>>) =>
		rows.map((entry) => {
			const indent = entry.nested ? '  ' : '';
			return `${indent}${entry.ticket.id}${entry.parent ? `<${entry.parent.key}` : ''}`;
		});

	it('puts sub-tasks directly below their parent when both are shown, in the sorted order', () => {
		const list = [row('a1', 'p'), row('x'), row('p'), row('a2', 'p'), row('q'), row('b', 'q')];

		expect(shape(arrangeRows(list, true, find))).toEqual([
			'x',
			'p',
			'  a1<P',
			'  a2<P',
			'q',
			'  b<Q'
		]);
	});

	it('keeps a sub-task at its place with its parent for the path when the parent is not shown', () => {
		const list = [row('a1', 'p'), row('x'), row('b', 'q'), row('q')];

		expect(shape(arrangeRows(list, true, find))).toEqual(['a1<P', 'x', 'q', '  b<Q']);
	});

	it('keeps every ticket at its place without nesting', () => {
		const list = [row('a1', 'p'), row('p'), row('x')];

		expect(shape(arrangeRows(list, false, find))).toEqual(['a1<P', 'p', 'x']);
	});

	it('changes nothing for a list without sub-tasks and knows an unknown parent by its ID', () => {
		expect(shape(arrangeRows([row('x'), row('y')], true, find))).toEqual(['x', 'y']);
		const rows = arrangeRows([row('a', 'gone')], true, () => null);
		expect(rows[0]?.parent).toEqual({ id: 'gone', key: '…', title: '' });
	});
});

describe('arrangeBy: any entry with a ticket (TP-3)', () => {
	const ticket = (id: string, parentId: string | null = null) =>
		({ id, key: id.toUpperCase(), title: `Titel ${id}`, parentId }) as TicketSummary;
	const find = (id: string) => ({ id, key: id.toUpperCase(), title: `Titel ${id}` });
	/** A suggestion of the day plan: the ticket and a reason. */
	const entry = (id: string, parentId: string | null = null) => ({
		ticket: ticket(id, parentId),
		reason: `Grund ${id}`
	});
	const shape = (rows: ReturnType<typeof arrangeBy<ReturnType<typeof entry>>>) =>
		rows.map(
			(row) =>
				`${row.nested ? '  ' : ''}${row.entry.ticket.id}${row.parent ? `<${row.parent.key}` : ''}`
		);

	it('arranges entries by the ticket it reads, the same as arrangeRows for the tickets', () => {
		const list = [entry('a1', 'p'), entry('x'), entry('p'), entry('a2', 'p'), entry('b', 'q')];

		const rows = arrangeBy(list, (item) => item.ticket, true, find);
		expect(shape(rows)).toEqual(['x', 'p', '  a1<P', '  a2<P', 'b<Q']);
		// The entries themselves come back, with all they carry.
		expect(rows[2]?.entry).toBe(list[0]);
		expect(rows[2]?.entry.reason).toBe('Grund a1');
		const tickets = list.map((item) => item.ticket);
		expect(
			arrangeRows(tickets, true, find).map((row) => [row.ticket.id, row.nested, row.parent?.key])
		).toEqual(rows.map((row) => [row.entry.ticket.id, row.nested, row.parent?.key]));
	});

	it('leaves every entry at its place without nesting', () => {
		const list = [entry('a1', 'p'), entry('p')];

		expect(shape(arrangeBy(list, (item) => item.ticket, false, find))).toEqual(['a1<P', 'p']);
	});
});

describe('limitBlocks (TP-3)', () => {
	const rows = (shape: string) =>
		shape.split(' ').map((part) => ({ id: part.replace('>', ''), nested: part.startsWith('>') }));
	const ids = (list: { id: string }[]) => list.map((row) => row.id).join(' ');

	it('takes whole blocks of a row and the rows indented below it', () => {
		const list = rows('a b >b1 >b2 c >c1');

		expect(ids(limitBlocks(list, 6))).toBe('a b b1 b2 c c1');
		expect(ids(limitBlocks(list, 5))).toBe('a b b1 b2');
		expect(ids(limitBlocks(list, 4))).toBe('a b b1 b2');
		// A block that does not fit counts not at all, and none after it follows.
		expect(ids(limitBlocks(list, 3))).toBe('a');
		expect(ids(limitBlocks(rows('a b >b1 >b2 c'), 3))).toBe('a');
	});

	it('shows the first block in full even when it alone is longer than the limit', () => {
		expect(ids(limitBlocks(rows('p >p1 >p2 >p3 x'), 2))).toBe('p p1 p2 p3');
		expect(ids(limitBlocks(rows('x y'), 1))).toBe('x');
		expect(limitBlocks([], 3)).toEqual([]);
	});
});

describe('nestedInOrder: the plan of a day (TP-3)', () => {
	const ticket = (id: string, parentId: string | null = null) => ({ id, parentId });

	it('indents a sub-task directly below its parent or an indented sibling', () => {
		expect(
			nestedInOrder([
				ticket('p'),
				ticket('a', 'p'),
				ticket('b', 'p'),
				ticket('x'),
				ticket('c', 'p'),
				ticket('q'),
				ticket('d', 'p')
			])
		).toEqual([false, true, true, false, false, false, false]);
	});

	it('never indents below a sub-task of another parent, a missing ticket or at the top', () => {
		expect(
			nestedInOrder([ticket('a', 'p'), ticket('p'), ticket('b', 'q'), ticket('c', 'p')])
		).toEqual([false, false, false, false]);
		expect(nestedInOrder([ticket('p'), null, ticket('a', 'p')])).toEqual([false, false, false]);
		expect(nestedInOrder([ticket('p'), ticket('a', 'p'), null, ticket('b', 'p')])).toEqual([
			false,
			true,
			false,
			false
		]);
		expect(nestedInOrder([])).toEqual([]);
	});
});

describe('parentTicketOf (TP-3)', () => {
	const PARENT = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };

	it('gives the object of the list, else the expanded one, never a made-up one', () => {
		const listed = { ...PARENT, title: 'Umzug nach Bonn' };
		const expanded = { ...PARENT };
		const ticket = { parentId: PARENT.id, parentRef: expanded };

		expect(parentTicketOf(ticket, (id) => (id === PARENT.id ? listed : null))).toBe(listed);
		expect(parentTicketOf(ticket, () => null)).toBe(expanded);
		expect(parentTicketOf({ parentId: PARENT.id, parentRef: null }, () => null)).toBeNull();
		expect(parentTicketOf({ parentId: null }, () => listed)).toBeNull();
	});
});

describe('parentOf', () => {
	const PARENT = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };

	it('is null for a top-level ticket', () => {
		expect(parentOf({ parentId: null }, () => PARENT)).toBeNull();
		expect(parentOf({}, () => PARENT)).toBeNull();
	});

	it('takes the version of the list first, so a new key shows at once', () => {
		const ticket = { parentId: PARENT.id, parentRef: { ...PARENT, key: 'TASK-4' } };

		expect(parentOf(ticket, (id) => (id === PARENT.id ? PARENT : null))).toEqual(PARENT);
		expect(parentOf(ticket, () => null)).toEqual({ ...PARENT, key: 'TASK-4' });
	});

	it('knows only the ID of a parent it cannot resolve', () => {
		expect(parentOf({ parentId: PARENT.id, parentRef: null }, () => null)).toEqual({
			id: PARENT.id,
			key: '…',
			title: ''
		});
	});
});

describe('text of the path for screen readers (TP-2)', () => {
	const PARENT = { id: 'parent000000001', key: 'HAUS-7', title: 'Wochenputz' };

	it('names the key in the table and key and title in the day plan', () => {
		expect(subtaskOfText(PARENT)).toBe('Unteraufgabe von HAUS-7:');
		expect(subtaskOfText(PARENT, true)).toBe('Unteraufgabe von HAUS-7 Wochenputz:');
		expect(subtaskOfText({ key: 'HAUS-7', title: '' }, true)).toBe('Unteraufgabe von HAUS-7:');
	});

	it('keeps the fallback of an unknown parent and opens only a known one', () => {
		const unknown = parentOf({ parentId: PARENT.id, parentRef: null }, () => null);
		expect(unknown?.key).toBe(UNKNOWN_PARENT_KEY);
		expect(subtaskOfText(unknown!, true)).toBe('Unteraufgabe von …:');
		expect(isKnownParent(unknown!)).toBe(false);
		expect(isKnownParent(PARENT)).toBe(true);
	});
});

describe('a sub-task of a ticket of a series (UT-1)', () => {
	const RULE = 'rule00000000001';
	const BY_RULE = { user: '', oldValue: RULE };
	const BY_PERSON = { user: 'user00000000001', oldValue: '' };

	it('finds the series of the parent in the list, else in the expanded parent (also a done one)', () => {
		const sub = {
			parentId: 'p1',
			parentRef: { id: 'p1', key: 'HAUS-7', title: 'Wochenputz', recurrenceId: RULE }
		};
		expect(parentSeriesOf(sub, () => ({ key: 'HAUS-8', recurrenceId: 'rule2' }))).toEqual({
			key: 'HAUS-8',
			recurrenceId: 'rule2'
		});
		expect(parentSeriesOf(sub, () => null)).toEqual({ key: 'HAUS-7', recurrenceId: RULE });
		// No series, no parent, or a parent without anything known: null.
		expect(parentSeriesOf(sub, () => ({ key: 'HAUS-7', recurrenceId: null }))).toBeNull();
		expect(parentSeriesOf({ parentId: null, parentRef: null }, () => null)).toBeNull();
		expect(parentSeriesOf({ parentId: 'p1', parentRef: null }, () => null)).toBeNull();
		expect(
			parentSeriesOf(
				{ parentId: 'p1', parentRef: { id: 'p1', key: 'HAUS-7', title: '' } },
				() => null
			)
		).toBeNull();
	});

	it('says which series, with the rhythm when it is known', () => {
		expect(parentSeriesText({ key: 'HAUS-7' }, 'jeden Montag')).toBe(
			'Teil von HAUS-7 · wiederholt sich jeden Montag'
		);
		expect(parentSeriesText({ key: 'HAUS-7' }, '')).toBe('Teil von HAUS-7 · wiederholt sich');
		expect(SERIES_ORIGIN_TEXTS).toEqual({
			template: 'aus der Vorlage – wird mit jedem Termin neu angelegt',
			single: 'nur für diesen Termin'
		});
	});

	it('knows a copy of the template only when the rule made it and the template still has its title', () => {
		const origin = (
			created: { user: string; oldValue: string } | null,
			titles: string[] | null,
			title = 'Fenster putzen'
		) => subtaskSeriesOrigin({ title, created, ruleId: RULE, templateTitles: titles });
		expect(origin(BY_RULE, ['Bad', ' fenster PUTZEN '])).toBe('template');
		// The template changed since, another rule made it, unknown history or rule: nothing for sure.
		expect(origin(BY_RULE, ['Bad'])).toBeNull();
		expect(origin({ user: '', oldValue: 'rule2' }, ['Fenster putzen'])).toBeNull();
		expect(origin(null, ['Fenster putzen'])).toBeNull();
		expect(origin(BY_RULE, null)).toBeNull();
	});

	it('knows a sub-task of this date only when a person added it and the template has no such entry', () => {
		const origin = (titles: string[] | null) =>
			subtaskSeriesOrigin({
				title: 'Fenster putzen',
				created: BY_PERSON,
				ruleId: RULE,
				templateTitles: titles
			});
		expect(origin([])).toBe('single');
		expect(origin(['Bad'])).toBe('single');
		// "Neues Ticket" with "Unteraufgaben auch jedem künftigen Ticket der Serie geben": both at once.
		expect(origin(['Fenster putzen'])).toBeNull();
		expect(origin(null)).toBeNull();
		// The superuser (no user, no rule): nothing for sure.
		expect(
			subtaskSeriesOrigin({
				title: 'X',
				created: { user: '', oldValue: '' },
				ruleId: RULE,
				templateTitles: []
			})
		).toBeNull();
	});
});
