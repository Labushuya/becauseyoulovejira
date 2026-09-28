// Settings of the extension (ADR-0038 §3): only addresses of this machine, the shape of a key,
// the chat list and the stored values of the automatic mode.

import { describe, expect, it } from 'vitest';
import manifest from '../static/manifest.json';
import {
	DEFAULT_APP_URL,
	LAST_SEEN_MAX,
	LOOPBACK_HOSTS,
	autoOf,
	chatKey,
	connectionOf,
	normalizeAppUrl,
	parseChatList,
	tokenError,
	withLastSeen
} from './settings';

const TOKEN = `byl_${'Ab12'.repeat(10)}`;

describe('address of the app', () => {
	it('takes http on this machine with any port', () => {
		expect(normalizeAppUrl(' http://127.0.0.1:8090/ ')).toEqual({ url: 'http://127.0.0.1:8090' });
		expect(normalizeAppUrl('http://localhost:9000')).toEqual({ url: 'http://localhost:9000' });
		expect(normalizeAppUrl('http://LOCALHOST')).toEqual({ url: 'http://localhost' });
		expect(normalizeAppUrl(DEFAULT_APP_URL)).toEqual({ url: DEFAULT_APP_URL });
	});

	it('refuses other hosts, schemes, users and paths', () => {
		for (const value of [
			'',
			'127.0.0.1:8090',
			'https://127.0.0.1:8090',
			'http://192.168.1.10:8090',
			'http://example.com',
			'http://127.0.0.1.example.com',
			'http://user:pass@127.0.0.1:8090',
			'http://127.0.0.1:8090/api',
			'http://127.0.0.1:8090/?x=1',
			'http://127.0.0.1:8090/#a',
			'http://[::1]:8090',
			'file:///C:/app'
		]) {
			expect('error' in normalizeAppUrl(value), value).toBe(true);
		}
	});

	it('matches the host permissions of the manifest', () => {
		const loopback = manifest.host_permissions.filter((pattern) => pattern.startsWith('http://'));
		expect(loopback).toEqual(LOOPBACK_HOSTS.map((host) => `http://${host}/*`));
	});

	it('reads the stored connection tolerantly', () => {
		expect(connectionOf({})).toEqual({ appUrl: DEFAULT_APP_URL, token: '' });
		expect(connectionOf({ appUrl: 'http://evil.example', token: 'kein' })).toEqual({
			appUrl: DEFAULT_APP_URL,
			token: ''
		});
		expect(connectionOf({ appUrl: 'http://localhost:1234', token: TOKEN })).toEqual({
			appUrl: 'http://localhost:1234',
			token: TOKEN
		});
	});
});

describe('key', () => {
	it('checks the shape', () => {
		expect(tokenError(TOKEN)).toBeNull();
		expect(tokenError(` ${TOKEN} `)).toBeNull();
		for (const value of [
			'',
			'byl_',
			`${TOKEN}x`,
			TOKEN.slice(0, -1),
			TOKEN.replace('byl_', 'BYL_')
		]) {
			expect(tokenError(value), value).toMatch(/beginnt mit byl_/);
		}
	});
});

describe('automatic mode', () => {
	it('reads the chat list without empty lines and duplicates', () => {
		expect(parseChatList(' Familie \n\nfamilie\nVerein  Nord\r\n')).toEqual([
			'Familie',
			'Verein  Nord'
		]);
		expect(
			parseChatList(Array.from({ length: 60 }, (_, i) => `Chat ${i}`).join('\n'))
		).toHaveLength(50);
		expect(chatKey('  Verein   Nord ')).toBe('verein nord');
	});

	it('reads the stored values; the switch is off by default', () => {
		expect(autoOf({})).toEqual({ auto: false, autoSince: 0, chats: [], lastSeen: {} });
		expect(
			autoOf({ auto: true, autoSince: 1000, chats: ['A', 3, 'a'], lastSeen: { x: 5, y: 'z' } })
		).toEqual({ auto: true, autoSince: 1000, chats: ['A'], lastSeen: { x: 5 } });
		expect(autoOf({ auto: 'yes', autoSince: 1000 })).toMatchObject({ auto: false, autoSince: 0 });
	});

	it('keeps the newest last messages and never goes back in time', () => {
		expect(withLastSeen({ a: 10 }, 'a', 5)).toEqual({ a: 10 });
		expect(withLastSeen({ a: 10 }, 'b', 20)).toEqual({ a: 10, b: 20 });
		const many = Object.fromEntries(
			Array.from({ length: LAST_SEEN_MAX }, (_, i) => [`c${i}`, i + 1])
		);
		const next = withLastSeen(many, 'new', 1_000);
		expect(Object.keys(next)).toHaveLength(LAST_SEEN_MAX);
		expect(next.new).toBe(1_000);
		expect(next.c0).toBeUndefined();
	});
});
