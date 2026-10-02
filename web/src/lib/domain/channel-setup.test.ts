// Unit tests of the setup assistant (plans EH-5 and EH-7 §3.7/§3.8): the address, the step data of
// Google Calendar, Web.de and Gmail (at most 6 steps, labels of one or two words, https links only,
// every secret placeholder marked), the progress from the facts of the server for every state, the
// states of the stepper, the check lines and the hint on an open earlier step; Proton as a list.

import { describe, expect, it } from 'vitest';
import {
	CHAT_COMMAND,
	GUIDE_KINDS,
	PROTON_LINK,
	PROTON_STEPS,
	SETUP_KINDS,
	chatIdFromHint,
	defaultVariable,
	matchesSetupKind,
	openCheckBefore,
	setupComplete,
	setupKindOf,
	setupProgress,
	setupStepKey,
	setupSteps,
	setupTargetOf,
	stepCheck,
	stepStates,
	TARGET_STEP,
	type SetupFacts
} from './channel-setup';
import { NO_KEYWORDS_WARNING, type Connection } from './connections';

const ID = 'conn00000000001';

function connection(overrides: Partial<Connection> = {}): NonNullable<SetupFacts['connection']> {
	return {
		label: 'Kalender',
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		keywords: [],
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		...overrides
	};
}

const NONE: SetupFacts = { connection: null, secretStatus: null };
const CREATED: SetupFacts = {
	connection: connection(),
	secretStatus: { secret: false, allowlist: null }
};
const VISIBLE: SetupFacts = {
	connection: connection(),
	secretStatus: { secret: true, allowlist: null }
};
const WITH_KEYWORDS: SetupFacts = {
	connection: connection({ keywords: ['todo'] }),
	secretStatus: { secret: true, allowlist: null }
};
const RUN: SetupFacts = {
	connection: connection({
		keywords: ['todo'],
		lastRunAt: '2026-09-26 10:00:00.000Z',
		lastOkAt: '2026-09-26 10:00:00.000Z'
	}),
	secretStatus: { secret: true, allowlist: null }
};

describe('address of the assistant', () => {
	it('reads kind and connection; unknown kinds and bad IDs count as not set', () => {
		expect(setupTargetOf(new URLSearchParams('einrichten=kalender'))).toEqual({
			kind: 'kalender',
			connectionId: null
		});
		expect(setupTargetOf(new URLSearchParams(`einrichten=kalender&verbindung=${ID}`))).toEqual({
			kind: 'kalender',
			connectionId: ID
		});
		expect(setupTargetOf(new URLSearchParams('einrichten=kalender&verbindung=../x'))).toEqual({
			kind: 'kalender',
			connectionId: null
		});
		expect(setupTargetOf(new URLSearchParams('einrichten=whatsapp-web'))).toEqual({
			kind: 'whatsapp-web',
			connectionId: null
		});
		expect(setupTargetOf(new URLSearchParams('einrichten=notion'))).toEqual({
			kind: 'notion',
			connectionId: null
		});
		expect(setupTargetOf(new URLSearchParams('einrichten=slack'))).toBeNull();
		expect(setupTargetOf(new URLSearchParams('einrichten=kalender&einrichten=gmail'))).toBeNull();
		expect(setupTargetOf(new URLSearchParams(''))).toBeNull();
	});

	it('maps connections to kinds and back', () => {
		const mail = { type: 'mail' as const, mailProvider: 'gmail' as const };
		expect(setupKindOf({ type: 'calendar', mailProvider: '' })).toBe('kalender');
		expect(setupKindOf({ type: 'telegram', mailProvider: '' })).toBe('telegram');
		expect(setupKindOf(mail)).toBe('gmail');
		expect(setupKindOf({ type: 'mail', mailProvider: 'webde' })).toBe('webde');
		expect(setupKindOf({ type: 'notion', mailProvider: '' })).toBe('notion');
		expect(matchesSetupKind({ type: 'notion', mailProvider: '' }, 'notion')).toBe(true);
		expect(matchesSetupKind(mail, 'gmail')).toBe(true);
		expect(matchesSetupKind(mail, 'webde')).toBe(false);
		expect(matchesSetupKind({ type: 'calendar', mailProvider: '' }, 'telegram')).toBe(false);
		expect(setupStepKey(ID)).toBe(`byl-setup:${ID}`);
	});
});

describe('step data', () => {
	it.each(SETUP_KINDS.filter((kind) => !GUIDE_KINDS.includes(kind)))(
		'%s has 3 to 6 steps with short labels, and the optional "Zielprojekt" after "Verbinden"',
		(kind) => {
			const steps = setupSteps(kind);
			const required = steps.filter((step) => step.id !== 'target');
			expect(required.length).toBeGreaterThanOrEqual(3);
			expect(required.length).toBeLessThanOrEqual(6);
			// ADR-0026, addendum ZP (ADR-0049): one optional step more, right after "Verbinden".
			const connect = steps.findIndex((step) => step.id === 'connect');
			expect(steps[connect + 1]).toBe(TARGET_STEP);
			expect(steps.filter((step) => step.id === 'target')).toHaveLength(1);
			for (const step of steps) {
				expect(step.label.split(' ').length, step.label).toBeLessThanOrEqual(2);
				expect(step.intro.split(/(?<=[.!?])\s/).length, step.id).toBeLessThanOrEqual(2);
			}
		}
	);

	it('never holds the assistant up at "Zielprojekt"', () => {
		expect(TARGET_STEP).toMatchObject({ label: 'Zielprojekt', checked: false });
		expect(TARGET_STEP.title).toMatch(/optional/);
		expect(stepCheck('kalender', 'target', CREATED)).toBeNull();
		// Without a connection it is open, with one done, chosen or not.
		expect(stepStates('kalender', NONE, 0)[1]).toBe('open');
		expect(stepStates('kalender', CREATED, 2)[1]).toBe('done');
		expect(openCheckBefore('kalender', CREATED, 2)).toBeNull();
	});

	it.each(SETUP_KINDS)('%s links only to fixed https addresses', (kind) => {
		for (const step of setupSteps(kind)) {
			for (const link of step.links) expect(new URL(link.href).protocol, link.href).toBe('https:');
		}
	});

	it.each(SETUP_KINDS)('%s marks every value placeholder as secret or names it', (kind) => {
		for (const step of setupSteps(kind)) {
			for (const command of step.commands) {
				const names = [...command.template.matchAll(/\{\{([a-z-]+)\}\}/g)].map((match) => match[1]);
				for (const name of names) {
					expect(command.placeholders[name ?? ''], `${step.id}: ${name}`).toBeDefined();
				}
				if (command.value !== undefined) {
					expect(command.placeholders[command.value]?.secret, step.id).toBe(true);
				}
			}
		}
	});

	it('guides Google Calendar through six steps with the private iCal address', () => {
		const steps = setupSteps('kalender');
		expect(steps.map((step) => step.label)).toEqual([
			'Verbinden',
			'Zielprojekt',
			'Adresse holen',
			'Variable setzen',
			'Neu starten',
			'Stichwörter',
			'Erster Abruf'
		]);
		const text = JSON.stringify(steps);
		expect(text).toMatch(/Einstellungen und Freigabe/);
		expect(text).toMatch(/Privatadresse im iCal-Format/);
		expect(text).toMatch(/setx \{\{variable\}\} \\"\{\{wert\}\}\\"/);
		expect(text).toMatch(/app\\\\neu-starten\.bat/);
		expect(text).not.toMatch(/stop\.bat/);
		expect(text).toMatch(/Zurücksetzen/);
	});
});

describe('progress from the facts of the server', () => {
	// The optional "Zielprojekt" (index 1) is done once the connection exists, so the assistant
	// opens behind it.
	it.each([
		['without a connection', NONE, 0],
		['with a connection whose variable the app does not see', CREATED, 2],
		['once the app sees the variable', VISIBLE, 5],
		['with keywords', WITH_KEYWORDS, 6],
		['after a good run (all done: the last step)', RUN, 6]
	])('%s', (_name, facts, step) => {
		expect(setupProgress('kalender', facts)).toBe(step);
	});

	it('is complete only after a good run without error', () => {
		expect(setupComplete('kalender', WITH_KEYWORDS)).toBe(false);
		expect(setupComplete('kalender', RUN)).toBe(true);
		const failed: SetupFacts = {
			...RUN,
			connection: connection({ ...RUN.connection, lastError: 'HTTP 404' })
		};
		expect(setupComplete('kalender', failed)).toBe(false);
		expect(setupProgress('kalender', failed)).toBe(6);
	});

	it('treats an unknown state of the variable as not seen', () => {
		expect(setupProgress('kalender', { ...VISIBLE, secretStatus: null })).toBe(2);
	});

	it('shows done, current, open and a warning for a passed step whose check is open', () => {
		expect(stepStates('kalender', CREATED, 2)).toEqual([
			'done',
			'done',
			'current',
			'open',
			'open',
			'open',
			'open'
		]);
		expect(stepStates('kalender', CREATED, 5)).toEqual([
			'done',
			'done',
			'done',
			'done',
			'warning',
			'current',
			'open'
		]);
		expect(stepStates('kalender', WITH_KEYWORDS, 6)).toEqual([
			'done',
			'done',
			'done',
			'done',
			'done',
			'done',
			'current'
		]);
	});

	it('names the first open check before the current step', () => {
		expect(openCheckBefore('kalender', CREATED, 4)).toBeNull();
		expect(openCheckBefore('kalender', CREATED, 5)).toEqual({
			index: 4,
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		});
		expect(openCheckBefore('kalender', VISIBLE, 6)).toEqual({
			index: 5,
			text: NO_KEYWORDS_WARNING
		});
		expect(openCheckBefore('kalender', NONE, 2)).toEqual({
			index: 0,
			text: 'Noch keine Verbindung angelegt.'
		});
	});
});

describe('check lines', () => {
	it('say exactly what was checked', () => {
		expect(stepCheck('kalender', 'connect', NONE)).toEqual({
			tone: 'open',
			text: 'Noch keine Verbindung angelegt.'
		});
		expect(stepCheck('kalender', 'connect', CREATED)?.text).toBe('Verbindung „Kalender“ angelegt.');
		expect(stepCheck('kalender', 'restart', CREATED)).toEqual({
			tone: 'open',
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		});
		expect(stepCheck('kalender', 'restart', VISIBLE)).toEqual({
			tone: 'done',
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL.'
		});
		expect(stepCheck('kalender', 'restart', { ...VISIBLE, secretStatus: null })?.text).toMatch(
			/ließ sich nicht prüfen/
		);
		expect(stepCheck('kalender', 'keywords', VISIBLE)).toEqual({
			tone: 'warning',
			text: NO_KEYWORDS_WARNING
		});
		expect(stepCheck('kalender', 'keywords', WITH_KEYWORDS)?.text).toBe('1 Stichwort: todo.');
		expect(stepCheck('kalender', 'first-run', WITH_KEYWORDS)).toEqual({
			tone: 'open',
			text: 'Noch kein Abruf.'
		});
		expect(stepCheck('kalender', 'first-run', RUN)?.tone).toBe('done');
		expect(
			stepCheck('kalender', 'first-run', {
				...RUN,
				connection: connection({ lastError: 'HTTP 404' })
			})
		).toEqual({ tone: 'error', text: 'Letzter Abruf fehlgeschlagen: HTTP 404' });
		expect(stepCheck('kalender', 'address', RUN)).toBeNull();
		expect(stepCheck('kalender', 'variable', RUN)).toBeNull();
	});
});

describe('mailboxes (plan EH-7)', () => {
	const MAIL = connection({ label: 'Web.de', secretEnv: 'BYL_WEBDE_PASSWORD' });
	const mail = (overrides: Partial<Connection>, secret: boolean | null = true): SetupFacts => ({
		connection: connection({ ...MAIL, ...overrides }),
		secretStatus: secret === null ? null : { secret, allowlist: null }
	});

	it.each([
		[
			'webde',
			[
				'Abruf erlauben',
				'Passwort',
				'Variable setzen',
				'Verbinden',
				'Zielprojekt',
				'Neu starten',
				'Erster Abruf'
			]
		],
		[
			'gmail',
			[
				'Zwei Schritte',
				'App-Passwort',
				'Variable setzen',
				'Verbinden',
				'Zielprojekt',
				'Neu starten',
				'Erster Abruf'
			]
		]
	] as const)('guides %s through six steps and the optional target project', (kind, labels) => {
		expect(setupSteps(kind).map((step) => step.label)).toEqual(labels);
		expect(defaultVariable(kind)).toBe(
			kind === 'gmail' ? 'BYL_GMAIL_PASSWORD' : 'BYL_WEBDE_PASSWORD'
		);
	});

	it('drops the spaces of the Gmail app password only', () => {
		const gmail = setupSteps('gmail').find((step) => step.id === 'variable');
		const webde = setupSteps('webde').find((step) => step.id === 'variable');
		expect(gmail?.commands[0]?.normalize).toBe('gmail');
		expect(webde?.commands[0]?.normalize).toBeUndefined();
		expect(JSON.stringify(setupSteps('gmail'))).toMatch(/myaccount\.google\.com\/apppasswords/);
		expect(JSON.stringify(setupSteps('webde'))).toMatch(/POP3- und IMAP-Zugriff erlauben/);
	});

	it('counts the steps before "Verbinden" as done once the mailbox is connected', () => {
		expect(setupProgress('webde', NONE)).toBe(0);
		expect(setupProgress('webde', mail({}, false))).toBe(5);
		expect(stepStates('webde', mail({}, false), 5)).toEqual([
			'done',
			'done',
			'done',
			'done',
			'done',
			'current',
			'open'
		]);
		expect(setupProgress('webde', mail({}))).toBe(6);
	});

	it('is done after the first run of the helper, which sets the last run and no error', () => {
		expect(stepCheck('webde', 'first-run', mail({}))).toEqual({
			tone: 'open',
			text: 'Warte auf den ersten Abruf (spätestens 5 Minuten) …'
		});
		const run = mail({ lastRunAt: '2026-09-26 10:00:00.000Z', keywords: ['todo'] });
		expect(stepCheck('webde', 'first-run', run)?.text).toMatch(/^Abgerufen, zuletzt/);
		expect(setupComplete('webde', run)).toBe(true);
		const refused = mail({
			lastRunAt: '2026-09-26 10:00:00.000Z',
			lastError: 'Anmeldung bei Web.de abgelehnt.'
		});
		expect(setupComplete('webde', refused)).toBe(false);
		expect(stepCheck('webde', 'first-run', refused)?.tone).toBe('error');
	});

	it('warns at "Verbinden" while the mailbox has no keywords', () => {
		expect(stepCheck('gmail', 'connect', mail({}))).toEqual({
			tone: 'warning',
			text: `Verbindung „Web.de“ angelegt. ${NO_KEYWORDS_WARNING}`
		});
		expect(stepCheck('gmail', 'connect', mail({ keywords: ['todo'] }))?.tone).toBe('done');
	});

	it('keeps Proton to three steps without a stepper', () => {
		expect(setupSteps('proton')).toEqual([]);
		expect(PROTON_STEPS).toHaveLength(3);
		expect(new URL(PROTON_LINK.href).protocol).toBe('https:');
	});
});

describe('Telegram (plan EH-6)', () => {
	const BOT = connection({
		label: 'Bot',
		secretEnv: 'BYL_TELEGRAM_TOKEN',
		allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
	});
	const bot = (overrides: Partial<Connection>, allowlist: boolean | null = true): SetupFacts => ({
		connection: connection({ ...BOT, ...overrides }),
		secretStatus: { secret: true, allowlist }
	});
	const HINT = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';

	it.each([
		[HINT, '424242'],
		['Nachricht aus einem nicht freigegebenen Chat (Chat-ID -1001234567890).', '-1001234567890'],
		['Chat-ID 12345678901234567890', '12345678901234567890'],
		['Chat-ID 123456789012345678901', null],
		['Chat-ID abc', null],
		['Chat-ID --5', null],
		['Erster Abruf', null],
		['', null]
	])('reads the chat ID from "%s"', (hint, id) => {
		expect(chatIdFromHint(hint)).toBe(id);
	});

	it('guides through six steps with BotFather, both variables and the chat', () => {
		expect(setupSteps('telegram').map((step) => step.label)).toEqual([
			'Bot anlegen',
			'Token setzen',
			'Verbinden',
			'Zielprojekt',
			'Neu starten',
			'Chat freigeben',
			'Test'
		]);
		const text = JSON.stringify(setupSteps('telegram'));
		expect(text).toMatch(/\/newbot/);
		expect(text).toMatch(/setx \{\{allowlist\}\} \\"0\\"/);
		expect(text).toMatch(/-100/);
		expect(text).toMatch(/\/setprivacy/);
		expect(CHAT_COMMAND.template).toBe('setx {{allowlist}} "{{ids}}"');
		expect(CHAT_COMMAND.placeholders.ids?.secret).toBe(false);
		expect(defaultVariable('telegram')).toBe('BYL_TELEGRAM_TOKEN');
	});

	it('needs both variables after the restart', () => {
		expect(setupProgress('telegram', bot({}, false))).toBe(4);
		expect(stepCheck('telegram', 'restart', bot({}, false))).toEqual({
			tone: 'open',
			text: 'Die App sieht BYL_TELEGRAM_ALLOWED_IDS noch nicht.'
		});
		expect(stepCheck('telegram', 'restart', bot({}))).toEqual({
			tone: 'done',
			text: 'Die App sieht BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS.'
		});
	});

	it('names a chat that is not allowed and is done once no foreign chat is reported', () => {
		expect(setupProgress('telegram', bot({}))).toBe(5);
		expect(stepCheck('telegram', 'chat', bot({}))?.tone).toBe('open');
		const foreign = bot({ lastRunAt: '2026-09-26 10:00:00.000Z', lastHint: HINT });
		expect(stepCheck('telegram', 'chat', foreign)).toEqual({
			tone: 'open',
			text: 'Nachricht aus einem Chat, der noch nicht freigegeben ist (Chat-ID 424242).'
		});
		expect(setupProgress('telegram', foreign)).toBe(5);
		const allowed = bot({ lastRunAt: '2026-09-26 10:30:00.000Z', lastHint: '' });
		expect(stepCheck('telegram', 'chat', allowed)).toEqual({
			tone: 'done',
			text: 'Kein fremder Chat mehr gemeldet.'
		});
		expect(setupProgress('telegram', allowed)).toBe(6);
	});

	it('is done after a good run with a keyword', () => {
		const run = {
			lastRunAt: '2026-09-26 11:00:00.000Z',
			lastOkAt: '2026-09-26 11:00:00.000Z'
		};
		expect(stepCheck('telegram', 'first-run', bot(run))).toEqual({
			tone: 'warning',
			text: NO_KEYWORDS_WARNING
		});
		expect(setupComplete('telegram', bot(run))).toBe(false);
		expect(setupComplete('telegram', bot({ ...run, keywords: ['todo'] }))).toBe(true);
	});
});

describe('Notion (ADR-0041, plan notion-import NI-2)', () => {
	function page(overrides: Partial<Connection> = {}, secret = true): SetupFacts {
		return {
			connection: connection({ label: 'Notion', secretEnv: 'BYL_NOTION_TOKEN', ...overrides }),
			secretStatus: { secret, allowlist: null }
		};
	}
	const OK = '2026-09-29 10:00:00.000Z';

	it('guides through six steps: read-only integration, token, connection, restart, sharing, check', () => {
		const steps = setupSteps('notion');
		expect(steps.map((step) => step.id)).toEqual([
			'integration',
			'variable',
			'connect',
			'target',
			'restart',
			'share',
			'check'
		]);
		expect(defaultVariable('notion')).toBe('BYL_NOTION_TOKEN');
		const integration = steps[0]!;
		expect(integration.links.map((link) => link.href)).toEqual([
			'https://app.notion.com/developers/connections'
		]);
		expect(integration.actions.join(' ')).toMatch(/nur „Read content“ eingeschaltet lassen/);
		expect(integration.actions.join(' ')).toMatch(/„Update content“, „Insert content“/);
		expect(steps[1]!.commands[0]!.template).toBe('setx {{variable}} "{{wert}}"');
		expect(steps[1]!.commands[0]!.placeholders.wert).toEqual({ label: 'Token', secret: true });
		expect(steps[5]!.actions.join(' ')).toMatch(/„•••“.*„Verbindungen“/);
		expect(GUIDE_KINDS).not.toContain('notion');
	});

	it('follows the facts: variable, restart, then the check of the server', () => {
		expect(setupProgress('notion', NONE)).toBe(0);
		expect(setupProgress('notion', page({}, false))).toBe(4);
		expect(setupProgress('notion', page())).toBe(5);
		expect(stepCheck('notion', 'check', page())).toEqual({
			tone: 'open',
			text: 'Noch nicht geprüft.'
		});
		// Notion answered, but the integration sees no page yet: "Freigeben" is still open.
		const hint = 'Die Integration sieht noch keine Seite. In Notion …';
		const unshared = page({ lastRunAt: OK, lastOkAt: OK, lastHint: hint });
		expect(setupProgress('notion', unshared)).toBe(5);
		expect(stepCheck('notion', 'check', unshared)).toEqual({ tone: 'warning', text: hint });
		const refused = page({ lastRunAt: OK, lastError: 'Notion lehnt den Token ab (401).' });
		expect(stepCheck('notion', 'check', refused)).toEqual({
			tone: 'error',
			text: 'Letzte Prüfung fehlgeschlagen: Notion lehnt den Token ab (401).'
		});
		const shared = page({ lastRunAt: OK, lastOkAt: OK });
		expect(setupComplete('notion', shared)).toBe(true);
		expect(stepCheck('notion', 'check', shared)?.tone).toBe('done');
	});
});

describe('GitHub (ADR-0050 §7)', () => {
	const REPO = {
		repo: 'octo-org/roadmap',
		paths: ['CHANGELOG*'],
		events: { files: true, pulls: true, releases: true },
		target: null
	};
	function watched(overrides: Partial<Connection> = {}, secret = true, repos = [REPO]): SetupFacts {
		return {
			connection: connection({
				label: 'GitHub',
				secretEnv: 'BYL_GITHUB_TOKEN',
				github: { interval: 15, repos },
				...overrides
			}),
			secretStatus: { secret, allowlist: null }
		};
	}
	const OK = '2026-10-02 10:00:00.000Z';

	it('guides through token, variable, restart, repositories, target project and check', () => {
		const steps = setupSteps('github');
		expect(steps.map((step) => step.id)).toEqual([
			'pat',
			'variable',
			'restart',
			'connect',
			'target',
			'check'
		]);
		expect(SETUP_KINDS).toContain('github');
		expect(GUIDE_KINDS).not.toContain('github');
		expect(defaultVariable('github')).toBe('BYL_GITHUB_TOKEN');
		expect(setupTargetOf(new URLSearchParams('einrichten=github'))).toEqual({
			kind: 'github',
			connectionId: null
		});
		expect(setupKindOf({ type: 'github', mailProvider: '' })).toBe('github');
		const actions = steps[0]!.actions.join(' ');
		// The exact click path of GitHub (fine-grained, selected repositories, read only).
		expect(actions).toMatch(/Profilbild.*„Settings“/);
		expect(actions).toMatch(
			/„Developer settings“.*„Personal access tokens“ → „Fine-grained tokens“/
		);
		expect(actions).toMatch(/„Generate new token“/);
		expect(actions).toMatch(/„Only select repositories“/);
		expect(actions).toMatch(/„Contents“ und „Pull requests“ auf „Read-only“/);
		expect(actions).toMatch(/„Metadata“ steht automatisch auf „Read-only“/);
		expect(actions).toMatch(/github_pat_/);
		expect(steps[0]!.links.map((link) => link.href)).toEqual([
			'https://github.com/settings/personal-access-tokens'
		]);
		expect(steps[1]!.commands[0]!.placeholders.wert).toEqual({ label: 'Token', secret: true });
		// The token is optional: the restart has no check of its own.
		expect(steps[2]!.checked).toBe(false);
		expect(steps[3]).toMatchObject({ label: 'Repositorys', checked: true });
	});

	it('follows the facts: repositories, then the check of the server', () => {
		expect(setupProgress('github', NONE)).toBe(0);
		expect(stepCheck('github', 'restart', NONE)).toBeNull();
		expect(stepCheck('github', 'connect', NONE)).toEqual({
			tone: 'open',
			text: 'Noch keine Verbindung angelegt.'
		});
		const fresh = watched();
		expect(setupProgress('github', fresh)).toBe(5);
		expect(stepCheck('github', 'connect', fresh)).toEqual({
			tone: 'done',
			text: 'Verbindung „GitHub“ mit 1 Repository angelegt.'
		});
		expect(stepCheck('github', 'restart', fresh)).toEqual({
			tone: 'done',
			text: 'Die App sieht BYL_GITHUB_TOKEN.'
		});
		// Without the token the app reads public repositories; the step says so, without a warning.
		expect(stepCheck('github', 'restart', watched({}, false))).toEqual({
			tone: 'open',
			text: 'Die App sieht BYL_GITHUB_TOKEN noch nicht; ohne Token liest sie nur öffentliche Repositorys.'
		});
		expect(stepCheck('github', 'connect', watched({}, true, []))).toEqual({
			tone: 'warning',
			text: 'Verbindung „GitHub“ angelegt, noch ohne Repository.'
		});
		expect(stepCheck('github', 'check', fresh)).toEqual({
			tone: 'open',
			text: 'Noch nicht geprüft.'
		});
		const checked = watched({ lastRunAt: OK, lastOkAt: OK });
		expect(setupComplete('github', checked)).toBe(true);
		expect(stepCheck('github', 'check', checked)).toEqual({
			tone: 'done',
			text: 'GitHub antwortet und die App liest die eingetragenen Repositorys, zuletzt 02.10.2026 12:00.'
		});
		expect(setupComplete('github', watched({ lastRunAt: OK, lastOkAt: OK }, false))).toBe(true);
		const refused = watched({ lastRunAt: OK, lastError: 'GitHub lehnt den Token ab (401).' });
		expect(stepCheck('github', 'check', refused)?.tone).toBe('error');
		expect(setupComplete('github', watched({ lastRunAt: OK, lastOkAt: OK }, true, []))).toBe(false);
	});
});
