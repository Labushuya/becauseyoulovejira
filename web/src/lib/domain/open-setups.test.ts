// Open setups (KE-1, ADR-0076): the matrix of kind × facts behind the cards, the overview, the mark
// and the hint; the agreement with the assistant (setupProgress, setupComplete) and the card
// (channelHealth): never "Verbunden" while a setup is open; the texts of M1 and M3; the list, the
// fingerprint and "Erste Schritte" (E4).

import { describe, expect, it } from 'vitest';
import { channelHealth } from './channel-health';
import { setupComplete, setupProgress, type SetupKind, type StoredSecrets } from './channel-setup';
import type { Connection, SecretStatus } from './connections';
import { EMPTY_GITHUB_SETTINGS } from './github';
import {
	OPEN_SETUP_TEXTS,
	anySetupDone,
	continuesAtPc,
	namesText,
	openSetupHint,
	openSetupLine,
	openSetupOf,
	openSetupsFingerprint,
	openSetupsOf,
	ownInboxOpen,
	whatsAppWebOpen,
	type OpenSetupReason
} from './open-setups';

const OK = '2026-11-01 08:00:00.000Z';
const CHAT = 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).';
const REPO = {
	repo: 'octo-org/roadmap',
	paths: ['CHANGELOG*'],
	events: { files: true, pulls: true, releases: true },
	target: null
};
const FOLDER = {
	path: 'C:\\Daten\\Projekte',
	subfolders: true,
	types: [],
	exclude: [],
	target: null,
	reportChanges: true
};

function connection(id: string, overrides: Partial<Connection> = {}): Connection {
	return {
		id,
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: [],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: OK,
		updated: OK,
		...overrides
	};
}

/** A connection of each kind whose setup is done: a good run, the repository, the folder. */
const DONE: Readonly<Record<Exclude<SetupKind, 'proton' | 'whatsapp-web'>, Connection>> = {
	kalender: connection('conn0000000kal1', { lastRunAt: OK, lastOkAt: OK, keywords: ['todo'] }),
	telegram: connection('conn0000000tel1', {
		type: 'telegram',
		label: 'Bot',
		secretEnv: 'BYL_TELEGRAM_TOKEN',
		allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
		lastRunAt: OK,
		lastOkAt: OK,
		keywords: ['todo']
	}),
	webde: connection('conn0000000web1', {
		type: 'mail',
		mailProvider: 'webde',
		label: 'Web.de',
		secretEnv: 'BYL_WEBDE_PASSWORD',
		lastRunAt: OK,
		lastOkAt: OK
	}),
	gmail: connection('conn0000000gml1', {
		type: 'mail',
		mailProvider: 'gmail',
		label: 'Gmail',
		secretEnv: 'BYL_GMAIL_PASSWORD',
		lastRunAt: OK,
		lastOkAt: OK
	}),
	notion: connection('conn0000000not1', {
		type: 'notion',
		label: 'Notion',
		secretEnv: 'BYL_NOTION_TOKEN',
		lastRunAt: OK,
		lastOkAt: OK
	}),
	github: connection('conn0000000git1', {
		type: 'github',
		label: 'GitHub',
		secretEnv: 'BYL_GITHUB_TOKEN',
		github: { ...EMPTY_GITHUB_SETTINGS, repos: [REPO] },
		lastRunAt: OK,
		lastOkAt: OK
	}),
	ordner: connection('conn0000000ord1', {
		type: 'folder',
		label: 'Projekte',
		secretEnv: '',
		folders: { interval: 5, folders: [FOLDER] },
		lastRunAt: OK,
		lastOkAt: OK
	})
};

const KINDS = Object.keys(DONE) as (keyof typeof DONE)[];
const SECRETFUL = KINDS.filter((kind) => kind !== 'ordner');

function seen(kind: SetupKind): SecretStatus | null {
	if (kind === 'ordner') return null;
	return { secret: true, allowlist: kind === 'telegram' ? true : null };
}
function unseen(kind: SetupKind): SecretStatus {
	return { secret: false, allowlist: kind === 'telegram' ? false : null };
}

interface Case {
	name: string;
	kind: keyof typeof DONE;
	connection: Connection;
	status: SecretStatus | null;
	stored?: StoredSecrets | null;
	expected: OpenSetupReason | null;
}

/** The matrix: every kind with the facts of the task KE-1 (E1). */
const CASES: Case[] = [
	...KINDS.map((kind) => ({
		name: `${kind}: done`,
		kind,
		connection: DONE[kind],
		status: seen(kind),
		expected: null
	})),
	// Just created: nothing ran yet.
	...KINDS.map((kind): Case => {
		const fresh = { ...DONE[kind], lastRunAt: null, lastOkAt: null };
		const expected: Record<keyof typeof DONE, OpenSetupReason> = {
			kalender: 'first-run',
			telegram: 'chat',
			webde: 'first-run',
			gmail: 'first-run',
			notion: 'check',
			github: 'check',
			ordner: 'first-run'
		};
		return {
			name: `${kind}: created, no run yet`,
			kind,
			connection: fresh,
			status: seen(kind),
			expected: expected[kind]
		};
	}),
	// The variable is missing, known on the PC, waiting for the restart, unknown (phone).
	...SECRETFUL.filter((kind) => kind !== 'github').flatMap((kind): Case[] => [
		{
			name: `${kind}: variable missing on the PC`,
			kind,
			connection: DONE[kind],
			status: unseen(kind),
			stored: { secret: false, allowlist: kind === 'telegram' ? false : null },
			expected: 'secret-missing'
		},
		{
			name: `${kind}: waits for the restart (known at the PC)`,
			kind,
			connection: DONE[kind],
			status: unseen(kind),
			stored: { secret: true, allowlist: kind === 'telegram' ? true : null },
			expected: 'secret-restart'
		},
		{
			name: `${kind}: variable not seen, unknown on this device`,
			kind,
			connection: DONE[kind],
			status: unseen(kind),
			stored: null,
			expected: 'secret-unknown'
		}
	]),
	{
		name: 'telegram: chat not allowed yet',
		kind: 'telegram',
		connection: { ...DONE.telegram, lastHint: CHAT },
		status: seen('telegram'),
		expected: 'chat'
	},
	{
		name: 'telegram: run without keyword holds nothing open',
		kind: 'telegram',
		connection: { ...DONE.telegram, keywords: [] },
		status: seen('telegram'),
		expected: null
	},
	{
		name: 'kalender: first run failed',
		kind: 'kalender',
		connection: { ...DONE.kalender, lastOkAt: null, lastError: 'HTTP 404' },
		status: seen('kalender'),
		expected: 'first-run-failed'
	},
	{
		name: 'webde: first run refused',
		kind: 'webde',
		connection: { ...DONE.webde, lastOkAt: null, lastError: 'Anmeldung bei Web.de abgelehnt.' },
		status: seen('webde'),
		expected: 'first-run-failed'
	},
	{
		name: 'notion: check failed',
		kind: 'notion',
		connection: { ...DONE.notion, lastOkAt: null, lastError: 'Notion lehnt den Token ab (401).' },
		status: seen('notion'),
		expected: 'check-failed'
	},
	{
		name: 'notion: nothing shared yet',
		kind: 'notion',
		connection: { ...DONE.notion, lastHint: 'Die Integration sieht noch keine Seite.' },
		status: seen('notion'),
		expected: 'share'
	},
	...KINDS.map((kind) => ({
		name: `${kind}: error after an earlier good run is "Fehler", no open setup`,
		kind,
		connection: { ...DONE[kind], lastError: 'Zeitüberschreitung.' },
		status: seen(kind),
		expected: null
	})),
	{
		name: 'kalender: keywords never hold it open',
		kind: 'kalender',
		connection: { ...DONE.kalender, keywords: [] },
		status: seen('kalender'),
		expected: null
	},
	{
		name: 'github: without its token',
		kind: 'github',
		connection: DONE.github,
		status: unseen('github'),
		expected: null
	},
	{
		name: 'github: a hint of the last run (rate limit) is no open step',
		kind: 'github',
		connection: { ...DONE.github, lastHint: 'Anfragelimit von GitHub erreicht.' },
		status: seen('github'),
		expected: null
	},
	{
		name: 'github: without a repository',
		kind: 'github',
		connection: { ...DONE.github, github: EMPTY_GITHUB_SETTINGS },
		status: seen('github'),
		expected: 'repository'
	},
	{
		name: 'github: "Alle meine Repositorys" without an entered one',
		kind: 'github',
		connection: { ...DONE.github, github: { ...EMPTY_GITHUB_SETTINGS, auto: true } },
		status: seen('github'),
		expected: null
	},
	{
		name: 'ordner: without a folder',
		kind: 'ordner',
		connection: { ...DONE.ordner, folders: { interval: 5, folders: [] } },
		status: null,
		expected: 'folder'
	},
	...KINDS.map((kind) => ({
		name: `${kind}: paused, even with nothing done`,
		kind,
		connection: { ...DONE[kind], enabled: false, lastRunAt: null, lastOkAt: null },
		status: kind === 'ordner' ? null : unseen(kind),
		expected: null
	}))
];

describe('open setups: kind × facts (KE-1, E1)', () => {
	it.each(CASES)('$name', ({ kind, connection: facts, status, stored, expected }) => {
		const open = openSetupOf(kind, { connection: facts, secretStatus: status, stored });
		expect(open?.reason ?? null).toBe(expected);
	});

	it('counts an unknown state of the variables (failed request) as seen', () => {
		expect(openSetupOf('kalender', { connection: DONE.kalender, secretStatus: null })).toBeNull();
		expect(
			openSetupOf('kalender', {
				connection: { ...DONE.kalender, lastRunAt: null, lastOkAt: null },
				secretStatus: null
			})?.reason
		).toBe('first-run');
	});

	it('names the open step with its place and the check line of the assistant', () => {
		const fresh = { ...DONE.kalender, lastRunAt: null, lastOkAt: null };
		expect(openSetupOf('kalender', { connection: fresh, secretStatus: seen('kalender') })).toEqual({
			reason: 'first-run',
			step: { index: 6, total: 7, id: 'first-run', label: 'Erster Abruf' },
			pcOnly: false,
			check: { tone: 'open', text: 'Noch kein Abruf.' }
		});
		const waiting = openSetupOf('kalender', {
			connection: DONE.kalender,
			secretStatus: unseen('kalender'),
			stored: { secret: true, allowlist: null }
		});
		expect(waiting).toMatchObject({
			reason: 'secret-restart',
			step: { index: 4, id: 'restart', label: 'Neu starten' },
			pcOnly: true,
			check: null
		});
		// The chat of Telegram needs the PC too (its variable of the allowed IDs).
		expect(
			openSetupOf('telegram', {
				connection: { ...DONE.telegram, lastHint: CHAT },
				secretStatus: seen('telegram')
			})?.pcOnly
		).toBe(true);
	});
});

describe('agreement of assistant, card and overview (KE-1, M2)', () => {
	it.each(CASES)('$name', ({ kind, connection: facts, status, stored }) => {
		const setupFacts = { connection: facts, secretStatus: status, stored: stored ?? null };
		const open = openSetupOf(kind, setupFacts);
		const health = channelHealth(facts, status, false, null, { stored: stored ?? null });
		if (open !== null) {
			// Open: never "Verbunden", the assistant is not complete and opens at that very step.
			expect(health.state).not.toBe('ok');
			expect(health.label).not.toBe('Verbunden');
			expect(setupComplete(kind, setupFacts)).toBe(false);
			expect(setupProgress(kind, setupFacts)).toBe(open.step?.index);
		} else {
			expect(health.state).not.toBe('open');
			expect(health.state).not.toBe('unset');
		}
		if (open === null && facts.enabled && facts.lastError === '') {
			expect(setupComplete(kind, setupFacts)).toBe(true);
		}
	});
});

describe('own inbox and WhatsApp Web (KE-1, E1)', () => {
	it('counts the own inbox only once a key exists, as long as no program used one', () => {
		expect(ownInboxOpen(null)).toBeNull();
		expect(ownInboxOpen([])).toBeNull();
		expect(ownInboxOpen([{ lastUsedAt: null }])).toMatchObject({
			reason: 'key-unused',
			step: null
		});
		expect(ownInboxOpen([{ lastUsedAt: null }, { lastUsedAt: OK }])).toBeNull();
	});

	it('counts WhatsApp Web only with a key and without the built extension', () => {
		expect(whatsAppWebOpen(0, false)).toBeNull();
		expect(whatsAppWebOpen(null, false)).toBeNull();
		expect(whatsAppWebOpen(1, true)).toBeNull();
		expect(whatsAppWebOpen(1, null)).toBeNull();
		expect(whatsAppWebOpen(1, false)).toEqual({
			reason: 'extension',
			step: { index: 1, total: 6, id: 'load', label: 'Erweiterung laden' },
			pcOnly: true,
			check: null
		});
	});
});

describe('texts (KE-1, M1 and M3)', () => {
	const unknown = openSetupOf('kalender', {
		connection: DONE.kalender,
		secretStatus: unseen('kalender')
	});
	const waiting = openSetupOf('kalender', {
		connection: DONE.kalender,
		secretStatus: unseen('kalender'),
		stored: { secret: true, allowlist: null }
	});
	const missing = openSetupOf('kalender', {
		connection: DONE.kalender,
		secretStatus: unseen('kalender'),
		stored: { secret: false, allowlist: null }
	});

	it('never says "fehlt" for a value known to be set, never "wartet" for one not known', () => {
		if (unknown === null || waiting === null || missing === null) throw new Error('open');
		const status = unseen('kalender');
		const waits = openSetupHint(waiting, DONE.kalender, status, false);
		expect(waits.text).toMatch(/^Wartet auf Neustart/);
		expect(waits.text).not.toMatch(/fehl/);
		const pc = openSetupHint(unknown, DONE.kalender, status, false);
		expect(pc.text).toBe(
			'Zugangsdaten fehlen oder warten auf Neustart: Die App sieht BYL_GOOGLE_CALENDAR_URL noch nicht.'
		);
		const phone = openSetupHint(unknown, DONE.kalender, status, true);
		expect(phone.text).toBe(
			'Zugangsdaten fehlen oder warten auf Neustart – am PC prüfen (BYL_GOOGLE_CALENDAR_URL).'
		);
		expect(openSetupHint(missing, DONE.kalender, status, false).text).toMatch(
			/^Zugangsdaten fehlen: Variable BYL_GOOGLE_CALENDAR_URL anlegen/
		);
	});

	it('says the step of the overview and "am PC fortsetzen" only on another device and for a step of the PC', () => {
		if (unknown === null || waiting === null) throw new Error('open');
		expect(openSetupLine({ kind: 'kalender', open: waiting })).toBe(
			'Schritt 5 von 7: Wartet auf Neustart'
		);
		expect(openSetupLine({ kind: 'kalender', open: unknown })).toBe(
			'Schritt 3 von 7: Zugangsdaten fehlen oder warten auf Neustart'
		);
		expect(continuesAtPc(unknown, true)).toBe(true);
		expect(continuesAtPc(unknown, false)).toBe(false);
		const first = openSetupOf('kalender', {
			connection: { ...DONE.kalender, lastRunAt: null, lastOkAt: null },
			secretStatus: seen('kalender')
		});
		if (first === null) throw new Error('open');
		expect(continuesAtPc(first, true)).toBe(false);
		const own = ownInboxOpen([{ lastUsedAt: null }]);
		if (own === null) throw new Error('open');
		expect(openSetupLine({ kind: null, open: own })).toBe(
			'Noch kein Programm hat einen Schlüssel benutzt'
		);
	});

	it('counts in German and names at most three channels', () => {
		expect(OPEN_SETUP_TEXTS.count(1)).toBe('1 Einrichtung offen');
		expect(OPEN_SETUP_TEXTS.count(3)).toBe('3 Einrichtungen offen');
		expect(OPEN_SETUP_TEXTS.flagTitle(1)).toBe('1 Einrichtung ist offen.');
		expect(OPEN_SETUP_TEXTS.flagTitle(2)).toBe('2 Einrichtungen sind offen.');
		expect(namesText(['Kalender'])).toBe('„Kalender“');
		expect(namesText(['Kalender', 'Bot'])).toBe('„Kalender“ und „Bot“');
		expect(namesText(['A', 'B', 'C'])).toBe('„A“, „B“ und „C“');
		expect(namesText(['A', 'B', 'C', 'D', 'E'])).toBe('„A“, „B“, „C“ und 2 weitere');
	});
});

describe('the list, its fingerprint and "Erste Schritte"', () => {
	const fresh = { ...DONE.kalender, id: 'conn0000000kal2', lastRunAt: null, lastOkAt: null };
	const bot = DONE.telegram;
	const source = {
		connections: [fresh, bot, DONE.github],
		status: (id: string) => (id === bot.id ? unseen('telegram') : seen('kalender')),
		keys: [{ lastUsedAt: null }],
		extensionBuilt: false
	};

	it('lists the open setups in the order of the page: connections, own inbox, WhatsApp Web', () => {
		const entries = openSetupsOf(source);
		expect(entries.map((entry) => [entry.key, entry.open.reason, entry.target])).toEqual([
			['conn0000000kal2', 'first-run', { kind: 'kalender', connectionId: 'conn0000000kal2' }],
			['conn0000000tel1', 'secret-unknown', { kind: 'telegram', connectionId: 'conn0000000tel1' }],
			['eigener-eingang', 'key-unused', 'own-inbox'],
			['whatsapp-web', 'extension', { kind: 'whatsapp-web', connectionId: null }]
		]);
		expect(openSetupsOf({ ...source, keys: [], extensionBuilt: false }).length).toBe(2);
	});

	it('keeps the fingerprint when only the knowledge of the PC differs, and changes it with the state', () => {
		const phone = openSetupsOf(source);
		const pc = openSetupsOf({
			...source,
			stored: (connection: Connection) =>
				connection.id === bot.id ? { secret: true, allowlist: true } : null
		});
		expect(pc[1]?.open.reason).toBe('secret-restart');
		const account = 'u0000000000000a';
		expect(openSetupsFingerprint(account, pc)).toBe(openSetupsFingerprint(account, phone));
		expect(openSetupsFingerprint(account, phone)).toBe(
			'u0000000000000a|conn0000000kal2:first-run,conn0000000tel1:secret,eigener-eingang:key-unused,whatsapp-web:extension'
		);
		// Another account, another setup, or another open step is another state.
		expect(openSetupsFingerprint('u0000000000000b', phone)).not.toBe(
			openSetupsFingerprint(account, phone)
		);
		const failed = openSetupsOf({
			...source,
			connections: [{ ...fresh, lastError: 'HTTP 404' }, bot, DONE.github]
		});
		expect(openSetupsFingerprint(account, failed)).not.toBe(openSetupsFingerprint(account, phone));
		expect(openSetupsFingerprint(account, phone.slice(1))).not.toBe(
			openSetupsFingerprint(account, phone)
		);
	});

	it('marks "Einen Kanal einrichten" only once a setup is done (E4)', () => {
		const base = { connections: [fresh], status: () => seen('kalender'), keys: null };
		expect(anySetupDone(base)).toBe(false);
		expect(anySetupDone({ ...base, keys: [{ lastUsedAt: null }] })).toBe(false);
		expect(anySetupDone({ ...base, keys: [{ lastUsedAt: OK }] })).toBe(true);
		expect(anySetupDone({ ...base, connections: [fresh, DONE.kalender] })).toBe(true);
		// A done connection that is paused counts; one that only waits for the restart does not.
		expect(anySetupDone({ ...base, connections: [{ ...DONE.kalender, enabled: false }] })).toBe(
			true
		);
		expect(
			anySetupDone({
				connections: [DONE.kalender],
				status: () => unseen('kalender'),
				stored: () => ({ secret: true, allowlist: null }),
				keys: null
			})
		).toBe(false);
	});
});
