// Pure rules of the ingest interface of the mail helper (ADR-0016 section 5, ADR-0018 section 8;
// E4 plan package 22).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { SCAN_STATES, scanStateValue } from '../../helpers/mail/src/scan-state.ts';

const rules = loadHookLib('ingest-rules.js');
const keywords = loadHookLib('keywords.js');
const connectionRules = loadHookLib('connection-rules.js');

const ID = 'abcdefghij12345';
// A scan state as byl-mail.exe 0.7.0 reports it (helpers/mail/src/scan-state.ts).
const SCAN = {
	signature: '0123456789abcdef',
	state: 'done',
	uid_validity: '1700000000',
	until: 12,
	below: 0,
	done: 12,
	total: 12,
	created: 3,
	fallback: false
};
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
				meta: { from: 'Anna <a@example.com>', attachments: 2 },
				match_texts: []
			}
		});
	});

	it('keeps the match_texts of a helper since 0.6.0 for the keyword check', () => {
		expect(rules.parseDraft(draft({ match_texts: ['anna@example.com', ''] })).draft.match_texts).toEqual([
			'anna@example.com',
			''
		]);
		expect(rules.parseDraft(draft({ match_texts: null })).draft.match_texts).toEqual([]);
	});

	it.each([
		['match_texts as text', draft({ match_texts: 'todo' })],
		['more than 12 match_texts', draft({ match_texts: Array.from({ length: 13 }, () => 'x') })],
		['a match_text that is too long', draft({ match_texts: ['x'.repeat(100_001)] })],
		['a number in match_texts', draft({ match_texts: [3] })],
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
		['a list as source_meta', draft({ source_meta: [] })],
		['an unknown reason for a missing file', draft({ source_meta: { original_omitted: 'lost', original_size: 5 } })],
		['a missing file without size', draft({ source_meta: { original_omitted: 'too_large' } })],
		['a size as text', draft({ source_meta: { original_omitted: 'too_large', original_size: '12' } })],
		['a negative size', draft({ source_meta: { original_omitted: 'too_large', original_size: -1 } })],
		['a broken size', draft({ source_meta: { original_omitted: 'too_large', original_size: 1.5 } })]
	])('refuses %s', (name, value) => {
		expect(rules.parseDraft(value)).toEqual({ error: expect.any(String) });
	});

	it('keeps the mark of a mail over 10 MB without its file (ADR-0031 section 4)', () => {
		const result = rules.parseDraft(
			draft({ source_meta: { from: 'a@example.com', original_omitted: 'too_large', original_size: 13_000_000 } })
		);
		expect(result.draft.meta).toEqual({
			from: 'a@example.com',
			original_omitted: 'too_large',
			original_size: 13_000_000
		});
		// A size alone is no mark and is not kept.
		expect(rules.parseDraft(draft({ source_meta: { original_size: 3 } })).draft.meta).toEqual({});
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

	it('searches the whole text and the match_texts (headers, HTML part) only with match_body', () => {
		const withBody = { ...settings, match_body: true };
		expect(decide('auto', withBody, { body: 'Rechnung anbei' })).toEqual({ accepted: true, keyword: 'rechnung' });
		expect(decide('auto', withBody, { body: `${'x '.repeat(3000)}Rechnung` })).toEqual({
			accepted: true,
			keyword: 'rechnung'
		});
		expect(decide('auto', settings, { body: `${'x '.repeat(3000)}Rechnung` })).toEqual({
			accepted: false,
			keyword: ''
		});
		const inCc = { match_texts: ['Buchhaltung Rechnungen <re@example.com>'] };
		expect(decide('auto', withBody, inCc)).toEqual({ accepted: true, keyword: 'rechnung' });
		expect(decide('auto', settings, inCc)).toEqual({ accepted: false, keyword: '' });
		// A helper before 0.6.0 sends no match_texts.
		expect(decide('auto', withBody, { match_texts: undefined })).toEqual({ accepted: false, keyword: '' });
	});

	it('searches the sender (name and address) as well, also without match_body (package A)', () => {
		const europa = { ...settings, keywords: ['europa-go'] };
		const from = (value) => ({ meta: { from: value } });
		expect(decide('auto', europa, from('Europa-Go Reisen <info@europa-go.de>'))).toEqual({
			accepted: true,
			keyword: 'europa-go'
		});
		expect(decide('auto', europa, from('info@europa-go.de'))).toEqual({ accepted: true, keyword: 'europa-go' });
		expect(decide('auto', europa, from('Anna <anna@example.com>'))).toEqual({ accepted: false, keyword: '' });
		expect(decide('auto', europa, { meta: { from: ['europa-go'] } })).toEqual({ accepted: false, keyword: '' });
		expect(decide('auto', europa, { meta: {} })).toEqual({ accepted: false, keyword: '' });
		expect(decide('auto', europa, { meta: undefined })).toEqual({ accepted: false, keyword: '' });
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
		expect(rules.parseStatus({})).toEqual({
			status: { error: '', hint: undefined, cursor: undefined, scan: undefined }
		});
		expect(rules.parseStatus({ cursor: '' }).status.cursor).toBe('');
	});

	it.each([
		['no object', 'ok'],
		['a cursor without UIDVALIDITY', { cursor: '42' }],
		['a cursor with text', { cursor: '1:2; DROP' }],
		['a number as error', { error: 3 }],
		['a list as hint', { hint: [] }],
		['a scan as text', { scan: 'done' }],
		['a scan with an unknown state', { scan: { ...SCAN, state: 'fertig' } }],
		['a scan with a short signature', { scan: { ...SCAN, signature: 'abc' } }],
		['a scan with a negative count', { scan: { ...SCAN, done: -1 } }],
		['a scan with a numeric UIDVALIDITY', { scan: { ...SCAN, uid_validity: 1700000000 } }],
		['a scan with a text as fallback', { scan: { ...SCAN, fallback: 'ja' } }]
	])('refuses %s', (name, value) => {
		expect(rules.parseStatus(value)).toEqual({ error: expect.any(String) });
	});
});

describe('state of the full scan (ADR-0020, addendum 3)', () => {
	it('takes exactly the state the helper reports, never the mark of the migration', () => {
		const reported = scanStateValue({
			signature: '0123456789abcdef',
			state: 'paused',
			uidValidity: '1700000000',
			until: 4800,
			below: 3601,
			done: 1200,
			total: 4800,
			created: 200,
			fallback: false
		});
		expect(rules.parseStatus({ scan: { ...reported, match_body_before: false, extra: 1 } }).status.scan).toEqual(reported);
		expect(rules.SCAN_STATES).toEqual([...SCAN_STATES]);
	});

	it('keeps the mark of the migration when a new state is stored', () => {
		expect(rules.mergeScan({ match_body_before: false }, SCAN)).toEqual({ ...SCAN, match_body_before: false });
		expect(rules.mergeScan({ ...SCAN, state: 'running' }, { ...SCAN, done: 9 })).toEqual({ ...SCAN, done: 9 });
		expect(rules.mergeScan(null, SCAN)).toEqual(SCAN);
		expect(rules.mergeScan({ match_body_before: true }, SCAN)).toEqual(SCAN);
	});

	it('cancels a running, paused or failed scan, nothing else', () => {
		for (const state of ['running', 'paused', 'error']) {
			expect(rules.cancelledScan({ ...SCAN, state, match_body_before: false })).toEqual({
				...SCAN,
				state: 'cancelled',
				match_body_before: false
			});
		}
		for (const stored of [{ ...SCAN, state: 'done' }, { ...SCAN, state: 'cancelled' }, null, 'x', { match_body_before: false }]) {
			expect(rules.cancelledScan(stored)).toBeNull();
		}
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
			cursor: '1:2',
			scan: null
		});
	});

	it('passes the stored scan state on, without the mark of the migration, and drops a broken one', () => {
		const view = (scan) =>
			rules.connectionView(
				{ id: ID, label: 'Web.de', secret_env: 'BYL_WEBDE_PASSWORD', settings: {}, cursor: '', scan },
				keywords,
				connectionRules
			).scan;
		expect(view({ ...SCAN, match_body_before: false })).toEqual(SCAN);
		expect(view({ match_body_before: false })).toBeNull();
		expect(view({ ...SCAN, state: 'kaputt' })).toBeNull();
		expect(view(null)).toBeNull();
		expect(view(undefined)).toBeNull();
	});
});
