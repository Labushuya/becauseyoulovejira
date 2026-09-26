// Unit tests of the setup assistant (plan EH-5 §3.7/§3.8): the address, the step data of Google
// Calendar (at most 6 steps, labels of one or two words, https links only, every secret
// placeholder marked), the progress from the facts of the server for every state, the states of
// the stepper, the check lines and the hint on an open earlier step.

import { describe, expect, it } from 'vitest';
import {
	ASSISTED_KINDS,
	SETUP_KINDS,
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
	type SetupFacts
} from './channel-setup';
import { NO_KEYWORDS_WARNING, type Connection } from './connections';

const ID = 'conn00000000001';

function connection(overrides: Partial<Connection> = {}): NonNullable<SetupFacts['connection']> {
	return {
		label: 'Kalender',
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		keywords: [],
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
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
		expect(setupTargetOf(new URLSearchParams('einrichten=notion'))).toBeNull();
		expect(setupTargetOf(new URLSearchParams('einrichten=kalender&einrichten=gmail'))).toBeNull();
		expect(setupTargetOf(new URLSearchParams(''))).toBeNull();
	});

	it('maps connections to kinds and back', () => {
		const mail = { type: 'mail' as const, mailProvider: 'gmail' as const };
		expect(setupKindOf({ type: 'calendar', mailProvider: '' })).toBe('kalender');
		expect(setupKindOf({ type: 'telegram', mailProvider: '' })).toBe('telegram');
		expect(setupKindOf(mail)).toBe('gmail');
		expect(setupKindOf({ type: 'mail', mailProvider: 'webde' })).toBe('webde');
		expect(matchesSetupKind(mail, 'gmail')).toBe(true);
		expect(matchesSetupKind(mail, 'webde')).toBe(false);
		expect(matchesSetupKind({ type: 'calendar', mailProvider: '' }, 'telegram')).toBe(false);
		expect(setupStepKey(ID)).toBe(`byl-setup:${ID}`);
	});
});

describe('step data', () => {
	it.each(ASSISTED_KINDS)('%s has 3 to 6 steps with short labels', (kind) => {
		const steps = setupSteps(kind);
		expect(steps.length).toBeGreaterThanOrEqual(3);
		expect(steps.length).toBeLessThanOrEqual(6);
		for (const step of steps) {
			expect(step.label.split(' ').length, step.label).toBeLessThanOrEqual(2);
			expect(step.intro.split(/(?<=[.!?])\s/).length, step.id).toBeLessThanOrEqual(2);
		}
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
		expect(text).toMatch(/stop\.bat, dann start\.bat/);
		expect(text).toMatch(/Zurücksetzen/);
		expect(setupSteps('telegram')).toEqual([]);
	});
});

describe('progress from the facts of the server', () => {
	it.each([
		['without a connection', NONE, 0],
		['with a connection whose variable the app does not see', CREATED, 1],
		['once the app sees the variable', VISIBLE, 4],
		['with keywords', WITH_KEYWORDS, 5],
		['after a good run (all done: the last step)', RUN, 5]
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
		expect(setupProgress('kalender', failed)).toBe(5);
	});

	it('treats an unknown state of the variable as not seen', () => {
		expect(setupProgress('kalender', { ...VISIBLE, secretStatus: null })).toBe(1);
	});

	it('shows done, current, open and a warning for a passed step whose check is open', () => {
		expect(stepStates('kalender', CREATED, 1)).toEqual([
			'done',
			'current',
			'open',
			'open',
			'open',
			'open'
		]);
		expect(stepStates('kalender', CREATED, 4)).toEqual([
			'done',
			'done',
			'done',
			'warning',
			'current',
			'open'
		]);
		expect(stepStates('kalender', WITH_KEYWORDS, 5)).toEqual([
			'done',
			'done',
			'done',
			'done',
			'done',
			'current'
		]);
	});

	it('names the first open check before the current step', () => {
		expect(openCheckBefore('kalender', CREATED, 3)).toBeNull();
		expect(openCheckBefore('kalender', CREATED, 4)).toEqual({
			index: 3,
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		});
		expect(openCheckBefore('kalender', VISIBLE, 5)).toEqual({
			index: 4,
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
		expect(stepCheck('connect', NONE)).toEqual({
			tone: 'open',
			text: 'Noch keine Verbindung angelegt.'
		});
		expect(stepCheck('connect', CREATED)?.text).toBe('Verbindung „Kalender“ angelegt.');
		expect(stepCheck('restart', CREATED)).toEqual({
			tone: 'open',
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		});
		expect(stepCheck('restart', VISIBLE)).toEqual({
			tone: 'done',
			text: 'Die App sieht BYL_GOOGLE_CALENDAR_URL.'
		});
		expect(stepCheck('restart', { ...VISIBLE, secretStatus: null })?.text).toMatch(
			/ließ sich nicht prüfen/
		);
		expect(stepCheck('keywords', VISIBLE)).toEqual({ tone: 'warning', text: NO_KEYWORDS_WARNING });
		expect(stepCheck('keywords', WITH_KEYWORDS)?.text).toBe('1 Stichwort: todo.');
		expect(stepCheck('first-run', WITH_KEYWORDS)).toEqual({
			tone: 'open',
			text: 'Noch kein Abruf.'
		});
		expect(stepCheck('first-run', RUN)?.tone).toBe('done');
		expect(
			stepCheck('first-run', { ...RUN, connection: connection({ lastError: 'HTTP 404' }) })
		).toEqual({ tone: 'error', text: 'Letzter Abruf fehlgeschlagen: HTTP 404' });
		expect(stepCheck('address', RUN)).toBeNull();
		expect(stepCheck('variable', RUN)).toBeNull();
	});
});
