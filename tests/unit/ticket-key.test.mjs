import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const { TASK, scopeOf, counterKey, formatKey, isValidProjectCode } = loadHookLib('ticket-key.js');

describe('scopeOf', () => {
	it('builds the private scope without household', () => {
		expect(scopeOf('user123', '')).toBe('u:user123');
		expect(scopeOf('user123', null)).toBe('u:user123');
		expect(scopeOf('user123', undefined)).toBe('u:user123');
	});

	it('builds the household scope when a household is set', () => {
		expect(scopeOf('user123', 'house456')).toBe('h:house456');
		expect(scopeOf('', 'house456')).toBe('h:house456');
	});

	it('rejects missing owner and household', () => {
		expect(() => scopeOf('', '')).toThrow(/owner or household/);
		expect(() => scopeOf(null, undefined)).toThrow(/owner or household/);
	});
});

describe('counterKey', () => {
	it('uses the project id when a project is set', () => {
		expect(counterKey('u:user123', 'proj789')).toBe('u:user123:proj789');
	});

	it('uses TASK without project', () => {
		expect(TASK).toBe('TASK');
		expect(counterKey('u:user123', '')).toBe('u:user123:TASK');
		expect(counterKey('h:house456', null)).toBe('h:house456:TASK');
		expect(counterKey('h:house456', undefined)).toBe('h:house456:TASK');
	});

	it('rejects a missing scope', () => {
		expect(() => counterKey('', 'proj789')).toThrow(/scope/);
		expect(() => counterKey(undefined, '')).toThrow(/scope/);
	});
});

describe('formatKey', () => {
	it('formats project and TASK keys', () => {
		expect(formatKey('ABC', 1)).toBe('ABC-1');
		expect(formatKey(TASK, 42)).toBe('TASK-42');
		expect(formatKey('ABCDEF', 1000)).toBe('ABCDEF-1000');
	});

	it('writes numbers of any length without padding or a limit (KN-1)', () => {
		for (const number of [9, 10, 999, 1000, 9999, 10000, 999999, 1000000, 123456789]) {
			expect(formatKey(TASK, number)).toBe(`TASK-${number}`);
		}
		expect(formatKey('ABCDEF', 1000000)).toBe('ABCDEF-1000000');
		expect(formatKey('AB', 1)).toBe('AB-1');
		expect(formatKey('ABC', Number.MAX_SAFE_INTEGER)).toBe(`ABC-${Number.MAX_SAFE_INTEGER}`);
	});

	it('rejects invalid codes', () => {
		for (const code of ['', 'A', 'abc', 'ABCDEFG', 'AB1', 'A-B', null, undefined]) {
			expect(() => formatKey(code, 1)).toThrow(/invalid code/);
		}
	});

	it('rejects numbers that are not positive integers', () => {
		for (const number of [0, -1, 1.5, Number.NaN, '1', null]) {
			expect(() => formatKey('ABC', number)).toThrow(/positive integer/);
		}
	});
});

describe('isValidProjectCode', () => {
	it('accepts 2 to 6 uppercase letters', () => {
		for (const code of ['AB', 'ABC', 'ABCDEF', 'TASKS', 'TAS']) {
			expect(isValidProjectCode(code)).toBe(true);
		}
	});

	it('rejects the reserved TASK and malformed codes', () => {
		for (const code of ['TASK', '', 'A', 'abc', 'ABCDEFG', 'ÄBC', 'AB C', ' AB', null]) {
			expect(isValidProjectCode(code)).toBe(false);
		}
	});
});
