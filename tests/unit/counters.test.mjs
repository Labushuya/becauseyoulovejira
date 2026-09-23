// lib/counters.js without PocketBase: the JSVM globals $security and DynamicModel and the
// transaction app are replaced by recording fakes. The real SQL runs in
// tests/integration/ticket-keys.test.mjs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const { NEXT_VALUE_SQL, ID_ALPHABET, ID_LENGTH, nextValue } = loadHookLib('counters.js');

/** Fake txApp whose query returns `value` and records sql and bound parameters. */
function fakeApp(value) {
	const calls = [];
	return {
		calls,
		db: () => ({
			newQuery(sql) {
				const call = { sql, params: null };
				calls.push(call);
				const query = {
					bind(params) {
						call.params = params;
						return query;
					},
					one(model) {
						model.value = value;
					}
				};
				return query;
			}
		})
	};
}

let saved;

beforeEach(() => {
	saved = { $security: globalThis.$security, DynamicModel: globalThis.DynamicModel };
	globalThis.$security = {
		randomStringWithAlphabet: (length, alphabet) => `id:${length}:${alphabet}`
	};
	globalThis.DynamicModel = function DynamicModel(shape) {
		Object.assign(this, shape);
	};
});

afterEach(() => {
	globalThis.$security = saved.$security;
	globalThis.DynamicModel = saved.DynamicModel;
});

describe('NEXT_VALUE_SQL', () => {
	it('creates missing counters and increments existing ones in one statement (OF-1)', () => {
		expect(NEXT_VALUE_SQL).toBe(
			'INSERT INTO ticket_counters (id, key, value) VALUES ({:id}, {:key}, 1) ' +
				'ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value'
		);
	});
});

describe('nextValue', () => {
	it('binds key and a new record id instead of concatenating them', () => {
		const app = fakeApp(7);
		expect(nextValue(app, "u:abc:TASK' --")).toBe(7);
		expect(app.calls).toEqual([
			{
				sql: NEXT_VALUE_SQL,
				params: { id: `id:${ID_LENGTH}:${ID_ALPHABET}`, key: "u:abc:TASK' --" }
			}
		]);
		expect(ID_LENGTH).toBe(15);
		expect(ID_ALPHABET).toBe('abcdefghijklmnopqrstuvwxyz0123456789');
	});

	it('rejects an empty key before touching the database', () => {
		const app = fakeApp(1);
		expect(() => nextValue(app, '')).toThrow(/key is required/);
		expect(() => nextValue(app, undefined)).toThrow(/key is required/);
		expect(app.calls).toEqual([]);
	});

	it.each([0, -1, 1.5, '3', null])('rejects the unexpected counter value %j', (value) => {
		expect(() => nextValue(fakeApp(value), 'u:abc:TASK')).toThrow(/unexpected counter value/);
	});
});
