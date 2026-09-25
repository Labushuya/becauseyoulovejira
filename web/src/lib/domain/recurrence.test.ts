import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LEAD_DAYS,
	after,
	afterCompletion,
	catchUp,
	createOn,
	latestOnOrBefore,
	normalizeRule,
	onOrAfter,
	upcoming,
	validRule,
	validateRule,
	weekdayOf,
	type RecurrenceParams
} from './recurrence';

// Date calculation of recurring tasks in the SPA (ADR-0021 section 3; E5 plan, package 1). The
// comparison with the hook module is tests/unit/web-recurrence.test.mjs; here the shared table
// runs once more in the web suite, with the checks the form relies on.

interface Case {
	name: string;
	fn: string;
	rule?: RecurrenceParams;
	args: unknown[];
	expect: unknown;
}

const TABLE = join(import.meta.dirname, '../../../../tests/fixtures/recurrence/cases.json');
const { cases } = JSON.parse(readFileSync(TABLE, 'utf8')) as { cases: Case[] };

function run({ fn, rule = {}, args }: Case): unknown {
	const [a, b] = args as [string, string];
	switch (fn) {
		case 'normalize':
			return normalizeRule(rule);
		case 'validate':
			return validateRule(rule);
		case 'onOrAfter':
			return onOrAfter(rule, a);
		case 'after':
			return after(rule, a);
		case 'latestOnOrBefore':
			return latestOnOrBefore(rule, a);
		case 'afterCompletion':
			return afterCompletion(rule, a);
		case 'catchUp':
			return catchUp(rule, a, b);
		case 'createOn':
			return createOn(a, args[1] as number);
		case 'upcoming':
			return upcoming(rule, a, args[1] as number);
		default:
			throw new Error(`Unknown function ${fn}`);
	}
}

describe('recurrence: shared table', () => {
	it.each(cases)('$name', (testCase) => {
		expect(run(testCase)).toEqual(testCase.expect);
	});
});

describe('validRule', () => {
	it('returns the normalized rule when it is valid', () => {
		expect(validRule({ mode: 'calendar', freq: 'weekly', anchor: '2026-09-24' })).toEqual({
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['TH'],
			month_day: null,
			anchor: '2026-09-24',
			lead_days: DEFAULT_LEAD_DAYS
		});
	});

	it('returns null for an invalid rule', () => {
		expect(validRule({ mode: 'calendar', freq: 'weekly', anchor: '' })).toBeNull();
		expect(validRule(null)).toBeNull();
	});
});

describe('dates for the form', () => {
	it('previews three dates of a rule on workdays', () => {
		const rule = {
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'],
			anchor: '2026-09-25'
		};
		expect(upcoming(rule, '2026-09-25', 3)).toEqual(['2026-09-25', '2026-09-28', '2026-09-29']);
	});

	it('rejects invalid input with a RangeError', () => {
		expect(() => onOrAfter({ mode: 'calendar', freq: 'daily', anchor: 'x' }, '2026-01-01')).toThrow(
			RangeError
		);
		expect(() => createOn('2026-01-01', -1)).toThrow(RangeError);
	});

	it('knows the weekday of a date', () => {
		expect(weekdayOf('2026-09-24')).toBe('TH');
	});
});
