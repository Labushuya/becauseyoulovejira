// Operating system of the server (ADR-0028, plan plattformen S0-3): the answer of GET /api/byl/host
// is read strictly, Windows is the default, and only other systems get a note above the guides.

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_HOST_PLATFORM,
	HOST_PLATFORMS,
	hostGuideNote,
	parseHostPlatform
} from './host-platform';

describe('parseHostPlatform', () => {
	it.each(HOST_PLATFORMS)('reads %s', (platform) => {
		expect(parseHostPlatform({ platform })).toBe(platform);
	});

	it.each([
		null,
		undefined,
		'linux',
		[],
		{},
		{ platform: 'Linux' },
		{ platform: 'macos' },
		{ platform: 1 }
	])('falls back to Windows for %j', (answer) => {
		expect(parseHostPlatform(answer)).toBe(DEFAULT_HOST_PLATFORM);
		expect(DEFAULT_HOST_PLATFORM).toBe('windows');
	});
});

describe('hostGuideNote', () => {
	it('has no note for Windows, the guides are written for it', () => {
		expect(hostGuideNote('windows')).toBeNull();
	});

	it('tells a Linux server where the variables go and to restart it', () => {
		const note = hostGuideNote('linux');
		expect(note?.title).toBe('Dein Server läuft unter Linux');
		expect(note?.text).toContain('setx, start.bat, neu-starten.bat');
		expect(note?.text).toContain('Umgebung des PocketBase-Prozesses');
		expect(note?.text).toContain('startest den Server danach neu');
	});

	it('tells a container to take the environment file and to be created again', () => {
		const note = hostGuideNote('container');
		expect(note?.title).toBe('Dein Server läuft in einem Container');
		expect(note?.text).toContain('Umgebungsdatei des Containers');
		expect(note?.text).toContain('docker compose up -d');
		expect(note?.text).toContain('ein bloßer Neustart liest die Datei nicht neu');
	});
});
