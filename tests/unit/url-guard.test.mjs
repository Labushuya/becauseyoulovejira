// SSRF guard of the page copy (ADR-0031 section 6): which addresses may be fetched. Blocked:
// private, loopback, link-local, metadata and reserved addresses in every notation, local names,
// services that resolve any IP; allowed: public addresses on the usual ports.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const guard = loadHookLib('url-guard.js');
const reasonOf = (url, testPort) => {
	const result = guard.checkUrl(url, testPort);
	return result.ok ? 'ok' : result.reason;
};

describe('checkUrl: allowed', () => {
	it.each([
		'https://example.com/',
		'http://www.example.org/pfad?a=1#teil',
		'https://Example.COM./seite',
		'https://example.com:443/',
		'http://example.com:8080/x',
		'https://example.com:8443',
		'https://8.8.8.8/',
		'http://93.184.216.34/',
		'https://[2606:4700:4700::1111]/',
		'https://[2a00:1450:4001:82a::200e]:443/pfad',
		'https://[::ffff:8.8.8.8]/',
		'https://[2002:0808:0808::1]/'
	])('%s', (url) => {
		expect(guard.checkUrl(url)).toMatchObject({ ok: true, url });
	});
});

describe('checkUrl: refused', () => {
	it.each([
		// Only http and https, no credentials, only the usual ports.
		['ftp://example.com/', 'scheme'],
		['file:///C:/Windows/win.ini', 'scheme'],
		['javascript:alert(1)', 'scheme'],
		['gopher://example.com/', 'scheme'],
		['https://anna:geheim@example.com/', 'credentials'],
		['https://example.com@127.0.0.1/', 'credentials'],
		['https://example.com:22/', 'port'],
		['http://example.com:8090/', 'port'],
		['https://example.com:0/', 'invalid'],
		['https://example.com:99999/', 'invalid'],
		['', 'invalid'],
		['https://', 'invalid'],
		['https://exa mple.com/', 'invalid'],
		['https://example.com\\@evil/', 'invalid'],
		['https://exämple.com/', 'invalid'],
		['https://%31%32%37.0.0.1/', 'invalid'],
		['https://-example.com/', 'invalid'],
		// Loopback and "this network" in every notation.
		['http://127.0.0.1/', 'blocked'],
		['http://127.1/', 'blocked'],
		['http://127.0.0.1:80/', 'blocked'],
		['http://2130706433/', 'blocked'],
		['http://0x7f000001/', 'blocked'],
		['http://0x7f.0.0.1/', 'blocked'],
		['http://0177.0.0.1/', 'blocked'],
		['http://0177.0.0.01/', 'blocked'],
		['http://017700000001/', 'blocked'],
		['http://0/', 'blocked'],
		['http://0.0.0.0/', 'blocked'],
		['http://127.0.0.1./', 'blocked'],
		['http://[::1]/', 'blocked'],
		['http://[0:0:0:0:0:0:0:1]/', 'blocked'],
		['http://[::]/', 'blocked'],
		['http://[::ffff:127.0.0.1]/', 'blocked'],
		['http://[::ffff:7f00:1]/', 'blocked'],
		['http://[::127.0.0.1]/', 'blocked'],
		['http://[64:ff9b::7f00:1]/', 'blocked'],
		['http://[64:ff9b:1::1]/', 'blocked'],
		['http://[2002:7f00:0001::1]/', 'blocked'],
		// Private networks, link-local and cloud metadata.
		['http://10.0.0.1/', 'blocked'],
		['http://10.255.255.255/', 'blocked'],
		['http://172.16.0.1/', 'blocked'],
		['http://172.31.255.255/', 'blocked'],
		['http://192.168.178.1/', 'blocked'],
		['http://192.168.1.1:8080/', 'blocked'],
		['http://169.254.169.254/latest/meta-data/', 'blocked'],
		['http://0xa9fea9fe/', 'blocked'],
		['http://2852039166/', 'blocked'],
		['http://100.64.0.1/', 'blocked'],
		['http://100.100.100.200/', 'blocked'],
		['http://[fd00:ec2::254]/', 'blocked'],
		['http://[fe80::1]/', 'blocked'],
		['http://[fc00::1]/', 'blocked'],
		['http://[::ffff:192.168.0.1]/', 'blocked'],
		['http://[::ffff:a9fe:a9fe]/', 'blocked'],
		['http://[2001::1]/', 'blocked'],
		['http://[2001:db8::1]/', 'blocked'],
		['http://[ff02::1]/', 'blocked'],
		// Reserved, benchmark, documentation, multicast and broadcast.
		['http://192.0.0.8/', 'blocked'],
		['http://192.0.2.1/', 'blocked'],
		['http://198.18.0.1/', 'blocked'],
		['http://198.51.100.7/', 'blocked'],
		['http://203.0.113.9/', 'blocked'],
		['http://224.0.0.1/', 'blocked'],
		['http://240.0.0.1/', 'blocked'],
		['http://255.255.255.255/', 'blocked'],
		// Broken numeric hosts count as blocked, not as names.
		['http://256.1.1.1/', 'blocked'],
		['http://1.2.3.4.5/', 'blocked'],
		['http://08.1.1.1/', 'blocked'],
		// Local names and services that resolve any IP.
		['http://localhost/', 'blocked'],
		['http://LOCALHOST:443/', 'blocked'],
		['http://localhost./', 'blocked'],
		['http://app.localhost/', 'blocked'],
		['http://intranet/', 'blocked'],
		['http://router/', 'blocked'],
		['http://nas.local/', 'blocked'],
		['http://metadata.google.internal/', 'blocked'],
		['http://fritz.box.home.arpa/', 'blocked'],
		['http://drucker.lan/', 'blocked'],
		['http://server.corp/', 'blocked'],
		['http://example.test/', 'blocked'],
		['http://127.0.0.1.nip.io/', 'blocked'],
		['http://10-0-0-1.sslip.io/', 'blocked'],
		['http://localtest.me/', 'blocked'],
		['http://x.lvh.me/', 'blocked']
	])('%s: %s', (url, reason) => {
		const result = guard.checkUrl(url);
		expect(result).toMatchObject({ ok: false, reason });
		expect(result.message).toBe(guard.MESSAGES[reason]);
	});
});

describe('checkUrl: the port of the test server', () => {
	it('allows exactly 127.0.0.1 on that port and nothing else', () => {
		expect(reasonOf('http://127.0.0.1:47123/seite', 47123)).toBe('ok');
		expect(reasonOf('http://127.0.0.1:47124/seite', 47123)).toBe('port');
		expect(reasonOf('http://localhost:47123/seite', 47123)).toBe('port');
		expect(reasonOf('http://[::1]:47123/seite', 47123)).toBe('port');
		expect(reasonOf('http://127.0.0.1/seite', 47123)).toBe('blocked');
		expect(reasonOf('http://127.0.0.1:47123/seite')).toBe('port');
		expect(reasonOf('http://127.0.0.1:47123/seite', 0)).toBe('port');
	});
});

describe('address parsing', () => {
	it('reads IPv4 literals like inet_aton', () => {
		expect(guard.parseIPv4('127.0.0.1')).toEqual([127, 0, 0, 1]);
		expect(guard.parseIPv4('127.1')).toEqual([127, 0, 0, 1]);
		expect(guard.parseIPv4('10.1.65535')).toEqual([10, 1, 255, 255]);
		expect(guard.parseIPv4('0x0A.0x1')).toEqual([10, 0, 0, 1]);
		expect(guard.parseIPv4('4294967295')).toEqual([255, 255, 255, 255]);
		expect(guard.parseIPv4('4294967296')).toBeNull();
		expect(guard.parseIPv4('1.256.1.1')).toBeNull();
		expect(guard.parseIPv4('09.1.1.1')).toBeNull();
	});

	it('reads IPv6 literals with "::" and an IPv4 tail', () => {
		expect(guard.parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
		expect(guard.parseIPv6('2001:db8::8:800:200c:417a')).toEqual([
			0x2001, 0xdb8, 0, 0, 0x8, 0x800, 0x200c, 0x417a
		]);
		expect(guard.parseIPv6('::ffff:192.168.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x1]);
		expect(guard.parseIPv6('1:2:3:4:5:6:1.2.3.4')).toEqual([1, 2, 3, 4, 5, 6, 0x102, 0x304]);
		expect(guard.parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		for (const bad of ['1:2:3:4:5:6:7', '1::2::3', ':::', '12345::', '::ffff:1.2.3', 'g::1', '1:2:3:4:5:6:7:8:9']) {
			expect(guard.parseIPv6(bad), bad).toBeNull();
		}
	});
});
