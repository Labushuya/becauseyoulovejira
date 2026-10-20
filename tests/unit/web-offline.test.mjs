// The outbox (OF-2, ADR-0074 and its addendum OF-2): the SPA (web/src/lib/domain/offline.ts) and the
// hook (app/pb_hooks/lib/client-ops-rules.js) know the same six actions, the same version of the
// capability, the same form of the identifier, the same bounds of the time of the device and the
// same catalog of the codes. What the SPA sends (identifier, time, expected values) the rules of the
// server take as it is meant; a change on one side alone fails here.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as web from '../../web/src/lib/domain/offline.ts';

const hook = loadHookLib('client-ops-rules.js');

describe('constants of the outbox', () => {
	it('are the same in the SPA and in the hook', () => {
		expect([...web.OFFLINE_KINDS]).toEqual([...hook.KINDS]);
		expect(web.OFFLINE_VERSION).toBe(hook.VERSION);
		expect(web.DEVICE_FUTURE_MS).toBe(hook.DEVICE_FUTURE_MS);
		expect(web.DEVICE_PAST_MS).toBe(hook.DEVICE_PAST_MS);
		expect({ ...web.OFFLINE_MESSAGES }).toEqual({ ...hook.MESSAGES });
		expect(web.CONFLICT_MESSAGE).toBe(hook.CONFLICT_MESSAGE);
		for (const field of Object.keys(web.CONFLICT_TEXTS)) {
			expect(web.CONFLICT_TEXTS[field], field).toBe(hook.conflictText(field));
		}
		expect(hook.conflictText('other_field')).toBe(hook.MESSAGES.validation_ticket_conflict);
	});

	it('keep the device for at most 7 days, the server the identifier 30 days', () => {
		expect(web.KEEP_MS).toBeLessThan(hook.RETENTION_DAYS * 24 * 60 * 60 * 1000);
		expect(web.AUTO_SEND_MS).toBe(hook.DEVICE_PAST_MS);
	});
});

describe('what the SPA sends', () => {
	it('draws identifiers the server takes, and the form of both sides is the same', () => {
		for (let index = 0; index < 50; index++) {
			const op = web.newOpId((bytes) => crypto.getRandomValues(bytes));
			expect(hook.opOf(op)).toEqual({ op, code: '' });
		}
		for (const sample of ['a'.repeat(15), 'a'.repeat(16), 'a'.repeat(64), 'a'.repeat(65), 'abc def ghi jkl mno', 'Ab_-0123456789xyz', 'ä'.repeat(20)]) {
			expect(web.OP_PATTERN.test(sample), sample).toBe(hook.opOf(sample).code === '');
		}
	});

	it('sends the time of the device in a form the server keeps within its bounds', () => {
		const now = Date.UTC(2026, 9, 20, 12, 30, 0);
		const fresh = { createdAt: now - 27 * 60_000, op: 'aaaaaaaaaaaaaaaaaaaa', expected: { status: 'open' } };
		const fields = web.requestFields(fresh, false);
		expect(hook.offlineOf({ client_at: fields.clientAt }, now)).toEqual({ offline: true, deviceAt: '2026-10-20 12:03:00.000Z' });
		// After 48 hours the SPA sends no time, only the mark; the server keeps the change as offline.
		const late = web.requestFields({ ...fresh, createdAt: now - web.AUTO_SEND_MS - 1, late: true }, false);
		expect(late).not.toHaveProperty('clientAt');
		expect(hook.offlineOf({ offline: late.offline }, now)).toEqual({ offline: true, deviceAt: '' });
		// The first attempt right after the change is no change of the outbox.
		expect(hook.offlineOf(web.requestFields(fresh, true), now)).toEqual({ offline: false, deviceAt: '' });
	});

	it('sends expected values the server can compare, and a conflict is what the SPA reads as one', () => {
		const fields = web.requestFields({ createdAt: 0, op: 'aaaaaaaaaaaaaaaaaaaa', expected: { status: 'open' } }, false);
		expect(hook.expectedViolation(fields.expected, ['status', 'due', 'title'])).toBe('');
		expect(hook.conflictsOf({ status: 'open' }, { status: 'waiting' }, { status: 'done' })).toEqual([
			{ field: 'status', expected: 'open', actual: 'waiting' }
		]);
		// The same wish arrived from elsewhere is no conflict.
		expect(hook.conflictsOf({ status: 'open' }, { status: 'done' }, { status: 'done' })).toEqual([]);
	});

	it('reads the capability the server names', () => {
		const ops = web.toOfflineOps(hook.capabilityOf(true));
		expect(ops).toEqual({ version: 1, kinds: [...hook.KINDS] });
		expect(web.supportsKind(ops, 'ticket.update')).toBe(true);
		expect(web.toOfflineOps(hook.capabilityOf(false))).toBeNull();
	});
});
