// Commands of the guides (ADR-0026 section 6, plan EH-4): segments, masking, the checks of setx
// and the Gmail app password.

import { describe, expect, it } from 'vitest';
import {
	SECRET_MASK,
	SETX_MAX_LENGTH,
	normalizeValue,
	parseTemplate,
	renderCommand,
	setxValueError
} from './command';
import { isHttpsUrl } from './links';

const TOKEN = { token: { label: 'Bot-Token', secret: true } };

describe('parseTemplate', () => {
	it('splits text and placeholders', () => {
		expect(parseTemplate('setx BYL_TELEGRAM_TOKEN "{{token}}"', TOKEN)).toEqual([
			{ kind: 'text', text: 'setx BYL_TELEGRAM_TOKEN "' },
			{ kind: 'placeholder', name: 'token', label: 'Bot-Token', secret: true },
			{ kind: 'text', text: '"' }
		]);
	});

	it('keeps a text without placeholders whole and treats unknown placeholders as secret', () => {
		expect(parseTemplate('/newbot')).toEqual([{ kind: 'text', text: '/newbot' }]);
		expect(parseTemplate('{{ids}}')).toEqual([
			{ kind: 'placeholder', name: 'ids', label: 'ids', secret: true }
		]);
		expect(parseTemplate('a {{x}}{{y}} b', { y: { label: 'Y', secret: false } })).toHaveLength(4);
	});
});

describe('renderCommand', () => {
	const segments = parseTemplate('setx BYL_TELEGRAM_TOKEN "{{token}}"', TOKEN);

	it('shows the placeholder in angle quotes without a value', () => {
		expect(renderCommand(segments)).toEqual({
			display: 'setx BYL_TELEGRAM_TOKEN "‹Bot-Token›"',
			copy: 'setx BYL_TELEGRAM_TOKEN "‹Bot-Token›"'
		});
	});

	it('masks a secret value in the display and copies the real value', () => {
		expect(renderCommand(segments, { token: '123:ABC' })).toEqual({
			display: `setx BYL_TELEGRAM_TOKEN "${SECRET_MASK}"`,
			copy: 'setx BYL_TELEGRAM_TOKEN "123:ABC"'
		});
	});

	it('shows a value that is not secret', () => {
		const ids = parseTemplate('setx BYL_TELEGRAM_ALLOWED_IDS "{{ids}}"', {
			ids: { label: 'IDs', secret: false }
		});
		expect(renderCommand(ids, { ids: '424242' }).display).toBe(
			'setx BYL_TELEGRAM_ALLOWED_IDS "424242"'
		);
	});
});

describe('setxValueError', () => {
	it('accepts a usual value', () => {
		expect(setxValueError('https://calendar.google.com/calendar/ical/x/basic.ics')).toBeNull();
	});

	it.each([
		['with "quotes"', 'error', /Anführungszeichen/],
		['line\nbreak', 'error', /Zeilenumbruch/],
		['a'.repeat(SETX_MAX_LENGTH + 1), 'error', /1024/],
		['x%PATH%y', 'warning', /Variable/]
	])('checks %j', (value, level, message) => {
		const check = setxValueError(value);
		expect(check?.level).toBe(level);
		expect(check?.message).toMatch(message);
	});

	it('allows exactly the maximum length', () => {
		expect(setxValueError('a'.repeat(SETX_MAX_LENGTH))).toBeNull();
	});
});

describe('normalizeValue', () => {
	it('removes the spaces between the groups of a Gmail app password', () => {
		expect(normalizeValue('gmail', ' abcd efgh ijkl mnop ')).toBe('abcdefghijklmnop');
	});

	it('only trims other values', () => {
		expect(normalizeValue('other', '  a b  ')).toBe('a b');
	});
});

describe('isHttpsUrl', () => {
	it.each([
		['https://myaccount.google.com/apppasswords', true],
		['http://example.com', false],
		['javascript:alert(1)', false],
		['/eingang', false],
		['not a url', false]
	])('%s is https: %s', (href, expected) => {
		expect(isHttpsUrl(href)).toBe(expected);
	});
});
