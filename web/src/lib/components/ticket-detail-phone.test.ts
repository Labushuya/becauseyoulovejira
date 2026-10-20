// The ticket in the phone frame (MO-4, ADR-0073 addendum MO-4) in jsdom with a controlled matchMedia:
// every side panel is a page whose head starts with the arrow back (no ×, no "Vollansicht"); the
// ticket shows its fields one below the other and a fixed bar at the bottom with "Erledigt" and the
// status, whose questions stand above them; the menu of a card leaves out "In Vollansicht öffnen".
// The counter-checks: on a PC with the switch on and on a phone with the switch off everything stays
// as before. Sizes, wrapping and the keyboard are checked statically here and in a browser by
// tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import DrawerHarness from '$lib/test/DrawerHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import TicketActions from './TicketActions.svelte';
import TicketPanel from './TicketPanel.svelte';

useOverlayStubs();
useProseMirrorStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/tickets/abc123def456ghi?sort=titel') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto, beforeNavigate: vi.fn() }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const COMPONENTS = import.meta.dirname;
const LIB = join(COMPONENTS, '..');
const ID = 'abc123def456ghi';
const LIST = '/?sort=titel' as ResolvedPathname;
const FULL = `/tickets/${ID}/voll?sort=titel` as ResolvedPathname;

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	mocks.goto.mockClear();
});

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Steuererklärung',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'high',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-02 12:30:00.000Z',
		...overrides
	};
}

/** Two open sub-tasks that block the ticket (ADR-0033 section 2). */
const OPEN_SUBTASKS: readonly TicketSummary[] = [
	ticket({ id: 'child0000000001', key: 'TASK-4', title: 'Belege', parentId: ID }),
	ticket({ id: 'child0000000002', key: 'TASK-5', title: 'Formular', parentId: ID })
];

/** The detail store on a fake data layer, the panel of the ticket on top of it. */
async function renderPanel(initial: Ticket = ticket(), subtasks: readonly TicketSummary[] = []) {
	let current = initial;
	const data = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			current = { ...current, ...(patch as Partial<Ticket>), updated: '2026-09-24 10:00:01.000Z' };
			return current;
		}),
		create: vi.fn(),
		delete: vi.fn()
	} satisfies TicketDetailData;
	const listed = new SvelteMap<string, TicketSummary>();
	const list = {
		find: (id: string) => listed.get(id) ?? null,
		upsert: vi.fn((summary: TicketSummary) => listed.set(summary.id, summary)),
		completed: vi.fn((summary: TicketSummary) => listed.set(summary.id, summary)),
		remove: vi.fn((id: string) => listed.delete(id)),
		announce: vi.fn(),
		subtasksOf: () => subtasks
	} satisfies TicketListSync;
	const store = new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		{ ensureValid: () => true, logout: vi.fn() }
	);
	void catalog.load();
	store.open(ID);
	const onclose = vi.fn();
	const onback = vi.fn();
	render(TicketPanel, {
		props: {
			store,
			catalog,
			listHref: LIST,
			listLabel: 'Zur Liste',
			fullViewHref: FULL,
			onclose,
			onback,
			ondeleted: vi.fn()
		}
	});
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	await tick();
	const panel = screen.getByRole('complementary', { name: 'Steuererklärung' });
	return { panel, store, data, onclose, onback };
}

/** The head, the body and the footer of the side panel. */
function partsOf(panel: HTMLElement) {
	return {
		head: panel.querySelector<HTMLElement>('header.head') as HTMLElement,
		body: panel.querySelector<HTMLElement>('.body') as HTMLElement,
		foot: panel.querySelector<HTMLElement>('footer.foot')
	};
}

describe('the side panel as a page in the phone frame (Drawer)', () => {
	it('starts its head with the arrow back, without × and "Vollansicht"', async () => {
		useWindow(true, true);
		const onclose = vi.fn();
		const onback = vi.fn();
		render(DrawerHarness, {
			props: { onclose, onback, backLabel: 'Zum Eingang', fullViewHref: FULL }
		});
		const head = document.querySelector('header.head') as HTMLElement;
		const back = within(head).getByRole('button', { name: 'Zum Eingang' });
		expect(head.firstElementChild).toBe(back);
		expect(back.className).toContain('button-icon');
		expect(back.getAttribute('title')).toBe('Zum Eingang');
		expect(within(head).queryByRole('button', { name: 'Panel schließen' })).toBeNull();
		expect(within(head).queryByRole('link', { name: 'Vollansicht öffnen' })).toBeNull();
		// The actions of the owner and the footer stay.
		expect(within(head).getByRole('button', { name: 'Löschen …' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Anlegen' })).toBeTruthy();
		await fireEvent.click(back);
		expect(onback).toHaveBeenCalledOnce();
		expect(onclose).not.toHaveBeenCalled();
		// Escape keeps the way of the ×.
		await fireEvent.keyDown(screen.getByRole('heading', { name: 'Steuer abgeben' }), {
			key: 'Escape'
		});
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('names the arrow "Zurück" and closes like the × without a way of its own', async () => {
		useWindow(true, true);
		const onclose = vi.fn();
		render(DrawerHarness, { props: { onclose } });
		await fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
		expect(onclose).toHaveBeenCalledOnce();
	});

	it.each([
		['on a PC with the switch on', false, true],
		['on a phone with the switch off', true, false]
	])('keeps × and "Vollansicht" %s', (_case, narrow, enabled) => {
		useWindow(narrow, enabled);
		render(DrawerHarness, { props: { onclose: vi.fn(), onback: vi.fn(), fullViewHref: FULL } });
		expect(screen.getByRole('button', { name: 'Panel schließen' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Vollansicht öffnen' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();
	});
});

describe('the ticket as a page in the phone frame (MO-4)', () => {
	it('goes back through the arrow named like the way back, without "Vollansicht"', async () => {
		useWindow(true, true);
		const { panel, onback, onclose } = await renderPanel();
		const { head } = partsOf(panel);
		const back = within(head).getByRole('button', { name: 'Zur Liste' });
		expect(within(head).getByRole('button', { name: 'Weitere Aktionen' })).toBeTruthy();
		expect(within(head).queryByRole('link', { name: 'Vollansicht öffnen' })).toBeNull();
		expect(within(head).queryByRole('button', { name: 'Panel schließen' })).toBeNull();
		await fireEvent.click(back);
		expect(onback).toHaveBeenCalledOnce();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('shows the fields one below the other on the page and the status in the bar at the bottom', async () => {
		useWindow(true, true);
		const { panel } = await renderPanel();
		const { body, foot } = partsOf(panel);
		expect(body.querySelector('[data-ticket-option="status"]')).toBeNull();
		expect(body.querySelector('[data-ticket-option="priority"]')).not.toBeNull();
		expect(body.querySelector('[data-ticket-option="tags"]')).not.toBeNull();
		expect(foot).not.toBeNull();
		const bar = within(foot as HTMLElement);
		expect((bar.getByLabelText('Status') as HTMLSelectElement).value).toBe('open');
		const done = bar.getByRole('checkbox', { name: 'TASK-3 erledigt' });
		expect((done as HTMLInputElement).checked).toBe(false);
		// The visible word stands in the target of the check mark, the name stays the one of the list.
		expect(done.closest('label')?.textContent).toContain('Erledigt');
		// The status is one control with one marker: no new option (ticket-options-parity.test.ts).
		expect(panel.querySelectorAll('[data-ticket-option="status"]')).toHaveLength(1);
	});

	it('completes with one tap on "Erledigt" and opens again', async () => {
		useWindow(true, true);
		const { panel, data } = await renderPanel();
		const foot = partsOf(panel).foot as HTMLElement;
		await fireEvent.click(within(foot).getByRole('checkbox', { name: 'TASK-3 erledigt' }));
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(ID, expect.objectContaining({ status: 'done' }))
		);
		await vi.waitFor(() =>
			expect(
				(within(foot).getByRole('checkbox', { name: 'TASK-3 erledigt' }) as HTMLInputElement)
					.checked
			).toBe(true)
		);
		expect((within(foot).getByLabelText('Status') as HTMLSelectElement).value).toBe('done');
		await fireEvent.click(within(foot).getByRole('checkbox', { name: 'TASK-3 erledigt' }));
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenLastCalledWith(ID, expect.objectContaining({ status: 'open' }))
		);
	});

	it('asks about open sub-tasks in the bar, above "Erledigt"', async () => {
		useWindow(true, true);
		const { panel, data } = await renderPanel(ticket(), OPEN_SUBTASKS);
		const { body, foot } = partsOf(panel);
		await fireEvent.click(
			within(foot as HTMLElement).getByRole('checkbox', { name: 'TASK-3 erledigt' })
		);
		const question = await within(foot as HTMLElement).findByText(
			'2 Unteraufgaben sind noch offen – trotzdem erledigen?'
		);
		const row = question.closest('[data-status-questions]') as HTMLElement;
		expect(row.parentElement?.hasAttribute('data-ticket-bar')).toBe(true);
		expect(
			row.nextElementSibling?.contains(within(foot as HTMLElement).getByLabelText('Status'))
		).toBe(true);
		expect(body.querySelector('[data-status-questions]')).toBeNull();
		expect(data.update).not.toHaveBeenCalled();
	});

	it.each([
		['on a PC with the switch on', false, true],
		['on a phone with the switch off', true, false]
	])('keeps the panel of today %s', async (_case, narrow, enabled) => {
		useWindow(narrow, enabled);
		const { panel } = await renderPanel();
		const { head, body, foot } = partsOf(panel);
		expect(within(head).getByRole('button', { name: 'Panel schließen' })).toBeTruthy();
		expect(within(head).getByRole('link', { name: 'Vollansicht öffnen' })).toBeTruthy();
		expect(within(head).queryByRole('button', { name: 'Zur Liste' })).toBeNull();
		expect(foot).toBeNull();
		expect(body.querySelector('[data-ticket-option="status"]')).not.toBeNull();
		expect(screen.queryByRole('checkbox', { name: 'TASK-3 erledigt' })).toBeNull();
	});
});

describe('the menu of a card in the phone frame (MO-4)', () => {
	const OPEN = {
		panel: `/tickets/${ID}?sort=titel` as ResolvedPathname,
		full: FULL
	};

	function entries(): (string | undefined)[] {
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		return within(menu)
			.getAllByRole('menuitem', { hidden: true })
			.map((item) => item.textContent?.trim());
	}

	function renderMenu() {
		render(TicketActions, {
			props: {
				ticket: { id: ID, key: 'TASK-3' },
				flags: { show: vi.fn(() => 'flag'), dismiss: vi.fn() },
				open: OPEN,
				ondelete: vi.fn()
			}
		});
	}

	it('leaves out "In Vollansicht öffnen": the page shows the same parts', () => {
		useWindow(true, true);
		renderMenu();
		expect(entries().slice(0, 2)).toEqual(['Im Seitenpanel öffnen', 'Link kopieren']);
		expect(entries()).not.toContain('In Vollansicht öffnen');
	});

	it.each([
		['on a PC with the switch on', false, true],
		['on a phone with the switch off', true, false]
	])('offers both ways to open %s', (_case, narrow, enabled) => {
		useWindow(narrow, enabled);
		renderMenu();
		expect(entries().slice(0, 3)).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Link kopieren'
		]);
	});
});

/** The rules of the frame in the style of a component, the media query of the phone and the switch. */
function frameRules(file: string): string {
	const source = readFileSync(join(LIB, file), 'utf8');
	const start = source.indexOf('@media (max-width: 39.99rem)');
	expect(start, `${file} has a block of the phone frame`).toBeGreaterThan(-1);
	return source.slice(start);
}

describe('the rules of the page in the phone frame (static)', () => {
	it('lets the toolbar of the editor wrap with tools of 44 px', () => {
		const css = frameRules('components/editor/EditorToolbar.svelte');
		expect(css).toMatch(/\.toolbar \{\s*flex-wrap: wrap;/);
		expect(css).toMatch(
			/\.toolbar :global\(\.tool\.button-icon\) \{\s*width: var\(--control-height-touch\);\s*height: var\(--control-height-touch\);/
		);
		expect(css).toMatch(/\.source \{\s*height: var\(--control-height-touch\);/);
	});

	it('keeps the buttons that save or send at the bottom of the page above the keyboard', () => {
		for (const file of [
			'components/TicketDescription.svelte',
			'components/CommentForm.svelte',
			'components/CommentItem.svelte'
		]) {
			expect(frameRules(file), file).toMatch(/\.buttons \{\s*position: sticky;\s*bottom: 0;/);
		}
	});

	it('gives the tabs, the opener of a comment, the sub-tasks, the tags and the path 44 px', () => {
		expect(frameRules('components/TicketActivity.svelte')).toMatch(
			/\[role='tab'\] \{\s*min-height: var\(--control-height-touch\);/
		);
		expect(frameRules('components/CommentForm.svelte')).toMatch(
			/\.opener \{\s*min-height: var\(--control-height-touch\);/
		);
		const subtasks = frameRules('components/TicketSubtasks.svelte');
		expect(subtasks).toMatch(/\.check-target \{[^}]*min-width: var\(--control-height-touch\);/);
		expect(subtasks).toMatch(/\.child-title \{\s*line-height: var\(--control-height-touch\);/);
		expect(frameRules('components/TagPicker.svelte')).toMatch(
			/\.remove \{[^}]*min-width: var\(--control-height-touch\);\s*min-height: var\(--control-height-touch\);/
		);
		expect(frameRules('components/Breadcrumbs.svelte')).toMatch(
			/ a \{[^}]*min-height: var\(--control-height-touch\);/
		);
		expect(frameRules('components/MarkdownEditor.svelte')).toMatch(
			/\.modes button \{\s*min-height: var\(--control-height-touch\);/
		);
	});

	it('puts the fields one below the other and gives the tasks of the text an area of 44 px', () => {
		expect(frameRules('components/TicketFields.svelte')).toMatch(
			/\.fields \{\s*grid-template-columns: minmax\(0, 1fr\);/
		);
		const prose = frameRules('styles/prose.css');
		expect(prose).toMatch(/li\[data-task\] \{\s*padding-block: 0\.875rem;/);
		expect(prose).toMatch(
			/::after \{\s*position: absolute;\s*inset: calc\(\(var\(--control-height-touch\) - 1rem\) \/ -2\);/
		);
	});

	it('shows the panel over the full width also between 36 and 40rem, without a line at its edge', () => {
		expect(frameRules('components/ViewWithPanel.svelte')).toMatch(
			/\.covering \.panel \{\s*width: 100%;/
		);
		expect(frameRules('components/overlay/Drawer.svelte')).toMatch(
			/\.drawer \{\s*border-left: none;/
		);
	});
});
