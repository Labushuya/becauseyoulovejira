// Texts of the channel cards (ADR-0026, addendum of 2026-09-30, plan kanal-karten KK-2): the
// relative time in Berlin, the one info line per kind and the state of the cards without a
// connection.

import { describe, expect, it } from 'vitest';
import {
	CARD_STATUS,
	connectionInfo,
	inboxKeysInfo,
	inboxKeysStatus,
	notionInfo,
	relativeTime,
	whatsAppWebStatus
} from './channel-card';
import type { RunResult } from './connections';
import type { NotionImportedSource } from './notion';

/** 12:00 in Berlin (summer time). */
const NOW = Date.parse('2026-09-30T10:00:00Z');

const RUN: RunResult = {
	status: 'ok',
	created: 3,
	duplicates: 1,
	updated: 0,
	skipped: 0,
	failed: 0,
	unmatched: 0,
	error: '',
	missing: []
};

function source(id: string, count: number): NotionImportedSource {
	return {
		id,
		type: 'data_source',
		title: `Liste ${id}`,
		url: 'https://www.notion.so/liste',
		count,
		last: null,
		dateProperty: '',
		copyContent: false
	};
}

describe('relativeTime', () => {
	it.each([
		['2026-09-30 09:59:30.000Z', 'gerade eben'],
		['2026-09-30 10:05:00.000Z', 'gerade eben'],
		['2026-09-30 09:59:00.000Z', 'vor 1 Min.'],
		['2026-09-30 09:55:00.000Z', 'vor 5 Min.'],
		['2026-09-30 09:00:01.000Z', 'vor 59 Min.'],
		['2026-09-30 09:00:00.000Z', 'heute, 11:00'],
		['2026-09-29 16:02:00.000Z', 'gestern, 18:02'],
		['2026-09-28 08:15:00.000Z', '28.09.2026 10:15']
	])('says %s as "%s"', (timestamp, text) => {
		expect(relativeTime(timestamp, NOW)).toBe(text);
	});

	it('counts days in Berlin, not in UTC', () => {
		// 00:30 on 1 October in Berlin, the run at 23:00 on 30 September in Berlin.
		const afterMidnight = Date.parse('2026-09-30T22:30:00Z');
		expect(relativeTime('2026-09-30 21:00:00.000Z', afterMidnight)).toBe('gestern, 23:00');
		expect(relativeTime('2026-09-30 22:10:00.000Z', afterMidnight)).toBe('vor 20 Min.');
	});

	it('refuses what is not a timestamp of PocketBase', () => {
		expect(() => relativeTime('gestern', NOW)).toThrow(RangeError);
	});
});

describe('info lines of the cards', () => {
	const calendar = { type: 'calendar' as const, lastRunAt: null, lastError: '', scan: null };

	it('says when a connection fetched last and what came of it', () => {
		expect(connectionInfo(calendar, null, NOW)).toBe('Noch nie abgerufen');
		const ran = { ...calendar, lastRunAt: '2026-09-30 09:55:00.000Z' };
		expect(connectionInfo(ran, null, NOW)).toBe('Zuletzt abgerufen vor 5 Min. · ohne Fehler');
		expect(connectionInfo(ran, RUN, NOW)).toBe(
			'Zuletzt abgerufen vor 5 Min. · 3 neu, 1 schon vorhanden'
		);
		expect(connectionInfo({ ...ran, lastError: 'HTTP 404' }, null, NOW)).toBe(
			'Zuletzt abgerufen vor 5 Min. · fehlgeschlagen'
		);
		expect(connectionInfo(calendar, { ...RUN, status: 'unavailable' }, NOW)).toBe(
			'Noch nie abgerufen · Hilfsprozess läuft nicht'
		);
	});

	it('says how far the inbox of a mailbox is searched while it runs', () => {
		const scan = {
			state: 'running' as const,
			done: 1200,
			total: 4800,
			created: 2,
			fallback: false
		};
		const mail = { ...calendar, type: 'mail' as const, lastRunAt: '2026-09-30 09:55:00.000Z' };
		expect(connectionInfo({ ...mail, scan }, null, NOW)).toBe(
			'Posteingang wird durchsucht: 1.200/4.800'
		);
		expect(connectionInfo({ ...mail, scan: { ...scan, state: 'done' } }, null, NOW)).toBe(
			'Zuletzt abgerufen vor 5 Min. · ohne Fehler'
		);
	});

	it('names what Notion took over', () => {
		expect(notionInfo(null, null, NOW)).toBe('Übernommene Listen werden geladen …');
		expect(notionInfo([], null, NOW)).toBe('Noch nichts übernommen');
		expect(notionInfo([source('a', 5), source('b', 3)], '2026-09-30 09:55:00.000Z', NOW)).toBe(
			'8 Einträge aus 2 Quellen übernommen · zuletzt abgerufen vor 5 Min.'
		);
	});

	it('counts the keys of the own inbox and their last use', () => {
		expect(inboxKeysInfo([], NOW)).toBe('Noch kein Zugangsschlüssel');
		expect(inboxKeysInfo([{ lastUsedAt: null }], NOW)).toBe('1 Schlüssel, noch nie benutzt');
		expect(
			inboxKeysInfo(
				[
					{ lastUsedAt: '2026-09-29 16:02:00.000Z' },
					{ lastUsedAt: null },
					{ lastUsedAt: '2026-09-30 09:55:00.000Z' }
				],
				NOW
			)
		).toBe('3 Schlüssel, zuletzt benutzt vor 5 Min.');
	});
});

describe('states of the cards without a connection', () => {
	it('knows the own inbox: restart, error, open until a program used a key, connected', () => {
		expect(inboxKeysStatus('unavailable', [])).toBe(CARD_STATUS.restart);
		expect(inboxKeysStatus('error', [])).toBe(CARD_STATUS.error);
		expect(inboxKeysStatus('loading', [])).toBeNull();
		expect(inboxKeysStatus('idle', [])).toBeNull();
		expect(inboxKeysStatus('ready', [])).toBe(CARD_STATUS.setup);
		expect(inboxKeysStatus('ready', [{ lastUsedAt: null }])).toBe(CARD_STATUS.setup);
		expect(inboxKeysStatus('ready', [{ lastUsedAt: '2026-09-30 09:55:00.000Z' }])).toBe(
			CARD_STATUS.connected
		);
	});

	it('says of WhatsApp Web only what the app can know, never "Verbunden" (ADR-0038 §4)', () => {
		expect(whatsAppWebStatus('unavailable', 0, null)).toBe(CARD_STATUS.restart);
		expect(whatsAppWebStatus('ready', 1, false)).toBe(CARD_STATUS.setup);
		expect(whatsAppWebStatus('ready', 0, true)).toBe(CARD_STATUS.setup);
		expect(whatsAppWebStatus('ready', 1, true)).toBeNull();
		expect(whatsAppWebStatus('loading', 0, null)).toBeNull();
		expect(whatsAppWebStatus(null, 0, null)).toBeNull();
	});

	it('uses the approved states and red only for an error (ADR-0009)', () => {
		expect(Object.values(CARD_STATUS).map((status) => status.label)).toEqual([
			'Verbunden',
			'Pausiert',
			'Fehler',
			'Einrichtung offen',
			'Neustart nötig'
		]);
		expect(
			Object.values(CARD_STATUS)
				.filter((status) => status.tone === 'danger')
				.map((status) => status.label)
		).toEqual(['Fehler']);
	});
});
