// Bulk actions of the ticket table (plan BI-2, ADR-0036 §3 to §5): the change per ticket, skips,
// restores, the order of "Erledigen" and the texts.

import { describe, expect, it } from 'vitest';
import {
	SKIP_REASONS,
	actionLabel,
	completionOrder,
	planStep,
	restorePatch,
	resultTitle,
	shiftDays,
	validShift
} from './bulk';
import type { TicketSummary } from './ticket';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 'ticket000000001',
		key: 'HAUS-1',
		title: 'Fenster putzen',
		status: 'open',
		priority: 'medium',
		due: '2026-10-01',
		projectId: 'project00000001',
		tagIds: ['tag000000000001'],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

describe('planStep: due date', () => {
	it('sets, clears and shifts by days or weeks, across month ends', () => {
		expect(planStep(ticket(), { kind: 'due', mode: 'set', date: '2026-12-24' })).toEqual({
			type: 'change',
			patch: { due: '2026-12-24' }
		});
		expect(planStep(ticket(), { kind: 'due', mode: 'clear' })).toEqual({
			type: 'change',
			patch: { due: null }
		});
		expect(
			planStep(ticket({ due: '2026-10-30' }), {
				kind: 'due',
				mode: 'shift',
				amount: 3,
				unit: 'days'
			})
		).toEqual({ type: 'change', patch: { due: '2026-11-02' } });
		expect(planStep(ticket(), { kind: 'due', mode: 'shift', amount: -2, unit: 'weeks' })).toEqual({
			type: 'change',
			patch: { due: '2026-09-17' }
		});
	});

	it('skips shifting a ticket without due date and leaves equal dates unchanged', () => {
		expect(
			planStep(ticket({ due: null }), { kind: 'due', mode: 'shift', amount: 1, unit: 'days' })
		).toEqual({ type: 'skip', reason: SKIP_REASONS.noDue });
		expect(planStep(ticket({ due: null }), { kind: 'due', mode: 'clear' })).toEqual({
			type: 'unchanged'
		});
		expect(planStep(ticket(), { kind: 'due', mode: 'set', date: '2026-10-01' })).toEqual({
			type: 'unchanged'
		});
	});

	it('takes the date of the source event and skips tickets without one', () => {
		const sources = new Map([['ticket000000001', '2026-11-05']]);
		expect(planStep(ticket(), { kind: 'due', mode: 'source' }, sources)).toEqual({
			type: 'change',
			patch: { due: '2026-11-05' }
		});
		expect(
			planStep(ticket({ id: 'ticket000000002' }), { kind: 'due', mode: 'source' }, sources)
		).toEqual({ type: 'skip', reason: SKIP_REASONS.noSourceDate });
	});
});

describe('planStep: other fields', () => {
	it('changes priority, status and project only when they differ', () => {
		expect(planStep(ticket(), { kind: 'priority', value: 'high' })).toEqual({
			type: 'change',
			patch: { priority: 'high' }
		});
		expect(planStep(ticket(), { kind: 'priority', value: 'medium' })).toEqual({
			type: 'unchanged'
		});
		expect(planStep(ticket(), { kind: 'status', value: 'waiting' })).toEqual({
			type: 'change',
			patch: { status: 'waiting' }
		});
		expect(planStep(ticket(), { kind: 'project', projectId: null })).toEqual({
			type: 'change',
			patch: { project: null }
		});
		expect(planStep(ticket(), { kind: 'project', projectId: 'project00000001' })).toEqual({
			type: 'unchanged'
		});
	});

	it('adds and removes tags, keeping the order of the others', () => {
		const tagged = ticket({ tagIds: ['t1', 't2'] });
		expect(planStep(tagged, { kind: 'tags', mode: 'add', tagIds: ['t2', 't3'] })).toEqual({
			type: 'change',
			patch: { tags: ['t1', 't2', 't3'] }
		});
		expect(planStep(tagged, { kind: 'tags', mode: 'remove', tagIds: ['t1', 't9'] })).toEqual({
			type: 'change',
			patch: { tags: ['t2'] }
		});
		expect(planStep(tagged, { kind: 'tags', mode: 'add', tagIds: ['t1'] })).toEqual({
			type: 'unchanged'
		});
		expect(planStep(tagged, { kind: 'tags', mode: 'remove', tagIds: ['t9'] })).toEqual({
			type: 'unchanged'
		});
	});

	it('sets and removes the own color only when it differs (ADR-0052)', () => {
		expect(planStep(ticket({ color: null }), { kind: 'color', value: 'blau' })).toEqual({
			type: 'change',
			patch: { color: 'blau' }
		});
		expect(planStep(ticket({ color: 'blau' }), { kind: 'color', value: 'blau' })).toEqual({
			type: 'unchanged'
		});
		expect(planStep(ticket({ color: 'blau' }), { kind: 'color', value: null })).toEqual({
			type: 'change',
			patch: { color: null }
		});
		// Before the restart the ticket knows no color: "Wie Projekt" changes nothing.
		expect(planStep(ticket(), { kind: 'color', value: null })).toEqual({ type: 'unchanged' });
		expect(actionLabel({ kind: 'color', value: 'blau' })).toBe('Farbe ändern');
		expect(restorePatch(ticket({ color: 'senf' }), { color: 'blau' })).toEqual({ color: 'senf' });
		expect(restorePatch(ticket(), { color: 'blau' })).toEqual({ color: null });
	});
});

describe('restorePatch', () => {
	it('restores exactly the changed fields with their values from before', () => {
		const before = ticket({ tagIds: ['t1'] });
		expect(restorePatch(before, { due: null })).toEqual({ due: '2026-10-01' });
		expect(restorePatch(before, { priority: 'high', status: 'waiting' })).toEqual({
			priority: 'medium',
			status: 'open'
		});
		expect(restorePatch(before, { project: null })).toEqual({ project: 'project00000001' });
		const restore = restorePatch(before, { tags: ['t1', 't2'] });
		expect(restore).toEqual({ tags: ['t1'] });
		expect(restore.tags).not.toBe(before.tagIds);
	});
});

describe('helpers', () => {
	it('puts sub-tasks before the other tickets for "Erledigen"', () => {
		const parent = ticket({ id: 'p', key: 'HAUS-1' });
		const child = ticket({ id: 'c', key: 'HAUS-2', parentId: 'p' });
		const other = ticket({ id: 'o', key: 'HAUS-3' });
		expect(completionOrder([parent, child, other]).map((entry) => entry.id)).toEqual([
			'c',
			'p',
			'o'
		]);
	});

	it('counts weeks as seven days and accepts only whole shifts within the limit', () => {
		expect(shiftDays(2, 'weeks')).toBe(14);
		expect(shiftDays(-3, 'days')).toBe(-3);
		expect(validShift(1)).toBe(true);
		expect(validShift(-3650)).toBe(true);
		for (const value of [0, 1.5, 3651, Number.NaN])
			expect(validShift(value), String(value)).toBe(false);
	});

	it('names actions and results', () => {
		expect(actionLabel({ kind: 'tags', mode: 'remove', tagIds: [] })).toBe('Tags entfernen');
		// Named like the button "In den Papierkorb …" of the bar (plan aktionsmenues, AM-3).
		expect(actionLabel({ kind: 'delete', sources: 'inbox' })).toBe('In den Papierkorb verschieben');
		expect(resultTitle({ changed: 1, skipped: 0, unchanged: 0, failed: 0 }, 'erledigt')).toBe(
			'1 Ticket erledigt.'
		);
		expect(resultTitle({ changed: 3, skipped: 2, unchanged: 1, failed: 1 }, 'geändert')).toBe(
			'3 Tickets geändert, 1 unverändert, 2 übersprungen, 1 fehlgeschlagen.'
		);
	});
});
