// Static checks for ADR-0026 section 2 (plan EH-10 to EH-12): hints, warnings and empty states go
// through the guidance building blocks (SectionMessage, EmptyState under components/guidance/),
// not through local classes ".notice" or ".empty"; and only lib/guidance/texts.ts words the hint
// "nach dem nächsten Neustart". The building blocks themselves are the one place with such styles.
// Since EH-12 there is no exception left: every component outside components/guidance/ is checked.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const GUIDANCE_DIR = join('lib', 'components', 'guidance');
const TEXTS = join('lib', 'guidance', 'texts.ts');

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

/** Source without comments, so a comment may still name the old classes. */
function code(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A local class .notice or .empty in the style or in a class attribute ("empty-state" is not). */
const OWN_NOTICE =
	/\.(?:notice|empty)(?![\w-])|class="(?:[^"]*\s)?(?:notice|empty)(?:\s[^"]*)?"|class:(?:notice|empty)\b/;
/** The hint after an update, in any wording with "nächsten Start" or "nächsten Neustart". */
const RESTART_TEXT = /n(?:ä|ae)chsten (?:Neu)?[Ss]tart/;

/**
 * Files moved with EH-10 (dialogs, editors), EH-11 (tables, panels) and EH-12 (projects, tags):
 * they use the blocks.
 */
const MOVED = [
	'FileImportDialog.svelte',
	'KeywordEditor.svelte',
	'MailboxPicker.svelte',
	'RecurrenceSummary.svelte',
	'WhatsAppImport.svelte',
	'TicketTable.svelte',
	'InboxTable.svelte',
	'InboxPanel.svelte',
	'CommentList.svelte',
	'HistoryList.svelte',
	'ProjectsView.svelte',
	'TagManager.svelte'
];

const components = files(SRC_DIR, /\.svelte$/).map(
	(path) => [relative(SRC_DIR, path), path] as const
);
const outsideGuidance = components.filter(([name]) => !name.startsWith(GUIDANCE_DIR));

describe('hints through the guidance building blocks', () => {
	it('finds the building blocks and the components', () => {
		const blocks = components
			.filter(([name]) => name.startsWith(GUIDANCE_DIR))
			.map(([name]) => name);
		expect(blocks).toEqual(
			expect.arrayContaining([
				join(GUIDANCE_DIR, 'SectionMessage.svelte'),
				join(GUIDANCE_DIR, 'EmptyState.svelte'),
				join(GUIDANCE_DIR, 'Lozenge.svelte')
			])
		);
		expect(outsideGuidance.length).toBeGreaterThan(50);
	});

	it.each(outsideGuidance)('%s has no local .notice or .empty', (_name, path) => {
		expect(code(path)).not.toMatch(OWN_NOTICE);
	});

	it.each(MOVED)('%s uses SectionMessage or EmptyState', (file) => {
		const source = code(join(SRC_DIR, 'lib', 'components', file));
		expect(source).toMatch(
			/import (?:SectionMessage|EmptyState) from '\.\/guidance\/\w+\.svelte';/
		);
	});

	it('words the restart hint only in lib/guidance/texts.ts', () => {
		const offenders = files(SRC_DIR, /\.(svelte|ts)$/)
			.filter((path) => relative(SRC_DIR, path) !== TEXTS)
			.filter((path) => RESTART_TEXT.test(code(path)))
			.map((path) => relative(SRC_DIR, path));
		expect(offenders).toEqual([]);
		expect(readFileSync(join(SRC_DIR, TEXTS), 'utf8')).toMatch(RESTART_TEXT);
	});

	it.each([
		['<p class="notice">', true],
		['<div class="alert-error notice">', true],
		['<div class="empty">', true],
		['\t.empty,', true],
		['.notice a {', true],
		['class:empty', true],
		['<div class="empty-state">', false],
		['.empty-state {', false],
		['<SectionMessage tone="info">', false],
		['isEmpty()', false]
	])('recognizes a local class in %s', (sample, found) => {
		expect(OWN_NOTICE.test(sample)).toBe(found);
	});
});
