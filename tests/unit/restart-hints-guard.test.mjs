// Guard of BW-2 (ADR-0072 addendum, the user's rule "everything from the browser"): no source of the
// SPA (web/src without tests), of the hooks (app/pb_hooks) or of the mail helper (helpers/mail/src)
// names neu-starten.bat, but for the few places in ALLOWED, each with its reason and its exact number
// of mentions. A restart goes through „Jetzt neu starten“ on the page System (RESTART_WAY); the file of
// the folder app stands only in the emergency way and in the catalog of the problems of the scripts.
// The texts of the server and of the mail helper name that way in the same words as the SPA, so a tab
// without the right drops it (withoutCommands). The pattern ignores the case and finds other
// separators too (neu_starten.bat, „Neu starten.bat“, a non-breaking hyphen).

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FOLDERS = ['web/src', 'app/pb_hooks', 'helpers/mail/src'];
const TEXT_FILES = new Set(['.ts', '.js', '.mjs', '.cjs', '.svelte', '.html', '.css', '.json', '.md', '.txt']);
// U+2010 (hyphen) and U+2011 (non-breaking hyphen) by their code points: the source holds no
// special characters.
const HYPHENS = String.fromCharCode(0x2010, 0x2011);
const FILE = new RegExp(`neu[\\s\\-_${HYPHENS}]?starten\\s*\\.\\s*bat`, 'gi');
const HELP = 'web/src/routes/(app)/einstellungen/hilfe/+page.svelte';

/**
 * The only places that may name the file, with the number of its mentions there. The list may only
 * shrink; a new place needs a reason the browser cannot help with.
 */
const ALLOWED = {
	// The help: only the section "Notfall: wenn die Weboberfläche nicht erreichbar ist" under
	// "Betrieb" (#betrieb-notfall); checked below to lie inside it.
	[HELP]: 1,
	// EMERGENCY_TEXTS: the emergency way folded under „Notfall“ below "Jetzt neu starten" and
	// "Mail-Helfer neu starten" (RestartEmergency, BW-1).
	'web/src/lib/domain/system.ts': 2,
	// The command of the step "Neu starten" in that folded emergency way of the assistants (BW-1),
	// and the comment of the module that says so.
	'web/src/lib/domain/channel-setup.ts': 2,
	// The catalog of the problems of the scripts, word for word as app/byl-problems.ps1 (ADR-0048,
	// parity test): there a script itself failed, the browser is not the way. The help shows it
	// under "Probleme mit den Skripten" (ScriptProblemsHelp, #betrieb-probleme), the only place
	// outside its emergency section where the rendered help names the file.
	'web/src/lib/domain/script-problems.ts': 4
};

function sources(dir) {
	return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
		if (!TEXT_FILES.has(extname(entry.name))) return [];
		return /\.test\.(?:ts|mjs|js)$/.test(entry.name) ? [] : [path];
	});
}

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The words of RESTART_WAY in a source: `export const RESTART_WAY = '…'`. */
function restartWayOf(path) {
	const match = /export const RESTART_WAY = '([^']+)';/.exec(read(path));
	if (match === null) throw new Error(`${path} has no RESTART_WAY`);
	return match[1];
}

describe('restart hints name the way in the browser (BW-2)', () => {
	const files = FOLDERS.flatMap(sources);

	// BYL-E6-2349
	it('names neu-starten.bat only at the places of the allow-list, exactly as often as listed', () => {
		expect(files.length).toBeGreaterThan(100);
		const found = {};
		for (const path of files) {
			const count = (read(path).match(FILE) ?? []).length;
			if (count > 0) found[path] = count;
		}
		expect(found).toEqual(ALLOWED);
	});

	// BYL-E6-2357
	it('finds the file in any case and with other separators, but no other name', () => {
		for (const variant of [
			'neu-starten.bat',
			'Neu-starten.bat',
			'NEU-STARTEN.BAT',
			'neu_starten.bat',
			'neu starten.bat',
			'neustarten.bat',
			`neu${String.fromCharCode(0x2010)}starten.bat`,
			`neu${String.fromCharCode(0x2011)}starten.bat`,
			'neu-starten .bat',
			'app\\neu-starten.bat',
			'`neu-starten.bat`'
		]) {
			expect(variant.match(FILE), variant).toHaveLength(1);
		}
		for (const other of ['start.bat', 'Jetzt neu starten', 'neu-starten.ps1', 'neu starten. Bitte']) {
			expect(other.match(FILE), other).toBeNull();
		}
	});

	// BYL-E6-2349
	it('keeps the file in the help inside the one emergency section under "Betrieb"', () => {
		const help = read(HELP);
		const start = help.indexOf('<h4 id="betrieb-notfall">Notfall: wenn die Weboberfläche nicht erreichbar ist</h4>');
		expect(start).toBeGreaterThan(help.indexOf('<section id="betrieb"'));
		const end = help.indexOf('<h4', start + 1);
		expect(end).toBeGreaterThan(start);
		const mention = help.search(FILE);
		expect(mention).toBeGreaterThan(start);
		expect(mention).toBeLessThan(end);
	});

	// BYL-E6-2350
	it('gives the server and the mail helper the words of the SPA for the way', () => {
		const way = restartWayOf('web/src/lib/domain/system.ts');
		expect(way).toBe('Einstellungen → System → „Jetzt neu starten“');
		expect(restartWayOf('helpers/mail/src/config.ts')).toBe(way);
		// The pattern of withoutCommands (domain/context.ts) knows exactly these words.
		expect(read('web/src/lib/domain/context.ts')).toContain(`|${way})/i`);
		// Every mention of the page System with a button in the texts of the server and the helper is
		// the one way, so a tab without the right drops it.
		const mentions = files
			.filter((path) => !path.startsWith('web/'))
			.flatMap((path) => read(path).match(/Einstellungen → System → „[^“]*“/g) ?? []);
		expect(mentions.length).toBeGreaterThanOrEqual(15);
		expect(new Set(mentions)).toEqual(new Set([way]));
	});

	// BYL-E6-2350
	it('words every text of the server before a migration with the way, never the file', () => {
		for (const path of [
			'app/pb_hooks/lib/account-service.js',
			'app/pb_hooks/lib/connection-service.js',
			'app/pb_hooks/lib/household-service.js',
			'app/pb_hooks/lib/inbox-ics.js',
			'app/pb_hooks/lib/inbox-key-service.js',
			'app/pb_hooks/lib/ingest-service.js',
			'app/pb_hooks/lib/page-copy-service.js',
			'app/pb_hooks/lib/trash-service.js'
		]) {
			expect(read(path), path).toMatch(
				/nach dem nächsten Neustart der App bereit \(Einstellungen → System → „Jetzt neu starten“\)\./
			);
		}
	});
});

describe('the guard reads the right files', () => {
	it('skips tests and dependencies, and sees sources of all three folders', () => {
		const files = FOLDERS.flatMap(sources);
		expect(files.some((path) => path.endsWith('.test.ts') || path.endsWith('.test.mjs'))).toBe(false);
		expect(files.some((path) => path.includes('node_modules'))).toBe(false);
		for (const folder of FOLDERS) expect(files.some((path) => path.startsWith(`${folder}/`)), folder).toBe(true);
		expect(files).toContain(HELP);
		expect(files).toContain('app/pb_hooks/lib/mailbox-rules.js');
		expect(files).toContain('helpers/mail/src/providers.ts');
	});
});
