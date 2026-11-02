// The error log of the server in the SPA (FP-2, ADR-0077): an entry of the record API as an entry of
// the dialog, its facts with area, last occurrence and Server-ID, the report, and the address
// `?fehler=<id>`.

import { describe, expect, it } from 'vitest';
import {
	PROBLEM_TEXTS,
	clientProblem,
	problemFacts,
	problemReport,
	type ProblemEntry
} from './problems';
import {
	SERVER_PROBLEM_PARAM,
	isServerProblemId,
	parseServerProblem,
	serverProblemEntry,
	serverProblemIdOf
} from './server-problems';

const ID = 'abc123def456ghi';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ID,
		source: 'channel',
		area: 'private',
		code: 'channel_error',
		message: 'Der Kalender antwortet mit HTTP 500.',
		context: { connection: 'conn00000000001', channel: 'calendar' },
		count: 3,
		first_at: '2026-11-01 08:00:00.000Z',
		last_at: '2026-11-02 09:30:00.000Z',
		...overrides
	};
}

function entryOf(overrides: Record<string, unknown> = {}): ProblemEntry {
	const record = parseServerProblem(raw(overrides));
	if (record === null) throw new Error('not an entry');
	return serverProblemEntry(record);
}

function facts(entry: ProblemEntry): Record<string, string> {
	return Object.fromEntries(problemFacts(entry).map(({ label, value }) => [label, value]));
}

describe('server-problems: an entry of the record API', () => {
	it('reads source, area, code, message, context, count and both times', () => {
		expect(parseServerProblem(raw())).toEqual({
			id: ID,
			source: 'channel',
			area: 'private',
			code: 'channel_error',
			message: 'Der Kalender antwortet mit HTTP 500.',
			context: { connection: 'conn00000000001', channel: 'calendar' },
			count: 3,
			firstAt: Date.UTC(2026, 10, 1, 8, 0, 0),
			lastAt: Date.UTC(2026, 10, 2, 9, 30, 0)
		});
	});

	it('keeps only the known keys of the context and cleans every text again', () => {
		const record = parseServerProblem(
			raw({
				message: 'Abruf /x?token=geheim gescheitert',
				context: {
					route: '/api/byl/x?key=1',
					method: 'POST',
					status: 500,
					body: 'Inhalt',
					token: 'x'
				}
			})
		);
		expect(record?.message).toBe('Abruf /x gescheitert');
		expect(record?.context).toEqual({ route: '/api/byl/x', method: 'POST', status: 500 });
	});

	it('takes no entry without ID, known source and area or readable times', () => {
		expect(parseServerProblem(raw({ id: 'kurz' }))).toBeNull();
		expect(parseServerProblem(raw({ source: 'browser' }))).toBeNull();
		expect(parseServerProblem(raw({ area: 'public' }))).toBeNull();
		expect(parseServerProblem(raw({ first_at: '' }))).toBeNull();
		expect(parseServerProblem(null)).toBeNull();
		expect(parseServerProblem(raw({ count: 0 }))?.count).toBe(1);
	});
});

describe('server-problems: an entry of the dialog', () => {
	it('names a failed run of a channel with its kind, as reported by the server', () => {
		const entry = entryOf();
		expect(entry).toMatchObject({
			id: `server-${ID}`,
			source: 'server',
			intent: 'Kanal im Hintergrund abrufen: Google Calendar',
			count: 3,
			outcome: { result: 'reported', status: null, code: 'channel_error' },
			request: null,
			app: null,
			serverId: ID,
			area: 'private'
		});
	});

	it('names a request with the intent of the catalog, its status and route', () => {
		const entry = entryOf({
			source: 'request',
			area: 'system',
			code: 'http_500',
			context: { method: 'POST', route: '/api/byl/tickets/abc123def456789/duplicate', status: 500 }
		});
		expect(entry).toMatchObject({
			intent: 'Ticket duplizieren',
			outcome: { result: 'response', status: 500, code: 'http_500' },
			request: { method: 'POST', path: '/api/byl/tickets/abc123def456789/duplicate' }
		});
		expect(entryOf({ source: 'request', context: {} }).intent).toBe('Anfrage an den Server');
	});

	it('names a job by its name in the context', () => {
		expect(entryOf({ source: 'job', area: 'system', context: { job: 'trash' } }).intent).toBe(
			'Papierkorb aufräumen'
		);
		expect(
			entryOf({ source: 'job', area: 'household', context: { job: 'recurrence' } }).intent
		).toBe('Wiederholungen erzeugen');
		expect(entryOf({ source: 'job', context: {} }).intent).toBe('Aufgabe im Hintergrund');
	});

	it('shows area, count, last occurrence and the Server-ID, but no build of this app', () => {
		const shown = facts(entryOf());
		expect(shown).toMatchObject({
			[PROBLEM_TEXTS.count]: '3×',
			[PROBLEM_TEXTS.at]: '01.11.2026, 09:00:00',
			[PROBLEM_TEXTS.lastAt]: '02.11.2026, 10:30:00',
			[PROBLEM_TEXTS.area]: 'Privat, nur für dich',
			[PROBLEM_TEXTS.serverId]: ID
		});
		expect(shown).not.toHaveProperty(PROBLEM_TEXTS.app);
		expect(facts(entryOf({ area: 'household' }))[PROBLEM_TEXTS.area]).toBe(
			'Haushalt, für alle Mitglieder'
		);
		expect(facts(entryOf({ area: 'system' }))[PROBLEM_TEXTS.area]).toBe(
			'App, nur für den Verwalter'
		);
	});

	it('copies a report with the Server-ID once and both times in UTC', () => {
		const report = problemReport(entryOf());
		expect(report).toContain(`Server-ID: ${ID}`);
		expect(report.match(/Server-ID/g)).toHaveLength(1);
		expect(report).toContain('Zeitpunkt: 01.11.2026, 09:00:00 (2026-11-01T08:00:00.000Z)');
		expect(report).toContain('Zuletzt: 02.11.2026, 10:30:00 (2026-11-02T09:30:00.000Z)');
	});

	it('names the Server-ID of an entry of this tab whose answer named one', () => {
		const entry = clientProblem({
			id: 'p-1',
			intent: 'Ticket duplizieren',
			at: Date.UTC(2026, 10, 2, 9, 0, 0),
			outcome: { result: 'response', status: 500, code: null, message: null },
			request: { method: 'POST', path: '/api/byl/tickets/abc123def456789/duplicate' },
			app: null,
			exception: null,
			serverId: ID
		});
		expect(problemFacts(entry).at(-1)).toEqual({ label: 'Server-ID', value: ID });
		expect(problemReport(entry)).toContain(`Server-ID: ${ID}`);
		const without = clientProblem({ ...entry, id: 'p-2', serverId: undefined });
		expect(problemReport(without)).not.toContain('Server-ID');
	});
});

describe('server-problems: the address of an entry', () => {
	it('reads ?fehler=<id> only with the form of an ID', () => {
		expect(SERVER_PROBLEM_PARAM).toBe('fehler');
		expect(serverProblemIdOf(new URLSearchParams(`fehler=${ID}&x=1`))).toBe(ID);
		for (const value of ['', 'kurz', `${ID}x`, 'ABC123DEF456GHI', '../../x']) {
			expect(serverProblemIdOf(new URLSearchParams({ fehler: value })), value).toBeNull();
		}
		expect(isServerProblemId(ID)).toBe(true);
		expect(isServerProblemId(null)).toBe(false);
	});
});
