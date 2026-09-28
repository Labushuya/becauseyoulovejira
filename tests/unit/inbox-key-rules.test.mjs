// Pure rules of the own inbox with access keys (ADR-0038, plan eigener-eingang-whatsapp-web EI-1):
// key shape, name, payload, keyword decision, rate limit and allowed origins.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('inbox-key-rules.js');
const keywords = loadHookLib('keywords.js');

const TOKEN = `byl_${'Ab1'.repeat(13)}x`;

function payload(extra = {}) {
	return { channel: 'whatsapp-web', mode: 'manual', text: 'Milch kaufen', external_id: 'wa:1', ...extra };
}

describe('keys', () => {
	it('recognises the shape of a key', () => {
		expect(TOKEN).toHaveLength(44);
		expect(rules.isTokenShape(TOKEN)).toBe(true);
		for (const value of ['', 'byl_', `byl_${'a'.repeat(39)}`, `byl_${'a'.repeat(41)}`, `BYL_${'a'.repeat(40)}`, `byl_${'a'.repeat(39)}-`, null, 42]) {
			expect(rules.isTokenShape(value), String(value)).toBe(false);
		}
		expect(rules.TOKEN_ALPHABET).toMatch(/^[A-Za-z0-9]{62}$/);
		expect(rules.TOKEN_PREFIX.length + rules.TOKEN_RANDOM_LENGTH).toBe(44);
	});

	it('shows only the start of a key', () => {
		expect(rules.hintOf(TOKEN)).toBe('byl_Ab1A');
		expect(rules.HINT_LENGTH).toBe(8);
	});

	it('checks and trims the name', () => {
		expect(rules.parseName('  Mein   Rechner ')).toEqual({ name: 'Mein Rechner' });
		expect(rules.parseName('x'.repeat(60))).toEqual({ name: 'x'.repeat(60) });
		for (const value of ['', '   ', 'x'.repeat(61), 'a\u0000b', null, 3]) {
			expect(rules.parseName(value), String(value)).toEqual({ error: rules.MESSAGES.name });
		}
	});
});

describe('origin', () => {
	it('lets scripts and the extension in, web pages not', () => {
		expect(rules.originAllowed('')).toBe(true);
		expect(rules.originAllowed(undefined)).toBe(true);
		expect(rules.originAllowed(`chrome-extension://${'abcdefghijklmnop'.repeat(2)}`)).toBe(true);
		for (const origin of [
			'null',
			'https://web.whatsapp.com',
			'http://127.0.0.1:8090',
			'chrome-extension://short',
			`chrome-extension://${'q'.repeat(32)}`,
			`moz-extension://${'a'.repeat(32)}`
		]) {
			expect(rules.originAllowed(origin), origin).toBe(false);
		}
	});
});

describe('payload', () => {
	it('builds the draft of an entry', () => {
		expect(
			rules.parsePayload(
				payload({
					title: 'Einkauf',
					url: 'https://example.com/a',
					sender: 'Anna Beispiel',
					chat: 'Familie',
					sent_at: '2026-09-28T14:30:00+02:00',
					unknown: 'wird ignoriert'
				})
			)
		).toEqual({
			draft: {
				channel: 'whatsapp-web',
				mode: 'manual',
				kind: 'message',
				title: 'Einkauf',
				body: 'Milch kaufen',
				source_url: 'https://example.com/a',
				source_ref: 'wa:1',
				source_date: '2026-09-28 12:30:00.000Z',
				meta: { sender: 'Anna Beispiel', chat: 'Familie' }
			}
		});
	});

	it('defaults to the channel api and takes the first line of the text as title', () => {
		const { draft } = rules.parsePayload({ mode: 'auto', text: '\n  \nErste Zeile\nZweite', external_id: 'x' });
		expect(draft).toMatchObject({ channel: 'api', kind: 'todo', mode: 'auto', title: 'Erste Zeile', source_date: '', source_url: '' });
		expect(draft.meta).toEqual({});
		expect(rules.parsePayload(payload({ title: '   ' })).draft.title).toBe('Milch kaufen');
		expect(rules.parsePayload(payload({ title: null, url: null, sender: null })).draft).toMatchObject({ title: 'Milch kaufen', source_url: '' });
	});

	it('refuses invalid values with a German message', () => {
		const cases = [
			[null, 'payload'],
			[[], 'payload'],
			['text', 'payload'],
			[payload({ channel: 'mail' }), 'channel'],
			[payload({ mode: 'selected' }), 'mode'],
			[payload({ mode: undefined }), 'mode'],
			[payload({ text: '' }), 'text'],
			[payload({ text: ' \n ' }), 'text'],
			[payload({ text: 5 }), 'text'],
			[payload({ text: 'x'.repeat(100001) }), 'text'],
			[payload({ title: 'x'.repeat(1001) }), 'title'],
			[payload({ title: 'a\u0007' }), 'title'],
			[payload({ url: 'javascript:alert(1)' }), 'url'],
			[payload({ url: 'https://exa mple.com' }), 'url'],
			[payload({ url: `https://example.com/${'a'.repeat(2000)}` }), 'url'],
			[payload({ sender: 'x'.repeat(201) }), 'sender'],
			[payload({ sender: 1 }), 'sender'],
			[payload({ chat: 'x'.repeat(201) }), 'chat'],
			[payload({ sent_at: '2026-09-28 14:30' }), 'sentAt'],
			[payload({ sent_at: '2026-09-28T14:30:00' }), 'sentAt'],
			[payload({ sent_at: '2026-02-29T10:00:00Z' }), 'sentAt'],
			[payload({ sent_at: '2026-09-28T24:00:00Z' }), 'sentAt'],
			[payload({ sent_at: 'gestern' }), 'sentAt'],
			[payload({ external_id: '' }), 'externalId'],
			[payload({ external_id: undefined }), 'externalId'],
			[payload({ external_id: 'a\nb' }), 'externalId'],
			[payload({ external_id: 'x'.repeat(201) }), 'externalId'],
			[payload({ external_id: 7 }), 'externalId']
		];
		for (const [value, key] of cases) {
			expect(rules.parsePayload(value), JSON.stringify(value)?.slice(0, 80)).toEqual({ error: rules.MESSAGES[key] });
		}
	});

	it('reads ISO times with zone into the PocketBase format', () => {
		expect(rules.pocketBaseDate('2026-09-28T14:30Z')).toBe('2026-09-28 14:30:00.000Z');
		expect(rules.pocketBaseDate('2024-02-29T23:59:59.5-01:00')).toBe('2024-03-01 00:59:59.500Z');
		expect(rules.pocketBaseDate('2026-13-01T00:00Z')).toBe('');
		expect(rules.pocketBaseDate('2026-04-31T00:00Z')).toBe('');
	});
});

describe('keywords', () => {
	const settings = { api: { keywords: ['todo'] }, 'whatsapp-web': { keywords: ['#byl', 'Einkauf'] } };

	it('takes an automatic entry only with a keyword of its channel, case-insensitive', () => {
		const auto = (extra) => rules.parsePayload(payload({ mode: 'auto', ...extra })).draft;
		expect(rules.keywordDecision(settings, auto({ text: 'EINKAUF morgen' }), keywords)).toEqual({ accepted: true, keyword: 'Einkauf' });
		expect(rules.keywordDecision(settings, auto({ text: 'Hallo', title: 'Das ist #byl' }), keywords)).toEqual({ accepted: true, keyword: '#byl' });
		expect(rules.keywordDecision(settings, auto({ text: 'todo: Milch' }), keywords)).toEqual({ accepted: false, keyword: '' });
		expect(rules.keywordDecision(settings, auto({ channel: 'api', text: 'todo: Milch' }), keywords)).toEqual({ accepted: true, keyword: 'todo' });
		expect(rules.keywordDecision(null, auto({ text: 'Einkauf' }), keywords)).toEqual({ accepted: false, keyword: '' });
	});

	it('always takes a manual entry and keeps a matching keyword', () => {
		expect(rules.keywordDecision(settings, rules.parsePayload(payload()).draft, keywords)).toEqual({ accepted: true, keyword: '' });
		expect(rules.keywordDecision(settings, rules.parsePayload(payload({ text: 'Einkauf' })).draft, keywords)).toEqual({
			accepted: true,
			keyword: 'Einkauf'
		});
	});

	it('counts the keywords per channel', () => {
		expect(rules.keywordCounts(settings, keywords)).toEqual({ api: 1, 'whatsapp-web': 2 });
		expect(rules.keywordCounts(null, keywords)).toEqual({ api: 0, 'whatsapp-web': 0 });
	});
});

describe('rate limit', () => {
	it(`allows ${60} requests per key and minute`, () => {
		expect(rules.RATE_MAX).toBe(60);
		let entry = null;
		const start = 1_000_000;
		for (let i = 0; i < rules.RATE_MAX; i++) {
			const decision = rules.rateDecision(entry, start + i);
			expect(decision.allowed).toBe(true);
			entry = decision.entry;
		}
		expect(entry).toEqual({ start, count: 60 });
		const refused = rules.rateDecision(entry, start + 30_000);
		expect(refused).toEqual({ allowed: false, entry, retryAfter: 30 });
		expect(rules.rateDecision(entry, start + 60_000)).toEqual({ allowed: true, entry: { start: start + 60_000, count: 1 }, retryAfter: 0 });
	});

	it('starts over with a broken or future entry', () => {
		for (const entry of [null, 'x', { start: 'a', count: 1 }, { start: 5_000, count: 99 }]) {
			expect(rules.rateDecision(entry, 1_000).entry).toEqual({ start: 1_000, count: 1 });
		}
	});

	it('writes "zuletzt benutzt" at most once a minute', () => {
		expect(rules.lastUsedDue(Number.NaN, 0)).toBe(true);
		expect(rules.lastUsedDue(0, 59_999)).toBe(false);
		expect(rules.lastUsedDue(0, 60_000)).toBe(true);
		expect(rules.lastUsedDue(10_000, 0)).toBe(true);
	});
});
