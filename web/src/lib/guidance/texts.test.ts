// One wording for the restart after an update (ADR-0026 section 2, plan EH-2; since ADR-0039
// neu-starten.bat): the texts of the stores come from lib/guidance/texts.ts, no hint about a
// restart names start.bat alone, and none sends the user through "stop.bat, dann start.bat" any
// more. Messages that the server is not running ("gestartet ist (start.bat)") are a different
// matter and stay.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONNECTIONS_UNAVAILABLE_MESSAGE } from '$lib/stores/connections.svelte';
import { IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE } from '$lib/stores/import-keywords.svelte';
import { INBOX_UNAVAILABLE_MESSAGE } from '$lib/stores/inbox.svelte';
import { RECURRENCE_UNAVAILABLE } from '$lib/stores/recurrence.svelte';
import { RESTART_NEEDED, restartNeeded } from './texts';

const SRC_DIR = resolve(import.meta.dirname, '..', '..');

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

describe('restart hint', () => {
	it('names neu-starten.bat in the folder app', () => {
		expect(RESTART_NEEDED.title).toBe('Nach dem nächsten Neustart verfügbar');
		expect(RESTART_NEEDED.text).toMatch(/neu-starten\.bat im Ordner app/);
		expect(restartNeeded('Der Eingang ist')).toBe(
			`Der Eingang ist nach dem nächsten Neustart verfügbar. ${RESTART_NEEDED.text}`
		);
	});

	it.each([
		['connections', CONNECTIONS_UNAVAILABLE_MESSAGE, 'Die Verbindungen sind'],
		[
			'import keywords',
			IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE,
			'Die Stichwörter für Datei-Importe sind'
		],
		['inbox', INBOX_UNAVAILABLE_MESSAGE, 'Der Eingang ist'],
		['recurrence', RECURRENCE_UNAVAILABLE, 'Wiederholungen sind']
	])('the store of the %s uses the one text', (_name, message, subject) => {
		expect(message).toBe(restartNeeded(subject));
	});

	it('the file import of the inbox uses the one text', () => {
		const source = readFileSync(join(SRC_DIR, 'lib', 'stores', 'mail-import.ts'), 'utf8');
		expect(source).toMatch(/restartNeeded\('Der Eingang ist'\)/);
	});

	it('no source names start.bat alone for a restart', () => {
		const offenders = sources(SRC_DIR).flatMap((path) => {
			const lines = readFileSync(path, 'utf8').split('\n');
			return lines
				.map((line, index) => ({ line, index }))
				.filter(({ line }) => /n(ä|ae)chsten (Neu)?[Ss]tart/.test(line) && /start\.bat/.test(line))
				.filter(({ line }) => !/neu-starten\.bat/.test(line))
				.map(({ index }) => `${relative(SRC_DIR, path)}:${index + 1}`);
		});
		expect(offenders).toEqual([]);
	});

	it('no source sends a restart through stop.bat and start.bat any more (neu-starten.bat)', () => {
		const offenders = sources(SRC_DIR).flatMap((path) => {
			const lines = readFileSync(path, 'utf8').split('\n');
			return lines
				.map((line, index) => ({ line, index }))
				.filter(({ line }) =>
					/stop\.bat(<\/code>)?,? (und )?(dann )?(<code>)?start\.bat/.test(line)
				)
				.filter(({ line }) => !/^\s*(\/\/|\*)/.test(line))
				.map(({ index }) => `${relative(SRC_DIR, path)}:${index + 1}`);
		});
		expect(offenders).toEqual([]);
	});

	it('no source says "(start.bat)" for a migration any more', () => {
		const offenders = sources(SRC_DIR).filter((path) =>
			/nächsten Start der App bereit \(start\.bat\)/.test(readFileSync(path, 'utf8'))
		);
		expect(offenders.map((path) => relative(SRC_DIR, path))).toEqual([]);
	});
});
