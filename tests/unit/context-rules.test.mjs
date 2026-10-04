// Context of the SPA (KX-1, ADR-0057): the answer of GET /api/byl/context from what the route found
// out. The scripts only for the administrator on this machine of a server under Windows, the address
// of the app only for the administrator; the systems are those of the host route.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const context = loadHookLib('context-rules.js');
const host = loadHookLib('host-platform.js');
const system = loadHookLib('system-rules.js');

describe('contextView', () => {
	it('knows the systems of the host route and its default port', () => {
		expect(context.PLATFORMS).toEqual(host.PLATFORMS);
		expect(context.DEFAULT_PORT).toBe(system.listenPort([]));
	});

	// Every combination of administrator, this machine and system.
	const CASES = [];
	for (const admin of [true, false]) {
		for (const local of [true, false]) {
			for (const platform of ['windows', 'linux', 'container']) {
				CASES.push([admin, local, platform]);
			}
		}
	}

	it.each(CASES)('admin %s, local %s, %s', (admin, local, platform) => {
		const view = context.contextView({ admin, local, platform, port: 8091 });
		expect(view).toEqual({
			admin,
			local,
			platform,
			scripts: admin && local && platform === 'windows',
			localUrl: admin ? 'http://127.0.0.1:8091' : null
		});
	});

	it('gives no address to another account, also on this machine', () => {
		expect(context.contextView({ admin: false, local: true, platform: 'windows', port: 8090 }).localUrl).toBeNull();
	});

	it.each([
		[undefined],
		[null],
		['ja'],
		[{ admin: 'true', local: 1 }]
	])('counts anything but true as false (%j)', (input) => {
		expect(context.contextView(input)).toEqual({
			admin: false,
			local: false,
			platform: 'windows',
			scripts: false,
			localUrl: null
		});
	});

	it.each([[0], [70000], [8090.5], ['8091'], [undefined]])('takes the default port for %j', (port) => {
		expect(context.contextView({ admin: true, local: true, platform: 'windows', port }).localUrl).toBe(
			'http://127.0.0.1:8090'
		);
	});

	it('takes an unknown system as the reference system of the host route', () => {
		expect(context.contextView({ admin: true, local: true, platform: 'darwin', port: 8090 })).toMatchObject({
			platform: 'windows',
			scripts: true
		});
	});
});
