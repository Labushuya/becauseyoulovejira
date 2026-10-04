// Pure rules of the access in the home network (plan docs/plan/heimnetz.md, ADR-0055 addendum,
// app/pb_hooks/lib/lan-rules.js): the addresses other devices may use, the inputs of the routes,
// what the running server allows and the strict reading of the answers of byl-control.ps1.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const lan = loadHookLib('lan-rules.js');
const security = loadHookLib('security-rules.js');
const system = loadHookLib('system-rules.js');

describe('addresses of the home network', () => {
	it('are private IPv4 addresses in the form of a browser, or a name of the computer with a local ending', () => {
		const valid = ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.0.1', '192.168.0.1', '192.168.178.20'];
		for (const address of valid) expect(lan.isPrivateIPv4(address), address).toBe(true);
		const notPrivate = ['172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.1.1', '0.0.0.0', '8.8.8.8'];
		for (const address of notPrivate) expect(lan.isPrivateIPv4(address), address).toBe(false);
		// Leading zeros, octal and short forms never come from a browser (Host header).
		for (const address of ['010.0.0.1', '192.168.178.020', '192.168.178', '0x0a.0.0.1', '10.0.0.256', ' 10.0.0.1', '', null, 167772161]) {
			expect(lan.isPrivateIPv4(address), String(address)).toBe(false);
		}
		expect(lan.normalizeLanAddress(' 192.168.178.20 ')).toBe('192.168.178.20');
		expect(lan.normalizeLanAddress('Tower2.Fritz.Box')).toBe('tower2.fritz.box');
		for (const name of ['pc.local', 'nas.home.arpa', 'pc.lan', 'pc.internal', 'a.b.fritz.box']) {
			expect(lan.normalizeLanAddress(name), name).toBe(name);
		}
		for (const value of ['fritz.box', 'pc.example.org', 'pc.fritz.box:8090', 'http://pc.fritz.box', 'localhost', '-pc.local', 'pc..local', 'räch.local', '192.168.178.20:8090', 42, undefined]) {
			expect(lan.normalizeLanAddress(value), String(value)).toBe('');
		}
		expect(lan.LAN_MAX).toBe(5);
		expect(lan.RULE_NAME).toBe('becauseyoulovejira (Heimnetz)');
	});
});

describe('inputs of the routes', () => {
	it('take a switch and at most five addresses of the home network; switching on needs one', () => {
		expect(lan.lanInput({ enabled: true, addresses: ['192.168.178.20', 'Tower2.fritz.box', '192.168.178.20'] })).toEqual({
			enabled: true,
			addresses: ['192.168.178.20', 'tower2.fritz.box']
		});
		expect(lan.lanInput({ enabled: false, addresses: [] })).toEqual({ enabled: false, addresses: [] });
		expect(lan.lanInput({ enabled: false, addresses: ['10.0.0.5'] })).toEqual({ enabled: false, addresses: ['10.0.0.5'] });
		expect(lan.lanInput({ enabled: true, addresses: [] })).toEqual({ problem: 'required', invalid: [] });
		expect(lan.lanInput({ enabled: true, addresses: ['8.8.8.8', 'pc.local', 7] })).toEqual({ problem: 'invalid', invalid: ['8.8.8.8', '7'] });
		expect(lan.lanInput({ enabled: true, addresses: ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6'] })).toEqual({
			problem: 'too-many',
			invalid: []
		});
		for (const body of [null, [], { enabled: 'true', addresses: [] }, { enabled: true }, { addresses: ['10.0.0.1'] }]) {
			expect(lan.lanInput(body), JSON.stringify(body)).toEqual({ problem: 'format', invalid: [] });
		}
		expect(lan.firewallInput({ action: 'add' })).toEqual({ action: 'add' });
		expect(lan.firewallInput({ action: 'remove' })).toEqual({ action: 'remove' });
		for (const body of [null, {}, { action: 'ADD' }, { action: 'delete' }, { action: ['add'] }]) {
			expect(lan.firewallInput(body), JSON.stringify(body)).toEqual({ problem: 'action' });
		}
	});
});

describe('what the running server allows', () => {
	const origins = 'http://127.0.0.1:8090,http://localhost:8090,http://192.168.178.20:8090,http://tower2.fritz.box:8090,https://rechner.tailnet.ts.net';

	it('binds to every address only with --http=0.0.0.0', () => {
		expect(lan.lanBound('0.0.0.0:8090')).toBe(true);
		for (const flag of ['127.0.0.1:8090', '192.168.178.20:8090', '[::]:8090', '0.0.0.0', '', undefined]) {
			expect(lan.lanBound(flag), String(flag)).toBe(false);
		}
	});

	it('answers in the home network under the hosts of its http origins besides this machine', () => {
		expect(lan.activeLanHosts(origins)).toEqual(['192.168.178.20:8090', 'tower2.fritz.box:8090']);
		expect(lan.activeLanHosts('http://127.0.0.1:8090,http://localhost:8090')).toEqual([]);
		expect(lan.activeLanHosts('')).toEqual([]);
		expect(lan.lanUrl('192.168.178.20:8090')).toBe('http://192.168.178.20:8090/');
		// The page keeps them apart from the further hosts (https), the guard takes both.
		expect(security.activeExtraHosts(origins, 8090)).toEqual(['rechner.tailnet.ts.net']);
		expect(security.originHosts(origins)).toEqual([
			'127.0.0.1:8090',
			'localhost:8090',
			'192.168.178.20:8090',
			'tower2.fritz.box:8090',
			'rechner.tailnet.ts.net'
		]);
	});

	it('keeps every check of "this machine" on the address of the connection, not on a name', () => {
		// The Host of the home network is allowed by the guard, but never as this machine.
		expect(system.isOwnHost('192.168.178.20:8090', 8090)).toBe(false);
		expect(system.isLocal(false, false, [])).toBe(false);
		expect(system.isLocal(true, true, ['192.168.178.30'])).toBe(false);
		expect(system.isSameOrigin('POST', '127.0.0.1:8090', 'http://192.168.178.20:8090', 'same-origin')).toBe(false);
	});
});

describe('answers of byl-control.ps1', () => {
	const INFO = {
		ok: true,
		port: 8090,
		enabled: true,
		addresses: ['192.168.178.20', 'kaputt'],
		max: 5,
		network: true,
		candidates: [
			{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'public' },
			{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'neu' },
			{ address: '8.8.8.8', kind: 'ip', adapter: 'x', category: 'private' },
			{ address: '10.0.0.7', kind: 'other', adapter: 'WLAN', category: 'private' }
		],
		states: [
			{ address: '192.168.178.20', present: true, adapter: 'Ethernet', index: 8, category: 'public' },
			{ address: 'tower2.fritz.box', present: null, adapter: '', index: null, category: 'unknown' },
			'x'
		],
		firewall: {
			state: 'missing',
			blocked: false,
			rule: 'anders',
			program: 'C:\\app\\pocketbase.exe',
			add: 'netsh advfirewall firewall add rule …',
			remove: 'netsh advfirewall firewall delete rule …'
		},
		extra: 'weg'
	};

	it('pass the state of the home network on, strictly read', () => {
		expect(lan.lanInfoView(INFO)).toEqual({
			port: 8090,
			enabled: true,
			addresses: ['192.168.178.20'],
			max: 5,
			network: true,
			candidates: [
				{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'public' },
				{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'unknown' }
			],
			states: [
				{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'public' },
				{ address: 'tower2.fritz.box', present: null, adapter: '', category: 'unknown' }
			],
			firewall: {
				state: 'missing',
				blocked: false,
				rule: 'becauseyoulovejira (Heimnetz)',
				program: 'C:\\app\\pocketbase.exe',
				add: 'netsh advfirewall firewall add rule …',
				remove: 'netsh advfirewall firewall delete rule …'
			}
		});
		expect(lan.lanInfoView({ ...INFO, firewall: { ...INFO.firewall, state: 'kaputt' } }).firewall.state).toBe('unknown');
		for (const raw of [null, { ...INFO, ok: false }, { ...INFO, port: 'x' }, { ...INFO, firewall: null }]) {
			expect(lan.lanInfoView(raw)).toBeNull();
		}
	});

	it('pass the home network of status -Json on, null from a script of before', () => {
		expect(
			lan.lanStatusView({
				enabled: true,
				addresses: ['192.168.178.20'],
				bound: true,
				hosts: ['192.168.178.20:8090', 7],
				firewall: 'present',
				blocked: false,
				networks: [{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'private' }]
			})
		).toEqual({
			enabled: true,
			addresses: ['192.168.178.20'],
			bound: true,
			hosts: ['192.168.178.20:8090'],
			urls: ['http://192.168.178.20:8090/'],
			firewall: 'present',
			blocked: false,
			networks: [{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'private' }]
		});
		expect(lan.lanStatusView({ firewall: null }).firewall).toBeNull();
		expect(lan.lanStatusView(undefined)).toBeNull();
		expect(lan.outcomeOf('cancelled')).toBe('cancelled');
		expect(lan.outcomeOf('kaputt')).toBe('');
	});
});
