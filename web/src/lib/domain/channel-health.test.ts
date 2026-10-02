// State of a connection as lozenge (ADR-0026 section 3, plan EH-3 §3.5; since the plan
// kanal-karten KK-2 with the states of the unified card): every row of the table and the order of
// the checks, an unknown state of the variables and of the mail helper, and the keyword summary.

import { describe, expect, it } from 'vitest';
import { channelHealth, keywordSummary } from './channel-health';
import { NO_KEYWORDS_WARNING, type Connection } from './connections';

type Facts = Pick<
	Connection,
	'type' | 'enabled' | 'secretEnv' | 'allowlistEnv' | 'lastError' | 'lastHint' | 'keywords'
>;

const BASE: Facts = {
	type: 'calendar',
	enabled: true,
	secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
	allowlistEnv: '',
	lastError: '',
	lastHint: '',
	keywords: ['todo']
};
const SET = { secret: true, allowlist: null };
const UNSET = { secret: false, allowlist: null };

describe('channelHealth', () => {
	it('says "Wird abgerufen" first, while a fetch runs', () => {
		const health = channelHealth({ ...BASE, enabled: false, lastError: 'x' }, UNSET, true);
		expect(health).toMatchObject({ state: 'running', label: 'Wird abgerufen', action: 'none' });
		expect(health.hint).toBeNull();
	});

	it('says "Pausiert" before missing data and errors, with "Fortsetzen"', () => {
		const health = channelHealth({ ...BASE, enabled: false, lastError: 'x' }, UNSET, false);
		expect(health).toMatchObject({
			state: 'paused',
			label: 'Pausiert',
			tone: 'muted',
			action: 'resume'
		});
		expect(health.hint).toEqual({ tone: 'info', text: 'Pausiert: Die App ruft nichts ab.' });
		expect(channelHealth({ ...BASE, type: 'mail', enabled: false }, SET, false).hint?.text).toBe(
			'Pausiert: Der Hilfsprozess ruft pausierte Postfächer nicht ab.'
		);
	});

	it('says "Einrichtung offen" while a variable is missing, before the last error', () => {
		const health = channelHealth({ ...BASE, lastError: 'HTTP 404' }, UNSET, false);
		expect(health).toMatchObject({
			state: 'unset',
			label: 'Einrichtung offen',
			tone: 'neutral',
			action: 'setup'
		});
		expect(health.hint?.tone).toBe('warning');
		expect(health.hint?.text).toMatch(/Variable BYL_GOOGLE_CALENDAR_URL anlegen/);
	});

	it('counts a missing allowlist of Telegram as not set up', () => {
		const bot = { ...BASE, type: 'telegram' as const, allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS' };
		expect(channelHealth(bot, { secret: true, allowlist: false }, false).state).toBe('unset');
	});

	it('says "Fehler" with the danger tone and the hint of the last run', () => {
		const health = channelHealth(
			{ ...BASE, lastError: 'Anmeldung abgelehnt.', lastHint: 'App-Passwort nötig.' },
			SET,
			false
		);
		expect(health).toMatchObject({
			state: 'error',
			label: 'Fehler',
			tone: 'danger',
			action: 'run'
		});
		expect(health.hint).toEqual({
			tone: 'error',
			text: 'Letzter Fehler: Anmeldung abgelehnt. App-Passwort nötig.'
		});
		expect(channelHealth({ ...BASE, type: 'mail', lastError: 'x' }, SET, false)).toMatchObject({
			action: 'run',
			pick: true
		});
	});

	it('says "Neustart nötig" at a mailbox whose mail helper does not run as it should (KK-2)', () => {
		const mail = { ...BASE, type: 'mail' as const };
		for (const state of ['stopped', 'refused', 'outdated'] as const) {
			const health = channelHealth(mail, SET, false, { state, version: '', message: '' });
			expect(health).toMatchObject({
				state: 'restart',
				label: 'Neustart nötig',
				tone: 'neutral',
				icon: 'warning',
				action: 'run',
				pick: true
			});
			expect(health.hint?.tone).toBe('warning');
			expect(health.hint?.text).toMatch(/^Hilfsprozess läuft/);
		}
		expect(
			channelHealth(mail, SET, false, { state: 'stopped', version: '', message: '' }).hint?.text
		).toMatch(/neu-starten\.bat/);
		// Running, unknown, other kinds, and the states before it keep their order.
		const running = { state: 'running' as const, version: '0.9.0', message: '' };
		expect(channelHealth(mail, SET, false, running).state).toBe('ok');
		expect(channelHealth(mail, SET, false, null).state).toBe('ok');
		const stopped = { state: 'stopped' as const, version: '', message: '' };
		expect(channelHealth(BASE, SET, false, stopped).state).toBe('ok');
		expect(channelHealth({ ...mail, lastError: 'x' }, SET, false, stopped).state).toBe('error');
		expect(channelHealth({ ...mail, enabled: false }, SET, false, stopped).state).toBe('paused');
		expect(channelHealth(mail, UNSET, false, stopped).state).toBe('unset');
	});

	it('says "Verbunden" otherwise, with the hint of the last run or a warning without keywords', () => {
		expect(channelHealth(BASE, SET, false)).toMatchObject({
			state: 'ok',
			label: 'Verbunden',
			tone: 'brand',
			hint: null,
			action: 'run'
		});
		expect(channelHealth({ ...BASE, lastHint: 'Erster Abruf.' }, SET, false).hint).toEqual({
			tone: 'info',
			text: 'Erster Abruf.'
		});
		const empty = channelHealth({ ...BASE, keywords: [] }, SET, false);
		expect(empty.label).toBe('Verbunden');
		expect(empty.hint).toEqual({ tone: 'warning', text: NO_KEYWORDS_WARNING });
		// The hint of the last run (e.g. the chat ID of Telegram) wins over the missing keywords.
		const chat = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';
		expect(channelHealth({ ...BASE, keywords: [], lastHint: chat }, SET, false).hint).toEqual({
			tone: 'info',
			text: chat
		});
		expect(channelHealth({ ...BASE, type: 'mail' }, SET, false)).toMatchObject({
			action: 'run',
			pick: true
		});
	});

	it('offers "Jetzt abrufen" on every set-up card and the mailbox selection only at a mailbox (package A)', () => {
		const mail = { ...BASE, type: 'mail' as const };
		expect(channelHealth(BASE, SET, false).pick).toBe(false);
		expect(channelHealth(mail, SET, true)).toMatchObject({ action: 'none', pick: true });
		expect(channelHealth({ ...mail, enabled: false }, SET, false)).toMatchObject({
			action: 'resume',
			pick: false
		});
		expect(channelHealth(mail, UNSET, false)).toMatchObject({ action: 'setup', pick: false });
	});

	it('does not ask Notion for keywords: the user chooses what to import (ADR-0041)', () => {
		const notion = { ...BASE, type: 'notion' as const, keywords: [] };
		expect(channelHealth(notion, SET, false)).toMatchObject({
			state: 'ok',
			hint: null,
			action: 'run',
			pick: false
		});
		const hint = 'Die Integration sieht noch keine Seite.';
		expect(channelHealth({ ...notion, lastHint: hint }, SET, false).hint).toEqual({
			tone: 'info',
			text: hint
		});
	});

	it('runs GitHub without its token: a neutral hint, no open setup, no keywords (ADR-0050)', () => {
		const github = {
			...BASE,
			type: 'github' as const,
			secretEnv: 'BYL_GITHUB_TOKEN',
			keywords: []
		};
		expect(channelHealth(github, SET, false)).toMatchObject({
			state: 'ok',
			hint: null,
			action: 'run'
		});
		expect(channelHealth(github, UNSET, false)).toMatchObject({
			state: 'ok',
			tone: 'brand',
			hint: {
				tone: 'info',
				text: expect.stringMatching(/^Ohne Token: nur öffentliche Repositorys/)
			},
			action: 'run'
		});
		// The hint of the last run (e.g. the rate limit) goes first, also without the token.
		const limit = 'Anfragelimit von GitHub erreicht; der nächste Abruf folgt ab 14:00.';
		expect(channelHealth({ ...github, lastHint: limit }, UNSET, false).hint).toEqual({
			tone: 'info',
			text: limit
		});
	});

	it('skips the check of the variables while their state is unknown', () => {
		expect(channelHealth(BASE, null, false).state).toBe('ok');
		expect(channelHealth({ ...BASE, lastError: 'x' }, null, false).state).toBe('error');
	});

	it('uses the danger tone only for a real error (ADR-0009)', () => {
		const states = [
			channelHealth(BASE, SET, true),
			channelHealth({ ...BASE, enabled: false }, SET, false),
			channelHealth(BASE, UNSET, false),
			channelHealth({ ...BASE, type: 'mail' }, SET, false, {
				state: 'stopped',
				version: '',
				message: ''
			}),
			channelHealth(BASE, SET, false)
		];
		expect(states.map((health) => health.tone)).not.toContain('danger');
	});
});

describe('keywordSummary', () => {
	it.each([
		[[], 'keine'],
		[['todo'], '1 (todo)'],
		[['todo', 'ticket', '#byl'], '3 (todo, ticket, #byl)'],
		[['a', 'b', 'c', 'd', 'e'], '5 (a, b, c, +2)']
	])('summarises %j as "%s"', (keywords, text) => {
		expect(keywordSummary(keywords)).toBe(text);
	});
});
