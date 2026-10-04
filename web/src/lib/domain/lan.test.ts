// Access in the home network (plan heimnetz): the answers of the routes read strictly, the address
// for other devices, when a restart is needed, and the words of the page. The rule of the addresses
// is compared with the hook module in tests/unit/web-lan.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	FIREWALL_TEXTS,
	LAN_TEXTS,
	candidateText,
	firewallDoneTitle,
	lanInvalidText,
	lanRestartNeeded,
	lanUrls,
	parseFirewallAnswer,
	parseLanInfo,
	parseLanOverview,
	sameAddresses,
	savedTitle,
	type LanInfo
} from './lan';

const INFO = {
	port: 8090,
	enabled: true,
	addresses: ['192.168.178.20', 'kaputt'],
	max: 5,
	network: true,
	candidates: [
		{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'public' },
		{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'public' },
		{ address: '8.8.8.8', kind: 'ip', adapter: 'x', category: 'private' }
	],
	states: [{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'neu' }],
	firewall: {
		state: 'missing',
		blocked: false,
		rule: 'anders',
		add: 'netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" …',
		remove: 'netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" …'
	}
};

function info(overrides: Record<string, unknown> = {}): LanInfo {
	const parsed = parseLanInfo({ lan: { ...INFO, ...overrides } });
	if (parsed === null) throw new Error('not an answer');
	return parsed;
}

describe('answers of the routes', () => {
	it('read the state of the home network strictly', () => {
		expect(info()).toEqual({
			port: 8090,
			enabled: true,
			addresses: ['192.168.178.20'],
			max: 5,
			network: true,
			candidates: [
				{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'public' },
				{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'public' }
			],
			states: [
				{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'unknown' }
			],
			firewall: {
				state: 'missing',
				blocked: false,
				rule: 'becauseyoulovejira (Heimnetz)',
				add: INFO.firewall.add,
				remove: INFO.firewall.remove
			}
		});
		for (const broken of [
			null,
			{},
			{ lan: null },
			{ lan: { ...INFO, port: '8090' } },
			{ lan: { ...INFO, firewall: 'x' } }
		]) {
			expect(parseLanInfo(broken), JSON.stringify(broken)).toBeNull();
		}
	});

	it('read the result of a change of the firewall rule, with the entry of the catalog when it did not happen', () => {
		const done = parseFirewallAnswer({
			result: { ok: true, action: 'add', outcome: 'done', report: null },
			lan: { ...INFO, firewall: { ...INFO.firewall, state: 'present' } }
		});
		expect(done?.result).toEqual({ ok: true, action: 'add', outcome: 'done', report: null });
		expect(done?.lan?.firewall.state).toBe('present');
		const declined = parseFirewallAnswer({
			result: {
				ok: false,
				action: 'add',
				outcome: 'cancelled',
				report: {
					code: 'lan-firewall-add-failed',
					level: 'error',
					exitCode: 1,
					problem:
						'Die Firewall-Regel „becauseyoulovejira (Heimnetz)“ wurde nicht angelegt: die Anfrage nach Administratorrechten wurde abgelehnt.',
					facts: [],
					cause: 'Zum Ändern der Firewall braucht Windows Administratorrechte.',
					remedy: {
						steps: ['Erneut versuchen.'],
						command: 'netsh advfirewall firewall add rule …'
					},
					log: ''
				}
			},
			lan: null
		});
		expect(declined?.result).toMatchObject({
			ok: false,
			outcome: 'cancelled',
			report: { code: 'lan-firewall-add-failed' }
		});
		expect(declined?.lan).toBeNull();
		expect(parseFirewallAnswer({ result: { ok: true, action: 'delete' } })).toBeNull();
		expect(
			parseFirewallAnswer({ result: { ok: true, action: 'remove', outcome: 'egal' } })?.result
				.outcome
		).toBe('');
	});

	it('read the home network of the overview; before the restart after the update there is none', () => {
		expect(
			parseLanOverview({ active: true, hosts: ['192.168.178.20:8090', 7], editable: true })
		).toEqual({
			active: true,
			hosts: ['192.168.178.20:8090'],
			editable: true,
			ready: true
		});
		expect(parseLanOverview(undefined)).toEqual({
			active: false,
			hosts: [],
			editable: false,
			ready: false
		});
	});
});

describe('address and restart', () => {
	const running = { active: true, hosts: ['192.168.178.20:8090'], editable: true, ready: true };
	const local = { active: false, hosts: [], editable: true, ready: true };

	it('names the addresses for other devices the server answers under, else the chosen ones', () => {
		expect(lanUrls(running, info())).toEqual(['http://192.168.178.20:8090/']);
		expect(lanUrls(local, info())).toEqual(['http://192.168.178.20:8090/']);
		expect(lanUrls(local, info({ enabled: false }))).toEqual([]);
		expect(lanUrls(local, null)).toEqual([]);
	});

	it('needs a restart while the setting and the running server differ', () => {
		expect(lanRestartNeeded(running, info())).toBe(false);
		expect(lanRestartNeeded(local, info())).toBe(true);
		expect(lanRestartNeeded(running, info({ enabled: false }))).toBe(true);
		expect(lanRestartNeeded(running, info({ addresses: ['192.168.178.21'] }))).toBe(true);
		expect(lanRestartNeeded(local, info({ enabled: false }))).toBe(false);
		expect(lanRestartNeeded({ ...local, ready: false }, info())).toBe(false);
		expect(sameAddresses(['a.local', 'b.local'], ['b.local', 'a.local'])).toBe(true);
	});
});

describe('words of the page', () => {
	it('say what an address is, what the rule does and what is unencrypted', () => {
		const [ip, name] = info().candidates;
		expect(candidateText(ip!)).toBe('Ethernet · Netzwerk Öffentlich');
		expect(candidateText(name!)).toBe('Name in der FRITZ!Box · Ethernet · Netzwerk Öffentlich');
		expect(
			candidateText({ address: 'pc.local', kind: 'name', adapter: '', category: 'private' })
		).toBe('Name im Heimnetz · Netzwerk Privat');
		expect(FIREWALL_TEXTS.missing).toMatch(/^Fehlt/);
		expect(LAN_TEXTS.firewallRule(8090)).toBe(
			'Die Regel „becauseyoulovejira (Heimnetz)“ lässt nur pocketbase.exe dieses Ordners, nur TCP-Port 8090 und nur in privaten Netzwerken durch.'
		);
		expect(LAN_TEXTS.warning).toMatch(/Passwörter und Inhalte gehen unverschlüsselt durchs WLAN/);
		expect(LAN_TEXTS.warning).toMatch(/Raspberry Pi/);
		expect(LAN_TEXTS.fritzSteps.join(' ')).toMatch(
			/Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen/
		);
		expect(savedTitle(true)).toBe('Zugriff im Heimnetz eingeschaltet');
		expect(firewallDoneTitle('remove')).toBe('Firewall-Regel entfernt');
		expect(lanInvalidText('required')).toBe('Bitte mindestens eine Adresse wählen.');
		expect(lanInvalidText('constructor')).toBe('Der Server hat die Eingabe abgelehnt.');
	});
});
