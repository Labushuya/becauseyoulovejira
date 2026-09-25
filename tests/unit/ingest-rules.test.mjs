// Pure rules of the ingest interface of the mail helper (ADR-0016 section 5, ADR-0018 section 8;
// E4 plan package 22).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('ingest-rules.js');
const keywords = loadHookLib('keywords.js');
const connectionRules = loadHookLib('connection-rules.js');

const ID = 'abcdefghij12345';
const draft = (extra = {}) => ({ connection: ID, origin: 'auto', title: 'Todo: Steuer', ...extra });

describe('token', () => {
	it('reads only a bearer token', () => {
		expect(rules.bearerToken('Bearer abc+/=')).toBe('abc+/=');
		expect(rules.bearerToken('bearer  abc ')).toBe('abc');
		for (const header of ['', 'abc', 'Basic abc', 'Bearer', 'Bearer a b', null, undefined]) {
			expect(rules.bearerToken(header), String(header)).toBe('');
		}
	});

	it('compares the whole token and never accepts an empty expected value', () => {
		expect(rules.tokenMatches('s3cret+/=', 's3cret+/=')).toBe(true);
		for (const given of ['', 's3cret+/', 's3cret+/==', 'S3cret+/=', 'x3cret+/=', 's3cret+/=s3cret+/=']) {
			expect(rules.tokenMatches('s3cret+/=', given), given).toBe(false);
		}
		expect(rules.tokenMatches('', '')).toBe(false);
		expect(rules.tokenMatches('', 'x')).toBe(false);
		expect(rules.tokenMatches(undefined, undefined)).toBe(false);
	});

	it('does not stop at the first different character', () => {
		// The loop visits every character of the given token: no return or break inside it.
		const loop = /for \([^)]*\) \{([^}]*)\}/.exec(rules.tokenMatches.toString());
		expect(loop?.[1]).toMatch(/difference \|=/);
		expect(loop?.[1]).not.toMatch(/\b(return|break)\b/);
	});
});

describe('drafts of the helper', () => {
	it('accepts a mail draft and keeps only known keys of source_meta', () => {
		const result = rules.parseDraft(
			draft({
				body: 'Text',
				source_ref: '<a@b>',
				source_date: '2026-09-25 10:00:00.000Z',
				source_meta: { from: 'Anna <a@example.com>', attachments: 2, keyword: 'erfunden', owner: 'x' }
			})
		);
		expect(result).toEqual({
			draft: {
				connection: ID,
				origin: 'auto',
				channel: 'mail',
				kind: 'mail',
				title: 'Todo: Steuer',
				body: 'Text',
				source_url: '',
				source_ref: '<a@b>',
				source_date: '2026-09-25 10:00:00.000Z',
				meta: { from: 'Anna <a@example.com>', attachments: 2 }
			}
		});
	});

	it.each([
		['no object', null],
		['a list', []],
		['no connection', draft({ connection: '' })],
		['a bad connection', draft({ connection: 'x'.repeat(15).toUpperCase() })],
		['an unknown origin', draft({ origin: 'manual' })],
		['no title', draft({ title: ' \n ' })],
		['a title that is too long', draft({ title: 'x'.repeat(1001) })],
		['a body that is too long', draft({ body: 'x'.repeat(100_001) })],
		['a number as body', draft({ body: 3 })],
		['a source_ref that is too long', draft({ source_ref: 'x'.repeat(501) })],
		['a list as source_meta', draft({ source_meta: [] })]
	])('refuses %s', (name, value) => {
		expect(rules.parseDraft(value)).toEqual({ error: expect.any(String) });
	});

	it('sets channel and kind to mail whatever the helper sends', () => {
		expect(rules.parseDraft(draft({ channel: 'telegram', kind: 'todo' })).draft).toMatchObject({
			channel: 'mail',
			kind: 'mail'
		});
	});
});

describe('keywords of a mail connection (ADR-0020)', () => {
	const settings = { provider: 'webde', user: 'anna@web.de', keywords: ['todo', 'rechnung'] };
	const decide = (origin, value, mail) =>
		rules.keywordDecision(origin, value, { title: 'Hallo', body: '', ...mail }, keywords, connectionRules);

	it('takes a fetched mail only with a keyword in the subject', () => {
		expect(decide('auto', settings, { title: 'TODO: Steuer' })).toEqual({ accepted: true, keyword: 'todo' });
		expect(decide('auto', settings, { body: 'Rechnung anbei' })).toEqual({ accepted: false, keyword: '' });
	});

	it('searches the first 500 characters of the text only with match_body', () => {
		const withBody = { ...settings, match_body: true };
		expect(decide('auto', withBody, { body: 'Rechnung anbei' })).toEqual({ accepted: true, keyword: 'rechnung' });
		expect(decide('auto', withBody, { body: `${'x '.repeat(250)}Rechnung` })).toEqual({
			accepted: false,
			keyword: ''
		});
	});

	it('takes a selected mail without keyword but keeps a match', () => {
		expect(decide('selected', settings, {})).toEqual({ accepted: true, keyword: '' });
		expect(decide('selected', settings, { title: 'Rechnung' })).toEqual({ accepted: true, keyword: 'rechnung' });
	});

	it('takes nothing automatically without keywords', () => {
		expect(decide('auto', { provider: 'webde', user: 'a' }, { title: 'todo' })).toEqual({
			accepted: false,
			keyword: ''
		});
		expect(decide('auto', null, { title: 'todo' }).accepted).toBe(false);
	});
});

describe('status of a run', () => {
	it('takes error, hint and cursor', () => {
		expect(rules.parseStatus({ error: 'x'.repeat(1200), hint: 'Hinweis', cursor: '1700000000:42' })).toEqual({
			status: { error: 'x'.repeat(1000), hint: 'Hinweis', cursor: '1700000000:42' }
		});
		expect(rules.parseStatus({})).toEqual({ status: { error: '', hint: undefined, cursor: undefined } });
		expect(rules.parseStatus({ cursor: '' }).status.cursor).toBe('');
	});

	it.each([
		['no object', 'ok'],
		['a cursor without UIDVALIDITY', { cursor: '42' }],
		['a cursor with text', { cursor: '1:2; DROP' }],
		['a number as error', { error: 3 }],
		['a list as hint', { hint: [] }]
	])('refuses %s', (name, value) => {
		expect(rules.parseStatus(value)).toEqual({ error: expect.any(String) });
	});
});

describe('connections for the helper', () => {
	it('names only the variable, never an owner or a value', () => {
		const view = rules.connectionView(
			{
				id: ID,
				label: 'Web.de',
				secret_env: 'BYL_WEBDE_PASSWORD',
				settings: { provider: 'webde', user: 'anna@web.de', keywords: ['todo', ''], match_body: true },
				cursor: '1:2'
			},
			keywords,
			connectionRules
		);
		expect(view).toEqual({
			id: ID,
			label: 'Web.de',
			provider: 'webde',
			user: 'anna@web.de',
			secret_env: 'BYL_WEBDE_PASSWORD',
			keywords: ['todo'],
			match_body: true,
			cursor: '1:2'
		});
	});
});
