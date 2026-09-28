// Static check for package G-6 (ADR-0029, type scale): font sizes come from the tokens
// --font-size-caption|small|control|body|title of tokens.css. base.css, the settings navigation,
// the settings layout and the section bar use them already. The other files still carry numbers
// from before G-6; they are listed here and move to the tokens with their next change. The list
// and the number of such values may only shrink: a new file with a number, a listed file without
// one, or more numbers than before fail the test.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const TOKENS_CSS = join('lib', 'styles', 'tokens.css');

/** Numbers left from before G-6 in all listed files together; lower it when one goes. */
const LEGACY_COUNT = 222;

/** Files that still carry font sizes as numbers (as of G-6). */
const LEGACY_FILES = [
	'lib/components/AppHeader.svelte',
	'lib/components/AreaSwitch.svelte',
	'lib/components/BulkConvertDialog.svelte',
	'lib/components/CaptureForm.svelte',
	'lib/components/ChannelsView.svelte',
	'lib/components/ChipGroup.svelte',
	'lib/components/ClipboardImport.svelte',
	'lib/components/CommentForm.svelte',
	'lib/components/CommentList.svelte',
	'lib/components/ConnectionsSection.svelte',
	'lib/components/DropZone.svelte',
	'lib/components/DueLabel.svelte',
	'lib/components/EditableTitle.svelte',
	'lib/components/FileImportDialog.svelte',
	'lib/components/FilterBar.svelte',
	'lib/components/FilterPopover.svelte',
	'lib/components/FirstSteps.svelte',
	'lib/components/GroupPopover.svelte',
	'lib/components/HistoryList.svelte',
	'lib/components/ImportKeywordsSection.svelte',
	'lib/components/InboxPanel.svelte',
	'lib/components/KpiTiles.svelte',
	'lib/components/MailboxPicker.svelte',
	'lib/components/MarkdownEditor.svelte',
	'lib/components/NewTicketForm.svelte',
	'lib/components/ProjectPanel.svelte',
	'lib/components/ProjectSelect.svelte',
	'lib/components/ProjectTiles.svelte',
	'lib/components/ProjectsView.svelte',
	'lib/components/QuickCapture.svelte',
	'lib/components/RecurrenceForm.svelte',
	'lib/components/RecurrencePanel.svelte',
	'lib/components/RecurrenceSummary.svelte',
	'lib/components/RecurrencesView.svelte',
	'lib/components/SessionNotice.svelte',
	'lib/components/StatusPill.svelte',
	'lib/components/SyncAllButton.svelte',
	'lib/components/TagManager.svelte',
	'lib/components/ThemeMenu.svelte',
	'lib/components/TicketActivity.svelte',
	'lib/components/TicketMeta.svelte',
	'lib/components/ViewSwitch.svelte',
	'lib/components/WhatsAppImport.svelte',
	'lib/components/channels/BookmarkletCard.svelte',
	'lib/components/channels/ChannelCard.svelte',
	'lib/components/channels/ChannelCatalog.svelte',
	'lib/components/channels/ChannelSetup.svelte',
	'lib/components/channels/ChannelsIntro.svelte',
	'lib/components/channels/FileImportGuides.svelte',
	'lib/components/channels/ProtonGuide.svelte',
	'lib/components/channels/SecretValueField.svelte',
	'lib/components/channels/SetupCheck.svelte',
	'lib/components/channels/SetupConnectForm.svelte',
	'lib/components/guidance/CodeBlock.svelte',
	'lib/components/guidance/EmptyState.svelte',
	'lib/components/guidance/Lozenge.svelte',
	'lib/components/guidance/SectionMessage.svelte',
	'lib/components/guidance/Stepper.svelte',
	'lib/components/guidance/Tabs.svelte',
	'lib/components/help/ShortcutList.svelte',
	'lib/components/help/ShortcutsModal.svelte',
	'lib/components/overlay/Drawer.svelte',
	'lib/components/overlay/FlagGroup.svelte',
	'lib/components/overlay/FullView.svelte',
	'lib/components/overlay/Modal.svelte',
	'lib/components/overlay/Popover.svelte',
	// The two heading sizes of Markdown.svelte moved here with the editor (RT-3), no new number.
	'lib/styles/prose.css',
	'lib/styles/tour.css',
	'routes/(app)/(tickets)/tickets/neu/+page.svelte',
	'routes/(app)/einstellungen/darstellung/+page.svelte',
	'routes/(app)/einstellungen/hilfe/+page.svelte',
	'routes/(app)/einstellungen/konto/+page.svelte',
	'routes/(app)/einstellungen/tags/+page.svelte',
	'routes/(app)/projekte/[id]/+page.svelte',
	'routes/(app)/wiederholungen/[id]/+page.svelte',
	'routes/(app)/wiederholungen/neu/+page.svelte',
	'routes/+error.svelte',
	'routes/login/+page.svelte'
].map((path) => join(...path.split('/')));

/** Files that G-6 moved to the tokens; they must stay without numbers. */
const ON_TOKENS = [
	join('lib', 'styles', 'base.css'),
	join('lib', 'components', 'SettingsNav.svelte'),
	join('lib', 'components', 'SectionBar.svelte'),
	join('routes', '(app)', 'einstellungen', '+layout.svelte')
];

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
	});
}

/** The CSS of a file: the <style> blocks of a component or the whole CSS file, without comments. */
function css(path: string): string {
	const source = readFileSync(path, 'utf8');
	const style = path.endsWith('.svelte')
		? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
		: source;
	return style.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Font sizes given as a number (rem, px, em, %) instead of a token. */
function numericSizes(style: string): string[] {
	return [...style.matchAll(/font-size\s*:\s*([^;}]+)/g)]
		.map((match) => (match[1] ?? '').trim())
		.filter((value) => /^\d/.test(value));
}

const SOURCES = [...files(SRC_DIR, /\.svelte$/), ...files(SRC_DIR, /\.css$/)]
	.map((path) => relative(SRC_DIR, path))
	.filter((path) => path !== TOKENS_CSS)
	.sort();

const COUNTS = new Map(
	SOURCES.map((path) => [path, numericSizes(css(join(SRC_DIR, path))).length])
);

describe('font sizes from the type scale (ADR-0029, G-6)', () => {
	it('finds the component styles and style sheets', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		for (const path of [...LEGACY_FILES, ...ON_TOKENS]) expect(SOURCES, path).toContain(path);
	});

	it('has no number as font size outside the list of old files', () => {
		const offenders = SOURCES.filter(
			(path) => !LEGACY_FILES.includes(path) && (COUNTS.get(path) ?? 0) > 0
		);
		expect(offenders).toEqual([]);
	});

	it('keeps base.css and the files of G-6 on the tokens', () => {
		for (const path of ON_TOKENS) expect(COUNTS.get(path), path).toBe(0);
		const base = css(join(SRC_DIR, 'lib', 'styles', 'base.css'));
		expect(base).toMatch(/font-size:\s*var\(--font-size-control\)/);
		expect(base).toMatch(/font-size:\s*var\(--font-size-body\)/);
	});

	it('lets the list and the number of old values only shrink', () => {
		const empty = LEGACY_FILES.filter((path) => (COUNTS.get(path) ?? 0) === 0);
		expect(empty, 'take these files off the list').toEqual([]);
		const total = LEGACY_FILES.reduce((sum, path) => sum + (COUNTS.get(path) ?? 0), 0);
		expect(total).toBeLessThanOrEqual(LEGACY_COUNT);
	});

	it('knows a number from a token', () => {
		expect(
			numericSizes('a { font-size: 0.875rem; } b { font-size: var(--font-size-body) }')
		).toEqual(['0.875rem']);
		expect(numericSizes('a { font-size: inherit; }')).toEqual([]);
	});
});
