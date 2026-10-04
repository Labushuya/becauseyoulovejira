// Page "Einstellungen → Sicherheit" (ADR-0055 §8): the answer of the server read strictly, the rule
// of the further hosts and the words of the overview, the protocol and the refusals.

import { describe, expect, it } from 'vitest';
import { securityAnswer } from '$lib/test/security-answer';
import {
	customSessionLabel,
	denialText,
	extraHostProblem,
	invalidText,
	loginText,
	normalizeExtraHost,
	parseNotice,
	parseSecurity,
	sameHosts,
	sessionLabel,
	statusLines,
	type SecurityOverview
} from './security';

function overviewOf(overrides: Record<string, unknown> = {}): SecurityOverview {
	const overview = parseSecurity(securityAnswer(overrides));
	if (overview === null) throw new Error('test answer does not parse');
	return overview;
}

describe('parseSecurity', () => {
	it('reads the overview of the server', () => {
		const overview = overviewOf();
		expect(overview.level).toBe('normal');
		expect(overview.hosts.own).toEqual(['127.0.0.1:8090', 'localhost:8090']);
		expect(overview.session).toEqual({
			days: 5,
			seconds: 432000,
			choices: [1, 5, 14, 30],
			standard: 5
		});
		expect(overview.logins?.groups).toHaveLength(2);
		expect(overviewOf({ logins: null }).logins).toBeNull();
		expect(
			overviewOf({ session: { days: null, seconds: 3600, choices: [1, 5, 14, 30], standard: 5 } })
				.session.days
		).toBeNull();
	});

	it('refuses anything that is not the overview', () => {
		for (const broken of [
			null,
			[],
			{ ...securityAnswer(), level: 'egal' },
			{ ...securityAnswer(), hosts: { own: 'x' } },
			{ ...securityAnswer(), session: { days: 5 } },
			{
				...securityAnswer(),
				logins: { days: 30, total: 1, lastDay: 1, groups: [{ area: 'other' }] }
			},
			{ ...securityAnswer(), secrets: 'BYL_X' }
		]) {
			expect(parseSecurity(broken), JSON.stringify(broken)).toBeNull();
		}
	});

	it('reads the notice', () => {
		expect(parseNotice({ attention: true, count: 12, last: '2026-10-03 09:05:00.000Z' })).toEqual({
			attention: true,
			count: 12,
			last: '2026-10-03 09:05:00.000Z'
		});
		expect(parseNotice({ attention: false, count: 0, last: null })?.last).toBeNull();
		expect(parseNotice({ attention: 'ja', count: 1 })).toBeNull();
	});
});

describe('further hosts', () => {
	it('takes DNS names with a dot and an optional port, lower case', () => {
		expect(normalizeExtraHost(' Rechner.Tailnet.ts.net ')).toBe('rechner.tailnet.ts.net');
		expect(normalizeExtraHost('pi.local:8443')).toBe('pi.local:8443');
		for (const value of [
			'localhost',
			'127.0.0.1',
			'https://a.example.org',
			'a.example.org:70000',
			'',
			42
		]) {
			expect(normalizeExtraHost(value), String(value)).toBe('');
		}
	});

	it('says what is wrong with an entry before it is added', () => {
		expect(extraHostProblem('', [])).toBe('Bitte eine Adresse eingeben.');
		expect(extraHostProblem('localhost', [])).toMatch(/^Nur ein Name mit Punkt/);
		expect(extraHostProblem('A.example.org', ['a.example.org'])).toBe(
			'Diese Adresse steht schon in der Liste.'
		);
		const full = Array.from({ length: 10 }, (_, index) => `h${index}.example.org`);
		expect(extraHostProblem('neu.example.org', full)).toBe('Höchstens 10 zusätzliche Adressen.');
		expect(extraHostProblem('neu.example.org', [])).toBe('');
		expect(sameHosts(['a.example.org', 'b.example.org'], ['b.example.org', 'a.example.org'])).toBe(
			true
		);
		expect(sameHosts(['a.example.org'], [])).toBe(false);
	});
});

describe('overview of the page', () => {
	it('names every point with a lozenge, one sentence and what it means, red never', () => {
		const lines = statusLines(overviewOf());
		expect(lines.map((line) => line.title)).toEqual([
			'Schutz vor Rateversuchen',
			'Nur eigene Oberfläche (CORS)',
			'Host-Schutz',
			'Zugriff im Heimnetz',
			'Admin-Oberfläche',
			'Sicherungen verschlüsselt',
			'Zugangsdaten',
			'Zugangsschlüssel des eigenen Eingangs',
			'Browser-Erweiterung'
		]);
		expect(lines.map((line) => line.state)).toEqual([
			'Aktiv (Normal)',
			'Aktiv',
			'Aktiv',
			'Aus',
			'Nur dieser Rechner',
			'Verschlüsselt',
			'In Umgebungsvariablen',
			'2 Schlüssel',
			'Gebaut'
		]);
		for (const line of lines) {
			expect(line.tone, line.id).not.toBe('danger');
			expect(line.meaning.length, line.id).toBeGreaterThan(40);
		}
		expect(lines[2]?.text).toBe('Die App antwortet nur unter 127.0.0.1:8090, localhost:8090.');
		expect(lines[3]?.text).toBe('Die App ist nur auf diesem Rechner erreichbar.');
		expect(lines[5]?.text).toBe(
			'3 verschlüsselte Sicherungen im Zielverzeichnis, die neueste 03.10.2026 10:00.'
		);
		expect(lines[6]?.text).toContain('BYL_INGEST_TOKEN, BYL_WEBDE_PASSWORD');
		expect(lines[7]?.text).toBe('Zuletzt benutzt 02.10.2026 20:30.');
	});

	it('names the access in the home network with its address, unencrypted, as a warning without red', () => {
		const lines = statusLines(
			overviewOf({
				lan: { active: true, hosts: ['192.168.178.20:8090'], editable: true }
			})
		);
		expect(lines[2]?.text).toBe(
			'Die App antwortet nur unter 127.0.0.1:8090, localhost:8090 und 192.168.178.20:8090.'
		);
		expect(lines[3]).toMatchObject({
			id: 'lan',
			state: 'An (unverschlüsselt)',
			tone: 'neutral',
			icon: 'warning',
			text: 'Andere Geräte erreichen die App unter http://192.168.178.20:8090/.'
		});
		// Before the restart after the update the server names no home network.
		const before = securityAnswer();
		delete before.lan;
		expect(parseSecurity(before)?.lan).toEqual({
			active: false,
			hosts: [],
			editable: false,
			ready: false
		});
	});

	it('warns calmly when something is off, and says what helps', () => {
		const lines = statusLines(
			overviewOf({
				level: 'off',
				cors: { restricted: false },
				hosts: {
					own: ['127.0.0.1:8090', 'localhost:8090'],
					active: ['rechner.tailnet.ts.net'],
					configured: [],
					editable: false,
					max: 10
				},
				admin: { ips: [], loopbackOnly: false },
				backup: { available: true, target: false, reachable: null, sealed: 0, newest: null },
				secrets: [],
				keys: { count: 0, lastUsedAt: null },
				extension: { built: false, version: '' }
			})
		);
		expect(lines.map((line) => [line.state, line.tone])).toEqual([
			['Aus', 'neutral'],
			['Neustart nötig', 'neutral'],
			['Aktiv', 'brand'],
			['Aus', 'brand'],
			['Ohne Beschränkung', 'neutral'],
			['Kein Zielverzeichnis', 'neutral'],
			['Keine', 'muted'],
			['Keine', 'muted'],
			['Nicht gebaut', 'muted']
		]);
		expect(lines[2]?.text).toBe(
			'Die App antwortet nur unter 127.0.0.1:8090, localhost:8090 und rechner.tailnet.ts.net.'
		);
		expect(statusLines(overviewOf({ level: 'custom' }))[0]?.state).toBe('Eigene Einstellung');
		expect(statusLines(overviewOf({ level: 'strict' }))[0]?.state).toBe('Aktiv (Streng)');
		const unavailable = {
			available: false,
			target: false,
			reachable: null,
			sealed: 0,
			newest: null
		};
		expect(statusLines(overviewOf({ backup: unavailable }))[5]?.state).toBe('Nicht verfügbar');
	});

	it('words the protocol of failed sign-ins without a password', () => {
		const [own, admin] = overviewOf().logins?.groups ?? [];
		expect(loginText(own!)).toBe(
			'anna@example.com · App-Konto · aus der App über 127.0.0.1:8090 · 3 Versuche · zuletzt 03.10.2026 11:05'
		);
		expect(loginText(admin!)).toBe(
			'admin@example.com (kein solches Konto) · Admin-Konto (Verwaltung) · von einer anderen Webseite über localhost:8090 · 1 Versuch · zuletzt 20.09.2026 12:00'
		);
	});

	it('names the durations of a sign-in and refusals in plain words', () => {
		expect(sessionLabel(1, 5)).toBe('1 Tag');
		expect(sessionLabel(5, 5)).toBe('5 Tage (Standard)');
		expect(customSessionLabel(3600)).toBe('Eigene Einstellung: 1 Stunde');
		expect(customSessionLabel(6 * 3600)).toBe('Eigene Einstellung: 6 Stunden');
		expect(customSessionLabel(7 * 86400)).toBe('Eigene Einstellung: 7 Tage');
		expect(denialText('owner').title).toBe('Nur für den Verwalter der App');
		expect(denialText('unavailable').text).toMatch(/nur die App unter Windows/);
		expect(invalidText('too-many')).toBe('Höchstens 10 zusätzliche Adressen.');
		expect(invalidText('constructor')).toBe('Der Server hat die Eingabe abgelehnt.');
	});
});
