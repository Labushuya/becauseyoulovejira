// State of a connection as lozenge (ADR-0026 section 3, plan EH-3 §3.5; since the plan
// kanal-karten KK-2 with the states of the unified card): every row of the table and the order of
// the checks, an unknown state of the variables and of the mail helper, and the keyword summary.
// Since KE-1 (ADR-0076) the fixtures are connections whose setup is done (a good run), and the
// open setup is a state of its own: never "Verbunden" while a mandatory step is open; a variable
// that only waits for the restart is not called missing.

import { describe, expect, it } from 'vitest';
import { channelHealth, keywordSummary } from './channel-health';
import { NO_KEYWORDS_WARNING, type Connection } from './connections';
import { EMPTY_GITHUB_SETTINGS, NO_TOKEN_HINT } from './github';
import { OPEN_SETUP_TEXTS } from './open-setups';

type Facts = Pick<
	Connection,
	| 'type'
	| 'mailProvider'
	| 'label'
	| 'enabled'
	| 'secretEnv'
	| 'allowlistEnv'
	| 'lastRunAt'
	| 'lastOkAt'
	| 'lastError'
	| 'lastHint'
	| 'keywords'
	| 'github'
	| 'folders'
>;

const OK = '2026-09-25 08:00:00.000Z';

/** A calendar whose setup is done: keywords and a good first run. */
const BASE: Facts = {
	type: 'calendar',
	mailProvider: '',
	label: 'Kalender',
	enabled: true,
	secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
	allowlistEnv: '',
	lastRunAt: OK,
	lastOkAt: OK,
	lastError: '',
	lastHint: '',
	keywords: ['todo']
};
const SET = { secret: true, allowlist: null };
const UNSET = { secret: false, allowlist: null };
const REPO = {
	repo: 'octo-org/roadmap',
	paths: ['CHANGELOG*'],
	events: { files: true, pulls: true, releases: true },
	target: null
};

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
		const health = channelHealth({ ...BASE, lastError: 'HTTP 404' }, UNSET, false, null, {
			stored: { secret: false, allowlist: null }
		});
		expect(health).toMatchObject({
			state: 'unset',
			label: 'Einrichtung offen',
			tone: 'neutral',
			action: 'setup'
		});
		expect(health.hint?.tone).toBe('warning');
		expect(health.hint?.text).toMatch(/Variable BYL_GOOGLE_CALENDAR_URL anlegen/);
	});

	it('says "Wartet auf Neustart" when the PC has the variable and the server does not see it yet (KE-1, M1)', () => {
		const waiting = channelHealth(BASE, UNSET, false, null, {
			stored: { secret: true, allowlist: null }
		});
		expect(waiting).toMatchObject({ state: 'unset', label: 'Einrichtung offen', action: 'setup' });
		expect(waiting.hint).toEqual({
			tone: 'info',
			text: 'Wartet auf Neustart: BYL_GOOGLE_CALENDAR_URL ist gesetzt, die App sieht die Variable erst nach einem Neustart.'
		});
		expect(waiting.hint?.text).not.toMatch(/fehlen/);
		// Telegram with both variables set on the PC.
		const bot = {
			...BASE,
			type: 'telegram' as const,
			secretEnv: 'BYL_TELEGRAM_TOKEN',
			allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
		};
		expect(
			channelHealth(bot, { secret: false, allowlist: false }, false, null, {
				stored: { secret: true, allowlist: true }
			}).hint?.text
		).toBe(
			'Wartet auf Neustart: BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS sind gesetzt, die App sieht sie erst nach einem Neustart.'
		);
	});

	it('says both where the state on the PC is unknown, "am PC prüfen" on another device (KE-1, M1)', () => {
		const pc = channelHealth(BASE, UNSET, false);
		expect(pc.hint).toEqual({
			tone: 'warning',
			text: 'Zugangsdaten fehlen oder warten auf Neustart: Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		});
		const phone = channelHealth(BASE, UNSET, false, null, { remote: true });
		expect(phone.hint?.text).toBe(
			'Zugangsdaten fehlen oder warten auf Neustart – am PC prüfen (BYL_GOOGLE_CALENDAR_URL).'
		);
		// Never "wartet auf Neustart" alone without the knowledge of the PC.
		expect(pc.hint?.text).not.toMatch(/^Wartet/);
		expect(phone.hint?.text).not.toMatch(/^Wartet/);
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

	it('names the open step at an error of a first run that never went well (KE-1)', () => {
		const health = channelHealth(
			{ ...BASE, lastOkAt: null, lastError: 'HTTP 404 von https://calendar.google.com' },
			SET,
			false
		);
		expect(health).toMatchObject({ state: 'error', label: 'Fehler', action: 'run' });
		expect(health.hint).toEqual({
			tone: 'error',
			text: 'Offener Schritt „Erster Abruf“ – Letzter Fehler: HTTP 404 von https://calendar.google.com'
		});
	});

	it('says "Einrichtung offen" with the open step instead of "Verbunden" (KE-1)', () => {
		const fresh = channelHealth({ ...BASE, lastRunAt: null, lastOkAt: null }, SET, false);
		expect(fresh).toMatchObject({
			state: 'open',
			label: 'Einrichtung offen',
			tone: 'neutral',
			action: 'run'
		});
		expect(fresh.hint).toEqual({
			tone: 'info',
			text: 'Offener Schritt „Erster Abruf“: Noch kein Abruf.'
		});
		const chat = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';
		const bot = {
			...BASE,
			type: 'telegram' as const,
			secretEnv: 'BYL_TELEGRAM_TOKEN',
			allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
			lastHint: chat
		};
		expect(channelHealth(bot, { secret: true, allowlist: true }, false)).toMatchObject({
			state: 'open',
			hint: {
				tone: 'info',
				text: 'Offener Schritt „Chat freigeben“: Nachricht aus einem Chat, der noch nicht freigegeben ist (Chat-ID 424242).'
			}
		});
		// A mailbox waiting for its first run still offers the mailbox selection.
		const mail = {
			...BASE,
			type: 'mail' as const,
			mailProvider: 'webde' as const,
			lastRunAt: null
		};
		expect(channelHealth(mail, SET, false)).toMatchObject({ state: 'open', pick: true });
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
		// The keywords never hold a setup open (ADR-0076 §1): "Verbunden" with the warning.
		const empty = channelHealth({ ...BASE, keywords: [] }, SET, false);
		expect(empty.label).toBe('Verbunden');
		expect(empty.hint).toEqual({ tone: 'warning', text: NO_KEYWORDS_WARNING });
		// The hint of the last run wins over the missing keywords.
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
		// The integration sees no page yet: "Freigeben" is open (KE-1), the hint of Notion stays.
		const hint = 'Die Integration sieht noch keine Seite.';
		expect(channelHealth({ ...notion, lastHint: hint }, SET, false)).toMatchObject({
			state: 'open',
			label: 'Einrichtung offen',
			hint: { tone: 'warning', text: `Offener Schritt „Freigeben“: ${hint}` }
		});
	});

	it('runs GitHub without its token: a neutral hint, no open setup, no keywords (ADR-0050)', () => {
		const github = {
			...BASE,
			type: 'github' as const,
			secretEnv: 'BYL_GITHUB_TOKEN',
			keywords: [],
			github: { ...EMPTY_GITHUB_SETTINGS, repos: [REPO] }
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
		// The hint of the last run (e.g. the rate limit) goes first, also without the token, and is
		// no open setup.
		const limit = 'Anfragelimit von GitHub erreicht; der nächste Abruf folgt ab 14:00.';
		expect(channelHealth({ ...github, lastHint: limit }, UNSET, false)).toMatchObject({
			state: 'ok',
			hint: { tone: 'info', text: limit }
		});
		// A token set on the PC only waits for the restart (KE-1, M1): not "Ohne Token".
		expect(
			channelHealth(github, UNSET, false, null, { stored: { secret: true, allowlist: null } }).hint
		).toEqual({ tone: 'info', text: OPEN_SETUP_TEXTS.tokenWaits });
		expect(
			channelHealth(github, UNSET, false, null, { stored: { secret: false, allowlist: null } }).hint
				?.text
		).toBe(NO_TOKEN_HINT);
		// Without a repository the setup is open (KE-1); the main action stays.
		expect(channelHealth({ ...github, github: EMPTY_GITHUB_SETTINGS }, SET, false)).toMatchObject({
			state: 'open',
			action: 'run',
			hint: {
				tone: 'warning',
				text: 'Offener Schritt „Repositorys“: Verbindung „Kalender“ angelegt, noch ohne Repository.'
			}
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
			channelHealth({ ...BASE, lastRunAt: null, lastOkAt: null }, SET, false),
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
