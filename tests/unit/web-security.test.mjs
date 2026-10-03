// The page "Sicherheit" of the web app (web/src/lib/domain/security.ts) against the hook module
// (app/pb_hooks/lib/security-rules.js, ADR-0055 §8): the same rule for further hosts and their
// number, the same levels and durations, and the texts of a 400 for every problem the hook names.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	EXTRA_HOSTS_MAX,
	INVALID_TEXTS,
	LEVEL_CHOICES,
	normalizeExtraHost
} from '../../web/src/lib/domain/security.ts';

const rules = loadHookLib('security-rules.js');

const HOSTS = [
	'rechner.tailnet.ts.net',
	' Rechner.Tailnet.TS.net ',
	'pi.local:8443',
	'a-b.c1.example',
	'',
	'localhost',
	'127.0.0.1',
	'[::1]',
	'https://rechner.ts.net',
	'*.ts.net',
	'-a.example.org',
	'rechner.ts.net:0',
	'rechner.ts.net:65535',
	'rechner.ts.net:65536',
	'räch.ts.net',
	`${'a'.repeat(64)}.example.org`,
	`${'abc.'.repeat(63)}org`,
	null,
	42
];

describe('domain/security.ts and security-rules.js', () => {
	it('take the same further hosts, at most the same number', () => {
		for (const value of HOSTS) expect(normalizeExtraHost(value), String(value)).toBe(rules.normalizeExtraHost(value));
		expect(EXTRA_HOSTS_MAX).toBe(rules.EXTRA_HOSTS_MAX);
	});

	it('offer the levels of the hook and name every problem of a 400', () => {
		expect([...LEVEL_CHOICES]).toEqual(rules.LEVELS);
		const problems = [
			rules.settingsInput({}).problem,
			rules.settingsInput({ level: 'x' }).problem,
			rules.settingsInput({ days: 7 }).problem,
			rules.hostsInput(null).problem,
			rules.hostsInput({ hosts: ['localhost'] }).problem,
			rules.hostsInput({ hosts: Array.from({ length: 11 }, (_, i) => `h${i}.example.org`) }).problem
		];
		for (const problem of problems) expect(INVALID_TEXTS[problem], problem).toBeTruthy();
	});
});
