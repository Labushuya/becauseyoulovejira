// Pure rules of the trash (ADR-0037, package PB-1): retention, remaining days in Berlin calendar
// days (ADR-0005), the snapshot and the decisions of a restore.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('trash-rules.js');
const berlinTime = loadHookLib('berlin-time.js');
const cleanup = loadHookLib('inbox-cleanup.js');
const inboxRules = loadHookLib('inbox-rules.js');

const at = (text) => Date.parse(text);

describe('retention', () => {
	it('knows 7, 30, 90 days and never, with 30 as default', () => {
		expect(rules.RETENTION_VALUES).toEqual(['7', '30', '90', 'never']);
		expect(['7', '30', '90', 'never', '', undefined, null, '14', 30].map(rules.retentionDays)).toEqual([7, 30, 90, null, 30, 30, 30, 30, 30]);
		expect(rules.isRetention('90')).toBe(true);
		expect(rules.isRetention('')).toBe(false);
	});

	it('tells a ticket in the trash by deleted_at', () => {
		expect(rules.isTrashed('2026-09-28 10:00:00.000Z')).toBe(true);
		expect(rules.isTrashed('')).toBe(false);
		expect(rules.isTrashed(undefined)).toBe(false);
	});
});

describe('remaining days', () => {
	it('counts Berlin calendar days from the day of the move', () => {
		// 23:30 UTC on 30 September is 1 October in Berlin (summer time).
		expect(rules.purgeDate('2026-09-30 23:30:00.000Z', 30, berlinTime)).toBe('2026-10-31');
		expect(rules.purgeDate('2026-09-30 10:00:00.000Z', 30, berlinTime)).toBe('2026-10-30');
		expect(rules.purgeDate('2026-09-30 10:00:00.000Z', null, berlinTime)).toBeNull();
		expect(rules.purgeDate('', 30, berlinTime)).toBeNull();
	});

	it('says how many days are left, 0 on the day of deletion, and nothing for never', () => {
		const moved = '2026-10-20 09:00:00.000Z';
		expect(rules.daysLeft(moved, 30, at('2026-10-20T09:00:00Z'), berlinTime)).toBe(30);
		expect(rules.daysLeft(moved, 30, at('2026-11-18T22:59:00Z'), berlinTime)).toBe(1);
		// Winter time since 25 October: Berlin midnight is 23:00 UTC.
		expect(rules.daysLeft(moved, 30, at('2026-11-18T23:00:00Z'), berlinTime)).toBe(0);
		expect(rules.daysLeft(moved, 30, at('2027-01-01T00:00:00Z'), berlinTime)).toBe(0);
		expect(rules.daysLeft(moved, 7, at('2026-10-20T09:00:00Z'), berlinTime)).toBe(7);
		expect(rules.daysLeft(moved, null, at('2030-01-01T00:00:00Z'), berlinTime)).toBeNull();
	});

	it('is due from the Berlin day of deletion on, never for never', () => {
		const moved = '2026-03-01 10:00:00.000Z';
		expect(rules.isDue(moved, 30, at('2026-03-30T21:59:00Z'), berlinTime)).toBe(false);
		// Summer time begins on 29 March: 31 March starts at 22:00 UTC on 30 March.
		expect(rules.isDue(moved, 30, at('2026-03-30T22:00:00Z'), berlinTime)).toBe(true);
		expect(rules.isDue(moved, null, at('2099-01-01T00:00:00Z'), berlinTime)).toBe(false);
	});
});

describe('snapshot', () => {
	it('reads every key with empty defaults, from JSON text or an object', () => {
		const empty = {
			project: '',
			project_code: '',
			parent: '',
			recurrence: '',
			occurrence: '',
			source_item: '',
			sources: { handling: 'inbox', items: [] }
		};
		for (const raw of ['', 'null', '[]', '{', null, undefined, 42, []]) {
			expect(rules.readSnapshot(raw), String(raw)).toEqual(empty);
		}
		expect(
			rules.readSnapshot('{"project":"p1","project_code":"HAUS","sources":{"handling":"discard","items":["i1","",3,"i2"]}}')
		).toEqual({ ...empty, project: 'p1', project_code: 'HAUS', sources: { handling: 'discard', items: ['i1', 'i2'] } });
		expect(rules.readSnapshot({ sources: { handling: 'delete' } }).sources.handling).toBe('inbox');
	});
});

describe('decisions of a restore', () => {
	it('keeps the key without project or in the same project with the same code and scope', () => {
		const project = { scope: 'u:1', code: 'HAUS' };
		expect(rules.projectDecision({ snapshotProject: '', snapshotCode: '', project: null, ticketScope: 'u:1' })).toEqual({ action: 'keep' });
		expect(rules.projectDecision({ snapshotProject: 'p1', snapshotCode: 'HAUS', project, ticketScope: 'u:1' })).toEqual({ action: 'keep' });
		expect(rules.projectDecision({ snapshotProject: 'p1', snapshotCode: 'HAUS', project: null, ticketScope: 'u:1' })).toEqual({
			action: 'choose',
			reason: 'missing'
		});
		expect(
			rules.projectDecision({ snapshotProject: 'p1', snapshotCode: 'HAUS', project: { ...project, code: 'HEIM' }, ticketScope: 'u:1' })
		).toEqual({ action: 'choose', reason: 'changed' });
		expect(
			rules.projectDecision({ snapshotProject: 'p1', snapshotCode: 'HAUS', project: { ...project, scope: 'h:2' }, ticketScope: 'u:1' })
		).toEqual({ action: 'choose', reason: 'changed' });
	});

	it('takes no project or an active project of the scope as target', () => {
		expect(rules.targetViolation('', 'u:1')).toBe('');
		expect(rules.targetViolation({ scope: 'u:1', archived: false }, 'u:1')).toBe('');
		expect(rules.targetViolation({ scope: 'u:1', archived: true }, 'u:1')).toBe('validation_trash_project_invalid');
		expect(rules.targetViolation({ scope: 'h:2', archived: false }, 'u:1')).toBe('validation_trash_project_invalid');
		expect(rules.targetViolation(null, 'u:1')).toBe('validation_trash_project_invalid');
	});

	it('puts a sub-ticket back only to a live top-level parent of its scope', () => {
		expect(rules.reattachesParent({ scope: 'u:1', parent: '', trashed: false }, 'u:1')).toBe(true);
		expect(rules.reattachesParent({ scope: 'u:1', parent: '', trashed: true }, 'u:1')).toBe(false);
		expect(rules.reattachesParent({ scope: 'u:1', parent: 'x', trashed: false }, 'u:1')).toBe(false);
		expect(rules.reattachesParent({ scope: 'h:2', parent: '', trashed: false }, 'u:1')).toBe(false);
		expect(rules.reattachesParent(null, 'u:1')).toBe(false);
	});

	it('links a source again only while it is new without a ticket in the scope', () => {
		expect(rules.sourceSkip({ state: 'new', ticket: '', scope: 'u:1' }, 'u:1')).toBe('');
		expect(rules.sourceSkip({ state: 'converted', ticket: 't2', scope: 'u:1' }, 'u:1')).toBe('converted');
		expect(rules.sourceSkip({ state: 'discarded', ticket: '', scope: 'u:1' }, 'u:1')).toBe('discarded');
		expect(rules.sourceSkip({ state: 'new', ticket: '', scope: 'h:2' }, 'u:1')).toBe('missing');
		expect(rules.sourceSkip(null, 'u:1')).toBe('missing');
	});

	it('has a text for every code', () => {
		for (const code of [
			'validation_trash_managed',
			'validation_trash_stale',
			'validation_trash_group_member',
			'validation_trash_project_required',
			'validation_trash_project_invalid',
			'validation_trash_series_conflict',
			'validation_trash_source_handling'
		]) {
			expect(rules.MESSAGES[code], code).toMatch(/\S/);
		}
	});
});

describe('sources of a ticket deleted for good', () => {
	it('notes the ticket in the trash on the item', () => {
		expect(inboxRules.deletedTicketMeta({ chat: 'x' }, 'HAUS-1', 'now', 't1')).toEqual({
			chat: 'x',
			ticket_deleted: { key: 'HAUS-1', at: 'now', ticket: 't1' }
		});
		expect(inboxRules.deletedTicketMeta({}, 'HAUS-1', 'now', '')).toEqual({ ticket_deleted: { key: 'HAUS-1', at: 'now' } });
	});

	it('empties them at once with its own text, which the daily cleanup counts as cleaned', () => {
		const item = { title: 'Mail', body: 'Text', meta: { keyword: 'todo', from: 'a@example.com' }, original: 'mail.eml' };
		const purged = cleanup.purgedValues(item, inboxRules, cleanup.TRASH_PURGED_BODY);
		expect(purged).toEqual({ title: 'Mail', body: cleanup.TRASH_PURGED_BODY, meta: { keyword: 'todo' }, clearOriginal: true });
		const tombstone = { title: purged.title, body: purged.body, meta: purged.meta, original: '' };
		expect(cleanup.purgedValues(tombstone, inboxRules)).toBeNull();
	});
});
