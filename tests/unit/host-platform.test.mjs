// Operating system of the server (ADR-0028, plan plattformen S0-2): BYL_HOST_PLATFORM wins with a
// known value, otherwise the name of the executable decides; Windows stays the default.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const host = loadHookLib('host-platform.js');

describe('hostPlatform', () => {
	it('names the variable and the known platforms', () => {
		expect(host.ENV).toBe('BYL_HOST_PLATFORM');
		expect(host.PLATFORMS).toEqual(['windows', 'linux', 'container']);
	});

	it.each([
		['windows', '/app/pocketbase', 'windows'],
		['linux', 'C:\\app\\pocketbase.exe', 'linux'],
		['container', '/pb/pocketbase', 'container'],
		['  Container ', '', 'container'],
		['LINUX', '', 'linux']
	])('takes the known value %j over the executable %j', (value, executable, expected) => {
		expect(host.hostPlatform(value, executable)).toBe(expected);
	});

	it.each([
		['C:\\Users\\Anna Beispiel\\app\\pocketbase.exe', 'windows'],
		['D:/byl/app/POCKETBASE.EXE', 'windows'],
		['/home/anna/app/pocketbase', 'linux'],
		['/pb/pocketbase', 'linux'],
		['./pocketbase', 'linux']
	])('detects the executable %j as %s', (executable, expected) => {
		expect(host.hostPlatform('', executable)).toBe(expected);
	});

	it.each([
		['macos', '/app/pocketbase', 'linux'],
		['raspberry', 'C:\\app\\pocketbase.exe', 'windows'],
		[undefined, undefined, 'windows'],
		[null, '   ', 'windows'],
		['', '', 'windows']
	])('ignores the unknown value %j and falls back to the executable %j', (value, executable, expected) => {
		expect(host.hostPlatform(value, executable)).toBe(expected);
	});
});
