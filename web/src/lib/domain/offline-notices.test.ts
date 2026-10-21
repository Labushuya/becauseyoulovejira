// Pure rules of the notices of the outbox on the device (OF-3c, ADR-0074 addendum OF-3c): the form
// kept per account, the words made when they show, the same notice once, closing as a compare-and-swap,
// what the deletion after 7 days names (R3-5, R3-6) and when a later change of a sub-task decides
// instead of its notice (R3-4).

import { describe, expect, it } from 'vitest';
import {
	changeOf,
	changeText,
	type DayPlanAction,
	type DueAction,
	type OutboxAction
} from './offline';
import {
	childNotice,
	decidesInstead,
	droppedEntries,
	noticeText,
	parseNotice,
	parseNotices,
	withDropped,
	withNotices,
	withoutDecided,
	withoutNotice,
	type DroppedNotice
} from './offline-notices';

const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const FIRST = 'aaaaaaaaaaaaaaaaaaa1';
const SECOND = 'aaaaaaaaaaaaaaaaaaa2';

function status(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: FIRST,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: 'tick00000000001',
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

function dropped(entries: DroppedNotice['entries'], id = 'dropped-1'): DroppedNotice {
	return { v: 1, id, kind: 'dropped', at: NOW, entries };
}

/** The notice about `child` after the completion of HAUS-12 (op FIRST, seq 1, unless overridden). */
function completed(
	child: { id: string; key: string },
	completion: Partial<Pick<OutboxAction, 'op' | 'seq' | 'key'>> = {},
	at = NOW
) {
	return childNotice({ op: FIRST, seq: 1, key: 'HAUS-12', ...completion }, child, at);
}

describe('the words of a notice, made when it shows', () => {
	it('names the deleted changes, every "Verwerfen" not carried out once, and where to look', () => {
		const back = { field: 'status', key: 'HAUS-12', status: 'done' } as const;
		const notice = dropped([
			{ op: FIRST, key: 'HAUS-12', undoes: back },
			{ op: SECOND, key: 'HAUS-12', undoes: back },
			{ op: 'aaaaaaaaaaaaaaaaaaa3', key: 'HAUS-13' }
		]);
		expect(noticeText(notice)).toBe(
			'3 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: HAUS-12, HAUS-13. Das Verwerfen von „HAUS-12 erledigt“ wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Bitte in den Tickets prüfen.'
		);
	});

	it('says "einer Änderung an" and "einem Ticket" where the change or the key is gone (R3-5)', () => {
		const notice = dropped([
			{ op: FIRST, key: 'HAUS-12', undoes: null },
			{ op: SECOND, key: '', undoes: null }
		]);
		expect(noticeText(notice)).toBe(
			'2 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: HAUS-12, ein Ticket. Das Verwerfen einer Änderung an HAUS-12 wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Das Verwerfen einer Änderung an einem Ticket wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Bitte in den Tickets prüfen.'
		);
		expect(noticeText(dropped([{ op: FIRST, key: '' }]))).toBe(
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: ein Ticket. Bitte im Ticket prüfen.'
		);
	});

	it('names a sub-task that is not done, with words where a key is missing (R3-5)', () => {
		const at = NOW;
		const text = (key: string, parent: string) =>
			noticeText(completed({ id: 'tick00000000003', key }, { key: parent }, at));
		expect(text('HAUS-13', 'HAUS-12')).toBe(
			'Unteraufgabe HAUS-13 ist nicht erledigt, obwohl sie mit HAUS-12 erledigt werden sollte. Bitte im Ticket prüfen.'
		);
		expect(text('', 'HAUS-12')).toBe(
			'Eine Unteraufgabe ist nicht erledigt, obwohl sie mit HAUS-12 erledigt werden sollte. Bitte im Ticket prüfen.'
		);
		expect(text('HAUS-13', '')).toBe(
			'Unteraufgabe HAUS-13 ist nicht erledigt, obwohl sie mit einem Ticket erledigt werden sollte. Bitte im Ticket prüfen.'
		);
	});

	it('keeps of a change only its key and value, and words it like the dialog', () => {
		const due: DueAction = {
			...status(),
			payload: { due: '2026-10-22' },
			expected: { due: null }
		};
		const check: DayPlanAction = {
			...status(),
			kind: 'dayplan.uncheck',
			target: 'item00000000001',
			ticket: 'tick00000000001',
			ticketKind: 'task',
			payload: { action: 'complete' },
			expected: { doneToday: true, status: 'done' }
		};
		expect(changeOf(status({ payload: { status: 'in_progress' } }))).toEqual({
			field: 'status',
			key: 'HAUS-12',
			status: 'in_progress'
		});
		expect(changeText(changeOf(due))).toBe('HAUS-12 fällig am 22.10.2026');
		expect(changeOf(check)).toEqual({ field: 'check', key: 'HAUS-12', check: 'uncheck' });
		expect(changeText(changeOf(check))).toBe('HAUS-12 im Tagesplan wieder offen');
	});
});

describe('the form on the device', () => {
	it('reads what this build wrote and leaves anything else out, oldest first', () => {
		const child = completed({ id: 'tick00000000003', key: 'HAUS-13' });
		const older = dropped([{ op: SECOND, key: 'HAUS-12' }], 'dropped-0');
		const stored = [
			child,
			{ ...older, at: NOW - 1 },
			{ v: 2, id: 'x', kind: 'dropped', at: NOW, entries: [] },
			{ v: 1, id: 'y', kind: 'unknown', at: NOW },
			{ v: 1, id: 'z', kind: 'dropped', at: NOW, entries: [{ op: FIRST, key: 1 }] },
			{ v: 1, id: 'w', kind: 'dropped', at: NOW, entries: [{ op: FIRST, key: '', undoes: 'x' }] },
			null
		];
		expect(parseNotices(stored).map((notice) => notice.id)).toEqual(['dropped-0', child.id]);
		expect(parseNotices('kaputt')).toEqual([]);
		expect(parseNotice({ ...child, key: 'x'.repeat(201) })).toBeNull();
	});

	it('adds a notice once: the same identifier or the same sub-task of the same ticket', () => {
		const child = completed({ id: 'tick00000000003', key: 'HAUS-13' });
		const again = completed({ id: 'tick00000000003', key: 'HAUS-13' }, { op: SECOND });
		const foreign = { v: 9, id: 'neu', kind: 'neu' };
		const first = withNotices([foreign], [child]);
		expect(first).toEqual([foreign, child]);
		expect(withNotices(first, [child])).toBeNull();
		expect(withNotices(first, [again])).toBeNull();
		const other = completed({ id: 'tick00000000004', key: 'HAUS-14' }, { op: SECOND });
		expect(withNotices(first, [other, other])).toEqual([foreign, child, other]);
	});

	it('writes each deleted action into the notice of its run, once', () => {
		const head = { id: 'dropped-1', at: NOW };
		const one = withDropped(undefined, head, { op: FIRST, key: 'HAUS-12' });
		expect(one).toEqual([dropped([{ op: FIRST, key: 'HAUS-12' }])]);
		const two = withDropped(one, head, { op: SECOND, key: 'HAUS-13' });
		expect(two).toEqual([
			dropped([
				{ op: FIRST, key: 'HAUS-12' },
				{ op: SECOND, key: 'HAUS-13' }
			])
		]);
		expect(withDropped(two, head, { op: SECOND, key: 'HAUS-13' })).toEqual(two);
	});

	it('closes a notice only as it was shown (compare-and-swap)', () => {
		const shown = dropped([{ op: FIRST, key: 'HAUS-12' }]);
		const foreign = { v: 9, id: 'neu' };
		expect(withoutNotice([foreign, shown], shown)).toEqual([foreign]);
		const grown = dropped([
			{ op: FIRST, key: 'HAUS-12' },
			{ op: SECOND, key: 'HAUS-13' }
		]);
		expect(withoutNotice([grown], shown)).toBeNull();
		expect(withoutNotice([foreign], shown)).toBeNull();
	});
});

describe('what the deletion after 7 days names', () => {
	const back = (overrides: Partial<OutboxAction> = {}) =>
		status({
			op: SECOND,
			seq: 2,
			dependsOn: [FIRST],
			undoes: FIRST,
			payload: { status: 'open' },
			expected: { status: 'done' },
			...overrides
		});

	it('names every action that goes, a take-back with the change it carried out', () => {
		const original = status({ discarded: true, sent: true, unanswered: true });
		expect(droppedEntries([original, back()], [FIRST, SECOND], [])).toEqual([
			{ op: FIRST, key: 'HAUS-12' },
			{ op: SECOND, key: 'HAUS-12', undoes: { field: 'status', key: 'HAUS-12', status: 'done' } }
		]);
		expect(droppedEntries([back()], [SECOND], [])).toEqual([
			{ op: SECOND, key: 'HAUS-12', undoes: null }
		]);
	});

	it('names no discarded change whose take-back stays and is sent (R3-6)', () => {
		const original = status({ discarded: true, sent: true, unanswered: true });
		expect(droppedEntries([original, back()], [FIRST], [back()])).toEqual([]);
		// One that was not discarded counts, whatever stays behind it.
		const kept = status({ sent: true, unanswered: true });
		expect(droppedEntries([kept, back()], [FIRST], [back()])).toEqual([
			{ op: FIRST, key: 'HAUS-12' }
		]);
	});
});

describe('a later change of the sub-task decides instead of its notice (R3-4)', () => {
	const CHILD = 'tick00000000003';
	const notice = completed({ id: CHILD, key: 'HAUS-13' }, { seq: 5 });
	const change = (overrides: Partial<OutboxAction> = {}) =>
		status({ op: SECOND, seq: 6, target: CHILD, payload: { status: 'in_progress' }, ...overrides });

	it('is a later change of the user that sets the status of the sub-task', () => {
		expect(decidesInstead(notice, change())).toBe(true);
		// Earlier in the order of the user, discarded, of another ticket, or not the status: no.
		expect(decidesInstead(notice, change({ seq: 4 }))).toBe(false);
		expect(decidesInstead(notice, change({ discarded: true }))).toBe(false);
		expect(decidesInstead(notice, change({ target: 'tick00000000004' }))).toBe(false);
		const due: DueAction = { ...change(), payload: { due: '2026-10-22' }, expected: { due: null } };
		expect(decidesInstead(notice, due)).toBe(false);
		// A later completion that takes the sub-task along decides as well.
		const along = status({
			op: SECOND,
			seq: 7,
			completion: 'complete_children',
			children: [CHILD],
			childrenBefore: ['open']
		});
		expect(decidesInstead(notice, along)).toBe(true);
		expect(decidesInstead(dropped([{ op: FIRST, key: 'HAUS-12' }]), change())).toBe(false);
	});

	it('takes the notices it decided along once it arrived, and nothing else', () => {
		const other = completed({ id: 'tick00000000004', key: 'HAUS-14' }, { seq: 5 });
		const foreign = { v: 9, id: 'neu' };
		expect(withoutDecided([foreign, notice, other], change())).toEqual([foreign, other]);
		expect(withoutDecided([foreign, other], change())).toBeNull();
		expect(withoutDecided(undefined, change())).toBeNull();
	});
});
