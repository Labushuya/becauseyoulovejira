// The access in the home network of the web app (web/src/lib/domain/lan.ts) against the hook module
// (app/pb_hooks/lib/lan-rules.js, plan heimnetz): the same rule for the addresses and their number,
// the same name of the firewall rule, the same states and categories, and a text of a 400 for every
// problem the routes name. The rule of byl-functions.ps1 is compared in lan-control-logic.test.mjs.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	FIREWALL_ACTIONS,
	FIREWALL_OUTCOMES,
	FIREWALL_STATES,
	LAN_INVALID_TEXTS,
	LAN_MAX,
	LAN_RULE_NAME,
	NETWORK_CATEGORIES,
	isPrivateIPv4,
	normalizeLanAddress
} from '../../web/src/lib/domain/lan.ts';

const rules = loadHookLib('lan-rules.js');

const VALUES = [
	'192.168.178.20',
	' 192.168.178.20 ',
	'10.0.0.1',
	'172.16.0.1',
	'172.31.255.255',
	'172.32.0.1',
	'192.169.0.1',
	'127.0.0.1',
	'100.64.0.1',
	'169.254.0.1',
	'0.0.0.0',
	'192.168.178.020',
	'192.168.178.256',
	'192.168.178.20:8090',
	'Tower2.Fritz.Box',
	'pc.local',
	'nas.home.arpa',
	'pc.lan',
	'pc.internal',
	'fritz.box',
	'pc.example.org',
	'-pc.local',
	'räch.local',
	`${'a'.repeat(63)}.local`,
	`${'a'.repeat(64)}.local`,
	`${'a.'.repeat(124)}local`,
	'',
	null,
	42
];

describe('domain/lan.ts and lan-rules.js', () => {
	it('take the same addresses, at most the same number', () => {
		for (const value of VALUES) {
			expect(normalizeLanAddress(value), String(value)).toBe(rules.normalizeLanAddress(value));
			expect(isPrivateIPv4(value), String(value)).toBe(rules.isPrivateIPv4(value));
		}
		expect(LAN_MAX).toBe(rules.LAN_MAX);
	});

	it('name the rule, its states, the actions, the outcomes of a change and the networks alike', () => {
		expect(LAN_RULE_NAME).toBe(rules.RULE_NAME);
		expect([...FIREWALL_STATES]).toEqual(rules.FIREWALL_STATES);
		expect([...FIREWALL_ACTIONS]).toEqual(rules.FIREWALL_ACTIONS);
		expect([...FIREWALL_OUTCOMES]).toEqual(rules.FIREWALL_OUTCOMES);
		expect([...NETWORK_CATEGORIES]).toEqual(rules.CATEGORIES);
	});

	it('words every problem of a 400 of the routes', () => {
		const problems = new Set();
		for (const body of [null, { enabled: true, addresses: [] }, { enabled: true, addresses: ['x'] }, { enabled: true, addresses: Array.from({ length: 6 }, (_, i) => `10.0.0.${i + 1}`) }]) {
			problems.add(rules.lanInput(body).problem);
		}
		problems.add(rules.firewallInput(null).problem);
		expect([...problems].sort()).toEqual(['action', 'format', 'invalid', 'required', 'too-many']);
		for (const problem of problems) expect(Object.hasOwn(LAN_INVALID_TEXTS, problem), problem).toBe(true);
	});
});
