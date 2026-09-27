// Pure parts of the full inbox scan (ADR-0020, addendum 3): the spellings the server searches for,
// the signature that starts a scan over, the search criteria and the stored state.

import { describe, expect, it } from 'vitest';
import type { MailConnection } from './ingest-client';
import { SEARCH_TERMS_MAX, headerMatches, newScan, scanSignature, searchCriteria, searchTerms } from './scan';
import { scanStateOf, scanStateValue } from './scan-state';

describe('searchTerms', () => {
	it('searches every spelling of umlauts and ß, lower case, without duplicates', () => {
		expect(searchTerms('Prüfen')).toEqual(['prüfen', 'prufen', 'pruefen']);
		expect(searchTerms('pruefen')).toEqual(['pruefen', 'prüfen']);
		expect(searchTerms('Fuß')).toEqual(['fuß', 'fuss']);
		expect(searchTerms('europa-go')).toEqual(['europa-go']);
		expect(searchTerms('  zu   erledigen ')).toEqual(['zu erledigen']);
		const many = searchTerms('Grüße aus Köln, Straße');
		expect(many.length).toBeLessThanOrEqual(SEARCH_TERMS_MAX);
		expect(many).toEqual(
			expect.arrayContaining(['grüße aus köln, straße', 'grusse aus koln, strasse', 'gruesse aus koeln, strasse'])
		);
	});
});

describe('scanSignature', () => {
	it('changes with the keywords and match_body, not with their order or spelling', () => {
		const base = scanSignature(['todo', 'Prüfen'], false);
		expect(base).toMatch(/^[0-9a-f]{16}$/);
		expect(scanSignature(['PRÜFEN', 'TODO', 'todo'], false)).toBe(base);
		expect(scanSignature(['todo'], false)).not.toBe(base);
		expect(scanSignature(['todo', 'prüfen', 'rechnung'], false)).not.toBe(base);
		expect(scanSignature(['todo', 'prüfen'], true)).not.toBe(base);
	});
});

describe('searchCriteria', () => {
	it('searches subject, sender, recipients, the named headers and the body, never TEXT', () => {
		const criteria = searchCriteria(['todo']);
		expect(criteria).toEqual([
			{ subject: 'todo' },
			{ from: 'todo' },
			{ to: 'todo' },
			{ cc: 'todo' },
			{ header: { 'reply-to': 'todo' } },
			{ header: { sender: 'todo' } },
			{ header: { 'list-id': 'todo' } },
			{ header: { organization: 'todo' } },
			{ body: 'todo' }
		]);
		expect(JSON.stringify(searchCriteria(['a', 'b']))).not.toMatch(/"text"/);
	});
});

describe('headerMatches', () => {
	const box = (matchBody: boolean): MailConnection => ({
		id: 'abcdefghij12345',
		label: 'Web.de',
		provider: 'webde',
		user: 'anna@web.de',
		secretEnv: 'BYL_TEST_MAIL_PASSWORD',
		keywords: ['projekt-x'],
		matchBody,
		cursor: '',
		scan: null
	});
	const header = (lines: string[]) => new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\n`);

	it('matches subject and sender always, the other headers only with match_body', async () => {
		expect(await headerMatches(header(['Subject: Projekt-X startet']), box(false))).toBe(true);
		expect(await headerMatches(header(['From: Projekt-X <px@example.com>', 'Subject: Hallo']), box(false))).toBe(true);
		const cc = header(['Cc: Projekt-X <px@example.com>', 'Subject: Hallo']);
		expect(await headerMatches(cc, box(false))).toBe(false);
		expect(await headerMatches(cc, box(true))).toBe(true);
		expect(await headerMatches(header(['Subject: Hallo']), box(true))).toBe(false);
	});
});

describe('scan state', () => {
	it('stores and reads the state, and refuses broken values', () => {
		const scan = { ...newScan('0123456789abcdef', '1700000000', 42), done: 2, total: 40, created: 1, fallback: true };
		expect(scan).toMatchObject({ state: 'running', until: 42, below: 43 });
		const value = scanStateValue(scan);
		expect(value).toEqual({
			signature: '0123456789abcdef',
			state: 'running',
			uid_validity: '1700000000',
			until: 42,
			below: 43,
			done: 2,
			total: 40,
			created: 1,
			fallback: true
		});
		expect(scanStateOf(value)).toEqual(scan);
		expect(scanStateOf(JSON.parse(JSON.stringify(value)))).toEqual(scan);
		for (const broken of [
			null,
			'x',
			[],
			{ ...value, signature: 'kurz' },
			{ ...value, state: 'unbekannt' },
			{ ...value, uid_validity: 17 },
			{ ...value, until: -1 },
			{ ...value, done: 1.5 },
			{ ...value, total: '40' }
		]) {
			expect(scanStateOf(broken)).toBeNull();
		}
		expect(scanStateOf({ ...value, fallback: 'ja' })?.fallback).toBe(false);
	});
});
