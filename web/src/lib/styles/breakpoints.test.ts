// Breakpoints (MO-1a, ADR-0073 §1): one breakpoint for the phone layout, PHONE_QUERY, and a closed
// list of the widths every media query of the styles may use, so a new width needs a decision
// instead of creeping in (no container queries, ADR-0030). The phone rules of the CSS stand only
// below that one breakpoint and only with the switch "Handy-Ansicht (Vorschau)" on, so from 40rem
// and with the switch off nothing changes; in scripts the widths come only from their constants.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALENDAR_NARROW_QUERY } from '$lib/domain/calendar';
import { MOBILE_LAYOUT_ATTRIBUTE, PHONE_QUERY } from '$lib/domain/phone-layout';
import { PANEL_EMBEDDED_QUERY } from '$lib/overlay/panel-host.svelte';

const SRC_DIR = resolve(import.meta.dirname, '..', '..');

/** The widths of media queries, each with the place it was decided (the complete list). */
const WIDTHS = [
	// Panel embedded, sticky header, settings in two columns (ADR-0025 §6, UI-6b).
	'(min-width: 64rem)',
	'(max-width: 63.99rem)',
	// Pool beside the day plan (ADR-0065).
	'(min-width: 60rem)',
	// Comparison in two columns in the help (VH-1), full view in full screen (ADR-0025).
	'(min-width: 48rem)',
	'(max-width: 47.99rem)',
	// The stepper of the guides (EH-2).
	'(max-width: 40rem)',
	// The phone layout and the agenda of the calendar (MO-1a, ADR-0073; ADR-0053 §7).
	'(max-width: 39.99rem)',
	// Panel over the full width (UI-6b).
	'(max-width: 35.99rem)'
];

const PHONE_MEDIA = `@media ${PHONE_QUERY}`;

/** Every .svelte, .css and .ts file below src except tests, with its text without comments. */
function sources(): { file: string; text: string }[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry).replaceAll('\\', '/'))
		.filter((file) => /\.(svelte|css|ts)$/.test(file) && !file.includes('.test.'))
		.map((file) => ({
			file: relative(SRC_DIR, join(SRC_DIR, file)).replaceAll('\\', '/'),
			text: readFileSync(join(SRC_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
		}));
}

const SOURCES = sources();

/** The style text of a source: the whole of a .css file, the <style> blocks of a component. */
function styleOf(source: { file: string; text: string }): string {
	if (source.file.endsWith('.css')) return source.text;
	if (!source.file.endsWith('.svelte')) return '';
	return [...source.text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
		.map((match) => match[1])
		.join('\n');
}

/**
 * The preludes of the blocks around every occurrence of `needle` in `css`, outermost first, and
 * last the whole selector it stands in.
 */
function enclosing(css: string, needle: string): string[][] {
	const found: string[][] = [];
	const stack: string[] = [];
	let start = 0;
	for (let index = 0; index < css.length; index++) {
		const char = css[index];
		if (char === '{') {
			stack.push(css.slice(start, index).trim());
			start = index + 1;
		} else if (char === '}') {
			stack.pop();
			start = index + 1;
		} else if (css.startsWith(needle, index)) {
			found.push([...stack, css.slice(start, css.indexOf('{', index)).trim()]);
		}
	}
	return found;
}

describe('breakpoints (MO-1a, ADR-0073)', () => {
	it('finds the styles of the app', () => {
		expect(SOURCES.filter((source) => styleOf(source) !== '').length).toBeGreaterThan(50);
	});

	it('has one breakpoint for the phone layout, shared with the agenda of the calendar', () => {
		expect(PHONE_QUERY).toBe('(max-width: 39.99rem)');
		expect(CALENDAR_NARROW_QUERY).toBe(PHONE_QUERY);
		expect(WIDTHS).toContain(PHONE_QUERY);
		expect(WIDTHS).toContain(PANEL_EMBEDDED_QUERY);
	});

	it('uses only the widths of the list in every media query', () => {
		const unknown: string[] = [];
		for (const source of SOURCES) {
			for (const [, prelude = ''] of styleOf(source).matchAll(/@media([^{]*)\{/g)) {
				for (const [width] of prelude.matchAll(/\((?:min|max)-width:[^)]*\)/g)) {
					if (!WIDTHS.includes(width)) unknown.push(`${source.file}: ${width}`);
				}
			}
		}
		expect(unknown).toEqual([]);
	});

	it('names widths in scripts only through PHONE_QUERY and the query of the embedded panel', () => {
		const literal = SOURCES.filter(({ file, text }) => {
			const script = file.endsWith('.svelte')
				? text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
				: file.endsWith('.ts')
					? text
					: '';
			return /['"`]\((?:min|max)-width:/.test(script);
		}).map((source) => source.file);
		expect(literal.sort()).toEqual([
			'lib/domain/phone-layout.ts',
			'lib/overlay/panel-host.svelte.ts'
		]);
	});

	it('puts every rule of the phone frame below the one breakpoint and behind the switch', () => {
		const places: string[] = [];
		for (const source of SOURCES) {
			const css = styleOf(source);
			for (const preludes of enclosing(css, MOBILE_LAYOUT_ATTRIBUTE)) {
				places.push(source.file);
				expect(preludes, source.file).toContain(PHONE_MEDIA);
				expect(preludes.at(-1), source.file).toMatch(/:root\[data-mobile-layout='on'\]/);
			}
		}
		// The margin of the pages, the end of the page above the bottom bar, the flags above it (and at
		// the top while a sheet is open); since MO-1b the targets of 44 px, the options of 44 px of the
		// suggestions and the safe areas of the panel as a page; since MO-2 the day plan (row, head,
		// folded suggestions and pool, "Sortierung"); since MO-3 "Aufgaben" (the bar of the view, the
		// cards, the filter sheet with its parts, the bar of the selection below the top bar); since
		// MO-4 the ticket as a page (the head of the panel, the fields one below the other and the bar
		// at the bottom, the toolbar of the editor, the tabs, the rows of the sub-tasks, the tags, the
		// path, the parent, the charms, the tasks of the text, the save buttons above the keyboard);
		// since MO-5 the sheet of the quick entry (its two buttons side by side, the folded help, the
		// link to the result); since MO-6 the inbox (its cards, the bar of the selection, the filter
		// sheet, the page of an entry with its main actions) and the button "Filter" shared with
		// "Aufgaben"; since MO-7b "Projekte", "Wiederholungen" and "Papierkorb" (their cards, the row of
		// the view, the filter sheet, the pages of a project and a rule with their targets) and the bar
		// of the selection at the bottom; since MO-7c1 "Erledigte" (the entries as cards, the filters of
		// 44 px) and the folded parts about the keyboard in the help.
		expect([...new Set(places)].sort()).toEqual([
			'lib/components/Breadcrumbs.svelte',
			'lib/components/CharmPicker.svelte',
			'lib/components/CommentForm.svelte',
			'lib/components/CommentItem.svelte',
			'lib/components/FilterBar.svelte',
			'lib/components/FilterButton.svelte',
			'lib/components/FilterSheet.svelte',
			'lib/components/InboxPanel.svelte',
			'lib/components/InboxTable.svelte',
			'lib/components/MarkdownEditor.svelte',
			'lib/components/ProjectPanel.svelte',
			'lib/components/ProjectTable.svelte',
			'lib/components/ProjectTicketList.svelte',
			'lib/components/ProjectsView.svelte',
			'lib/components/QuickCapture.svelte',
			'lib/components/RecurrenceForm.svelte',
			'lib/components/RecurrencePanel.svelte',
			'lib/components/RecurrenceTable.svelte',
			'lib/components/SectionBar.svelte',
			'lib/components/SelectionBar.svelte',
			'lib/components/SortChoice.svelte',
			'lib/components/SuggestionList.svelte',
			'lib/components/TagPicker.svelte',
			'lib/components/TicketActivity.svelte',
			'lib/components/TicketCard.svelte',
			'lib/components/TicketDescription.svelte',
			'lib/components/TicketFields.svelte',
			'lib/components/TicketParentField.svelte',
			'lib/components/TicketSubtasks.svelte',
			'lib/components/TicketTable.svelte',
			'lib/components/TrashTable.svelte',
			'lib/components/TrashView.svelte',
			'lib/components/ViewWithPanel.svelte',
			'lib/components/day-plan/DayPlanList.svelte',
			'lib/components/day-plan/DayPlanPool.svelte',
			'lib/components/day-plan/DayPlanSort.svelte',
			'lib/components/day-plan/DayPlanSuggestions.svelte',
			'lib/components/day-plan/DayPlanView.svelte',
			'lib/components/done/DoneFilterBar.svelte',
			'lib/components/done/DoneView.svelte',
			'lib/components/editor/EditorToolbar.svelte',
			'lib/components/help/KeyboardFold.svelte',
			'lib/components/overlay/Drawer.svelte',
			'lib/components/overlay/FlagGroup.svelte',
			'lib/styles/base.css',
			'lib/styles/prose.css',
			'lib/styles/tokens.css',
			'routes/(app)/+layout.svelte'
		]);
	});
});
