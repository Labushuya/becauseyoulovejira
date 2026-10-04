// Context of the app in this tab (KX-1, ADR-0057): the answer of the route, the capabilities for
// every combination of administrator, this machine, system and state, the note instead of commands
// and scripts, and the hints of the server without commands.

import { describe, expect, it } from 'vitest';
import {
	OUTDATED_CONTEXT,
	PENDING_CONTEXT,
	capabilitiesOf,
	contextNote,
	isContextRefusal,
	parseContext,
	unreachableHint,
	withoutCommands,
	type AppContext,
	type ContextState
} from './context';
import { HOST_PLATFORMS } from './host-platform';

const ready = (context: Partial<AppContext>): ContextState => ({
	kind: 'ready',
	context: {
		admin: true,
		local: true,
		platform: 'windows',
		scripts: true,
		localUrl: 'http://127.0.0.1:8090',
		...context
	}
});

describe('parseContext', () => {
	it('takes the answer of the route', () => {
		const answer = {
			admin: true,
			local: false,
			platform: 'windows',
			scripts: false,
			localUrl: 'http://127.0.0.1:8091'
		};
		expect(parseContext(answer)).toEqual(answer);
	});

	it.each([
		null,
		'admin',
		{},
		{ admin: 'true', local: true, platform: 'windows', scripts: true, localUrl: null },
		{ admin: true, local: true, platform: 'darwin', scripts: true, localUrl: null },
		{ admin: true, local: 1, platform: 'linux', scripts: false, localUrl: null }
	])('refuses %j', (answer) => {
		expect(parseContext(answer)).toBeNull();
	});

	it('allows the scripts only where the parts allow them', () => {
		expect(
			parseContext({
				admin: false,
				local: true,
				platform: 'windows',
				scripts: true,
				localUrl: null
			})
		).toMatchObject({ scripts: false });
		expect(
			parseContext({ admin: true, local: true, platform: 'linux', scripts: true, localUrl: null })
		).toMatchObject({ scripts: false });
	});

	it('keeps the address of the app only for the administrator and only on 127.0.0.1', () => {
		const base = { local: false, platform: 'windows', scripts: false };
		expect(
			parseContext({ ...base, admin: false, localUrl: 'http://127.0.0.1:8090' })?.localUrl
		).toBeNull();
		expect(
			parseContext({ ...base, admin: true, localUrl: 'http://evil.example' })?.localUrl
		).toBeNull();
		expect(
			parseContext({ ...base, admin: true, localUrl: 'http://127.0.0.1:8090' })?.localUrl
		).toBe('http://127.0.0.1:8090');
	});
});

describe('capabilitiesOf', () => {
	it.each([PENDING_CONTEXT, OUTDATED_CONTEXT])('is most restrictive while %j', (state) => {
		expect(capabilitiesOf(state)).toEqual({
			mode: state.kind,
			adminPages: 'hidden',
			pc: false,
			scripts: false,
			platform: null,
			localUrl: null
		});
	});

	// Every combination of administrator, this machine and system.
	const CASES: [boolean, boolean, (typeof HOST_PLATFORMS)[number]][] = [];
	for (const admin of [true, false]) {
		for (const local of [true, false]) {
			for (const platform of HOST_PLATFORMS) CASES.push([admin, local, platform]);
		}
	}

	it.each(CASES)('admin %s, local %s, %s', (admin, local, platform) => {
		const capabilities = capabilitiesOf(
			ready({
				admin,
				local,
				platform,
				scripts: admin && local && platform === 'windows',
				localUrl: admin ? 'http://127.0.0.1:8090' : null
			})
		);
		const mode = !admin ? 'member' : local ? 'pc' : 'remote';
		expect(capabilities).toEqual({
			mode,
			adminPages: mode === 'pc' ? 'full' : mode === 'remote' ? 'pc-only' : 'hidden',
			pc: mode === 'pc',
			scripts: mode === 'pc' && platform === 'windows',
			platform,
			localUrl: admin ? 'http://127.0.0.1:8090' : null
		});
	});
});

describe('contextNote', () => {
	it.each([
		// state or who, need, note
		[PENDING_CONTEXT, 'pc', 'pending'],
		[PENDING_CONTEXT, 'script', 'pending'],
		[OUTDATED_CONTEXT, 'pc', 'outdated'],
		[OUTDATED_CONTEXT, 'script', 'outdated'],
		[ready({}), 'pc', null],
		[ready({}), 'script', null],
		[ready({ platform: 'linux', scripts: false }), 'pc', null],
		[ready({ platform: 'linux', scripts: false }), 'script', 'unavailable'],
		[ready({ platform: 'container', scripts: false }), 'script', 'unavailable'],
		[ready({ local: false, scripts: false }), 'pc', 'pc-only'],
		[ready({ local: false, scripts: false }), 'script', 'pc-only'],
		[ready({ admin: false, scripts: false, localUrl: null }), 'pc', 'ask-admin'],
		[ready({ admin: false, local: false, scripts: false, localUrl: null }), 'script', 'ask-admin']
	] as const)('%j needing %s: %s', (state, need, note) => {
		expect(contextNote(capabilitiesOf(state), need)).toBe(note);
	});
});

describe('unreachableHint', () => {
	it.each([
		[ready({}), /\(start\.bat\)/],
		[ready({ local: false, scripts: false }), /auf dem PC läuft/],
		[ready({ admin: false, scripts: false, localUrl: null }), /den Verwalter fragen/],
		[ready({ platform: 'linux', scripts: false }), /^Bitte prüfen, ob becauseyoulovejira läuft/],
		[PENDING_CONTEXT, /^Bitte prüfen, ob becauseyoulovejira läuft/]
	] as const)('%j: %s', (state, text) => {
		const hint = unreachableHint(capabilitiesOf(state));
		expect(hint).toMatch(text);
		if (!capabilitiesOf(state).scripts) expect(hint).not.toMatch(/\.bat/);
	});
});

describe('isContextRefusal', () => {
	it.each([
		['loopback', true],
		['owner', true],
		['platform', true],
		['origin', false],
		['rate', false],
		[undefined, false]
	])('%s: %s', (reason, expected) => {
		expect(isContextRefusal(reason)).toBe(expected);
	});
});

describe('withoutCommands', () => {
	it('keeps a text without commands as it is', () => {
		expect(withoutCommands('Zuletzt abgerufen vor 5 Min.')).toEqual({
			text: 'Zuletzt abgerufen vor 5 Min.',
			removed: false
		});
	});

	it.each([
		[
			'Zugangsdaten fehlen: Variable BYL_X anlegen, dann die App neu starten (neu-starten.bat).',
			'Zugangsdaten fehlen: Variable BYL_X anlegen, dann die App neu starten.'
		],
		['Variable BYL_X fehlt (Variable anlegen, dann neu-starten.bat).', 'Variable BYL_X fehlt.'],
		[
			'läuft nicht. Mit einer eingeschalteten Postfach-Verbindung startet start.bat bzw. neu-starten.bat ihn mit.',
			'läuft nicht.'
		],
		[
			'Chat 42 ist nicht freigegeben. Die ID in BYL_TELEGRAM_ALLOWED aufnehmen (setx), dann neu-starten.bat.',
			'Chat 42 ist nicht freigegeben.'
		],
		['Bitte byl-control.ps1 doctor ausführen.', '']
	])('removes the command of %j', (text, expected) => {
		expect(withoutCommands(text)).toEqual({ text: expected, removed: true });
	});
});
