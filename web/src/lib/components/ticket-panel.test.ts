// Component tests for the detail panel (E2 plan, package 7): Enter and blur save, Escape
// discards, removing the due date, "not found", Escape closes the panel, focus and attributes
// for accessibility. The store runs for real on a fake data layer.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeforeNavigate } from '@sveltejs/kit';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
import type { LiveSource, RecordChange } from '$lib/stores/realtime';
import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import type { Editor } from '@tiptap/core';
import FullViewRouteHarness from '$lib/test/FullViewRouteHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import TicketPanel from './TicketPanel.svelte';
import TicketLayout from '../../routes/(app)/(tickets)/tickets/[id]/+layout.svelte';

useOverlayStubs();
useProseMirrorStubs();

/** The editable element of the description editor once it has loaded (RT-3). */
function descriptionEditor(): Promise<HTMLElement> {
	return screen.findByRole('textbox', { name: 'Beschreibung' }, { timeout: 5000 });
}

/** The description as Markdown: the editor loads, then "Markdown" switches to the textarea. */
async function descriptionSource(): Promise<HTMLTextAreaElement> {
	await descriptionEditor();
	await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
	return screen.findByLabelText<HTMLTextAreaElement>('Beschreibung (Markdown)');
}

/** The route of a ticket (UI-7: its +layout.svelte) with the panel alone as child page. */
const renderTicketRoute = () =>
	render(TicketLayout, {
		props: { children: createRawSnippet(() => ({ render: () => '<span></span>' })) }
	});

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn(),
	page: {
		url: new URL('http://localhost:3000/tickets/abc123def456ghi?erledigte=1'),
		params: { id: 'abc123def456ghi' } as Record<string, string>,
		route: { id: '/(app)/(tickets)/tickets/[id]' }
	},
	detail: null as unknown,
	activity: null as unknown,
	catalog: null as unknown,
	// "Duplizieren …" (ADR-0045) shows only with the store of the (app) layout; null hides it.
	duplicates: null as unknown,
	// The section "Unteraufgaben" (ADR-0033) is covered in ticket-subtasks.test.ts; here the ticket
	// has none.
	tickets: {
		markRead: vi.fn(async () => undefined),
		today: '2026-09-25',
		// Open tickets for the open instances of a series ("Wiederholt sich").
		open: [] as unknown[],
		upsert: vi.fn(),
		find: () => null,
		subtasksOf: () => [],
		progressOf: () => ({ done: 0, total: 0 }),
		isChecked: () => false,
		isPending: () => false,
		setDone: vi.fn(async () => undefined),
		addSubtask: vi.fn(async () => ({ ok: false as const, message: null }))
	}
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto, beforeNavigate: mocks.beforeNavigate }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/ticket-detail.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketDetailStore: () => mocks.detail
}));
vi.mock('$lib/stores/ticket-activity.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketActivityStore: () => mocks.activity
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/ticket-duplicate.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findTicketDuplicateStore: () => mocks.duplicates
}));
// The route shows "Wiederholen…" (E5 plan, package 4); rules are covered in
// recurrence-summary.test.ts, here the store stays unloaded.
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/recurrence.svelte')>();
	const store = new original.RecurrenceStore(
		{
			listRules: async () => [],
			createRule: vi.fn(),
			updateRule: vi.fn(),
			setActive: vi.fn(),
			deleteRule: vi.fn(),
			detachTicket: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	return { ...original, getRecurrenceStore: () => store };
});
// The section "Quellen" (ADR-0031) is covered in ticket-sources.test.ts; here the ticket has none.
vi.mock('$lib/stores/ticket-sources.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/ticket-sources.svelte')>();
	const store = new original.TicketSourcesStore(
		{
			list: async () => [],
			link: vi.fn(),
			release: vi.fn(),
			originalUrl: async () => null
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	return { ...original, getTicketSourcesStore: () => store };
});
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newItems: [] })
}));

const ID = 'abc123def456ghi';
const LIST = '/?erledigte=1' as ResolvedPathname;
const PANEL_ROUTE = '/(app)/(tickets)/tickets/[id]';
const FULL_ROUTE = '/(app)/(tickets)/tickets/[id]/voll';

/**
 * The store of the (app) layout that remembers panel or full view (plan BI-1), over a window whose
 * storage is the one of jsdom and whose width is `wide` (from 64rem) or not.
 */
function openModeStore({
	stored = null,
	wide = true
}: { stored?: string | null; wide?: boolean } = {}) {
	if (stored === null) localStorage.removeItem('byl-ticket-open');
	else localStorage.setItem('byl-ticket-open', stored);
	const media = { matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() };
	const win = {
		localStorage,
		matchMedia: () => media,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as Window;
	return new TicketOpenModeStore(win);
}

// Tests of the full view switch the route; every other test sees the panel route.
afterEach(() => {
	mocks.page.route = { id: PANEL_ROUTE };
	mocks.duplicates = null;
});

/** The store of "Duplizieren …" (ADR-0045) on a fake route that answers the duplicate TASK-4. */
function duplicateStore() {
	const data = {
		duplicate: vi.fn(async () => ({
			id: 'dupl00000000013',
			key: 'TASK-4',
			title: 'Steuererklärung (Kopie)',
			original: { id: ID, key: 'TASK-3' },
			subtasks: [],
			comments: 0,
			source: null
		}))
	};
	const store = new TicketDuplicateStore(data, { ensureValid: () => true, logout: vi.fn() });
	mocks.duplicates = store;
	return { store, data };
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Steuererklärung',
		description: '**Belege** sammeln',
		sourceItem: null,
		status: 'in_progress',
		priority: 'high',
		due: '2026-10-01',
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

/** Projects of the fake catalog and server (E3 plan, T-13). */
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const OLD: Project = {
	id: 'proj00000000002',
	name: 'Altbau',
	code: 'ALT',
	archived: true,
	updated: '2026-09-01 10:00:00.000Z'
};

/** A catalog with the given projects, loaded synchronously enough for the tests. */
function catalogOf(
	projects: Project[] = [],
	tags: Tag[] = [],
	data: Partial<CatalogData> = {}
): CatalogStore {
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => projects),
			listTags: vi.fn(async () => tags),
			createTag: vi.fn<CatalogData['createTag']>(),
			...data
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	void catalog.load();
	return catalog;
}

/** Applies a patch like the server: `project` is an ID and changes the key. */
function applyPatch(current: Ticket, { project, tags, ...fields }: TicketPatch): Ticket {
	const next: Ticket = { ...current, ...fields };
	if (tags !== undefined) {
		next.tagIds = [...tags];
		next.tags = tags.map((id) => ({ id, name: id }));
	}
	if (project === undefined) return next;
	const ref = [HOUSE, OLD].find((entry) => entry.id === project) ?? null;
	return {
		...next,
		projectId: project,
		project: ref,
		key: ref === null ? 'TASK-10' : `${ref.code}-1`
	};
}

function createStore(initial: Ticket = ticket()) {
	let current = initial;
	let clock = 0;
	const data = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			clock += 1;
			current = { ...applyPatch(current, patch), updated: `2026-09-24 10:00:0${clock}.000Z` };
			return current;
		}),
		create: vi.fn(),
		delete: vi.fn()
	} satisfies TicketDetailData;
	const listTickets = new SvelteMap<string, TicketSummary>();
	const list = {
		find: (id: string) => listTickets.get(id) ?? null,
		upsert: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
		completed: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
		remove: vi.fn((id: string) => listTickets.delete(id)),
		announce: vi.fn()
	} satisfies TicketListSync;
	const store = new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
	return { store, data, list };
}

async function renderPanel(initial?: Ticket, props: Record<string, unknown> = {}) {
	const context = createStore(initial);
	const onclose = vi.fn();
	context.store.open(ID);
	const result = render(TicketPanel, {
		props: {
			store: context.store,
			catalog: catalogOf(),
			listHref: LIST,
			onclose,
			ondeleted: vi.fn(),
			...props
		}
	});
	await vi.waitFor(() => expect(context.store.state).not.toBe('loading'));
	await tick();
	return { ...result, ...context, onclose };
}

function heading() {
	return screen.getByRole('heading', { level: 2 });
}

/** An entry of the menu "•••" in the header (plan aktionsmenues); jsdom shows popovers as hidden. */
function actionEntry(scope: HTMLElement, name: string) {
	const trigger = within(scope).getByRole('button', { name: 'Weitere Aktionen' });
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
	if (menu === null) throw new Error('No menu "•••"');
	return { trigger, entry: within(menu).getByRole('menuitem', { name, hidden: true }) };
}

/**
 * Chooses an entry of the menu "•••" like a browser does: the menu opens from its focused button,
 * and the entry closes it first, which puts the focus back on the button. Returns the button.
 */
async function chooseAction(scope: HTMLElement, name: string) {
	const { trigger, entry } = actionEntry(scope, name);
	trigger.focus();
	await fireEvent.click(trigger);
	await tick();
	await fireEvent.click(entry);
	await tick();
	return trigger;
}

beforeEach(() => {
	mocks.goto.mockClear();
});

describe('ticket panel', () => {
	it('shows the ticket and moves the focus to its heading', async () => {
		await renderPanel(
			ticket({
				projectId: 'p1',
				project: { id: 'p1', name: 'Finanzen', code: 'FIN', archived: false },
				tagIds: ['g1'],
				tags: [{ id: 'g1', name: 'Amt' }],
				recurring: true
			})
		);

		const panel = screen.getByRole('complementary', { name: 'Steuererklärung' });
		expect(within(panel).getByText('TASK-3')).toBeTruthy();
		expect(document.activeElement).toBe(heading());
		expect(screen.getByLabelText<HTMLSelectElement>('Status').value).toBe('in_progress');
		expect(screen.getByLabelText<HTMLSelectElement>('Priorität').value).toBe('high');
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('2026-10-01');
		expect(panel.querySelector('.markdown strong')?.textContent).toBe('Belege');
		const project = screen.getByLabelText<HTMLSelectElement>('Projekt');
		expect(project.selectedOptions[0]?.textContent?.trim()).toBe('Finanzen (FIN)');
		expect(within(panel).getByText('Amt')).toBeTruthy();
		expect(within(panel).getByText('wiederkehrend')).toBeTruthy();
		expect(within(panel).getByText('01.09.2026 12:00')).toBeTruthy();
		expect(within(panel).getByText('02.09.2026 14:30')).toBeTruthy();
		expect(within(panel).queryByText('Erledigt am')).toBeNull();
	});

	it('shows "Kein Projekt", no tags and no recurrence when the ticket has none', async () => {
		await renderPanel(ticket({ description: '' }));

		expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe('');
		expect(screen.queryByRole('list', { name: 'Gewählte Tags' })).toBeNull();
		expect(screen.queryByText('wiederkehrend')).toBeNull();
		expect(screen.getByText('Keine Beschreibung.')).toBeTruthy();
	});

	it('shows "Erledigt am" for done tickets', async () => {
		await renderPanel(ticket({ status: 'done', completedAt: '2026-09-20 08:15:00.000Z' }));

		expect(screen.getByText('Erledigt am')).toBeTruthy();
		expect(screen.getByText('20.09.2026 10:15')).toBeTruthy();
	});

	it('saves the title with Enter and returns the focus', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Titel bearbeiten' }));
		const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Titel' });
		expect(document.activeElement).toBe(input);
		expect(input.maxLength).toBe(200);
		await fireEvent.input(input, { target: { value: 'Steuererklärung 2026' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await vi.waitFor(() => expect(heading().textContent).toBe('Steuererklärung 2026'));

		expect(data.update).toHaveBeenCalledExactlyOnceWith(ID, { title: 'Steuererklärung 2026' });
		await tick();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Titel bearbeiten' }));
	});

	it('saves the title when the field is left', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Titel bearbeiten' }));
		const input = screen.getByRole('textbox', { name: 'Titel' });
		await fireEvent.input(input, { target: { value: 'Neu' } });
		await fireEvent.blur(input);

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { title: 'Neu' }));
	});

	it('discards the title with Escape and keeps the panel open', async () => {
		const { data, onclose } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Titel bearbeiten' }));
		const input = screen.getByRole('textbox', { name: 'Titel' });
		await fireEvent.input(input, { target: { value: 'Verworfen' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(heading().textContent).toBe('Steuererklärung');
		expect(data.update).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('rejects an empty title with an error linked to the field', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Titel bearbeiten' }));
		const input = screen.getByRole('textbox', { name: 'Titel' });
		await fireEvent.input(input, { target: { value: '  ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(data.update).not.toHaveBeenCalled();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const error = document.getElementById(input.getAttribute('aria-describedby') ?? '');
		expect(error?.textContent).toBe('Der Titel darf nicht leer sein.');
		expect(error?.classList.contains('field-error')).toBe(true);
		expect(error?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
	});

	it('saves status and priority when chosen', async () => {
		const { data } = await renderPanel();

		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'waiting' } });
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'low' } });

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledTimes(2));
		expect(data.update.mock.calls.map((call) => call[1])).toEqual([
			{ status: 'waiting' },
			{ priority: 'low' }
		]);
	});

	it('shows a server error at the field', async () => {
		const { data } = await renderPanel();
		data.update.mockRejectedValueOnce(new DataError('network'));

		const select = screen.getByLabelText<HTMLSelectElement>('Status');
		await fireEvent.change(select, { target: { value: 'waiting' } });

		await vi.waitFor(() => expect(select.getAttribute('aria-invalid')).toBe('true'));
		expect(select.value).toBe('in_progress');
		const error = document.getElementById(select.getAttribute('aria-describedby') ?? '');
		expect(error?.textContent).toMatch(/Server nicht erreichbar/);
	});

	it('saves the due date when the field is left and removes it with the icon button "Fälligkeit entfernen"', async () => {
		const { data } = await renderPanel();

		const input = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: '2026-12-24' } });
		await fireEvent.blur(input);
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { due: '2026-12-24' }));

		const remove = screen.getByRole('button', { name: 'Fälligkeit entfernen' });
		expect(remove.classList.contains('button-icon')).toBe(true);
		expect(remove.getAttribute('title')).toBe('Fälligkeit entfernen');
		expect(remove.textContent?.trim()).toBe('');
		expect(
			screen.queryAllByRole('button').filter((button) => /Entfernen/.test(button.textContent ?? ''))
		).toEqual([]);

		await fireEvent.click(remove);
		await vi.waitFor(() => expect(data.update).toHaveBeenLastCalledWith(ID, { due: null }));
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('');
		expect(screen.queryByRole('button', { name: 'Fälligkeit entfernen' })).toBeNull();
	});

	it('restores the due date with Escape', async () => {
		const { data } = await renderPanel();

		const input = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: '2026-12-24' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(input.value).toBe('2026-10-01');
		expect(data.update).not.toHaveBeenCalled();
	});

	it('edits the description in the editor and saves only a changed text (RT-3)', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		const content = await descriptionEditor();
		await vi.waitFor(() => expect(document.activeElement).toBe(content));
		const editor = (content as HTMLElement & { editor: Editor }).editor;
		expect(editor.getHTML()).toBe('<p><strong>Belege</strong> sammeln</p>');

		// Opened and saved unchanged: no request, the editor closes.
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(screen.queryByRole('textbox', { name: 'Beschreibung' })).toBeNull()
		);
		expect(data.update).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		const again = await descriptionEditor();
		const next = (again as HTMLElement & { editor: Editor }).editor;
		next.commands.focus('end');
		typeText(next.view, ' heute');
		await fireEvent.keyDown(again, { key: 'Enter', ctrlKey: true });
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				ID,
				{ description: '**Belege** sammeln heute' },
				{ expectedUpdated: '2026-09-02 12:30:00.000Z' }
			)
		);
	});

	it('edits the description as Markdown, saves with Ctrl+Enter and cancels', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		const text = await descriptionSource();
		expect(document.activeElement).toBe(text);
		expect(text.value).toBe('**Belege** sammeln');
		expect(text.maxLength).toBe(100_000);
		await fireEvent.input(text, { target: { value: '# Neu' } });
		await fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true });
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				ID,
				{ description: '# Neu' },
				{ expectedUpdated: '2026-09-02 12:30:00.000Z' }
			)
		);
		await tick();
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Neu');

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		await fireEvent.input(await descriptionSource(), {
			target: { value: 'verworfen' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(screen.queryByLabelText('Beschreibung (Markdown)')).toBeNull();
		expect(data.update).toHaveBeenCalledOnce();
		await tick();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' })
		);
	});

	it('ticks a task of the description in the view (ADR-0032 section 6)', async () => {
		const { data } = await renderPanel(ticket({ description: '- [ ] Belege\n- [ ] Formular' }));

		const task = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Formular' });
		expect(task.disabled).toBe(false);
		await fireEvent.click(task);

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				ID,
				{ description: '- [ ] Belege\n- [x] Formular' },
				{ expectedUpdated: '2026-09-02 12:30:00.000Z' }
			)
		);
		await vi.waitFor(() =>
			expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Formular' }).checked).toBe(
				true
			)
		);
	});

	it('puts a task back and says why when the description changed meanwhile', async () => {
		const { data } = await renderPanel(ticket({ description: '- [ ] Belege' }));
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					description: {
						code: 'validation_description_stale',
						message: 'Die Beschreibung wurde inzwischen geändert.'
					}
				}
			})
		);
		data.get.mockResolvedValueOnce(
			ticket({ description: '- [ ] Belege\n- [ ] Neu', updated: '2026-09-03 08:00:00.000Z' })
		);

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Belege' }));

		expect(await screen.findByRole('alert')).toHaveProperty(
			'textContent',
			'Die Beschreibung wurde inzwischen geändert. Bitte erneut abhaken.'
		);
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Belege' }).checked).toBe(false);
		expect(screen.getByRole('checkbox', { name: 'Neu' })).toBeTruthy();
	});

	it('asks inline before overwriting a description that changed while editing', async () => {
		const { store, data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		await fireEvent.input(await descriptionSource(), {
			target: { value: 'Mein Text' }
		});
		store.upsert(ticket({ description: 'Anderer Text', updated: '2026-09-03 08:00:00.000Z' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		const question = await screen.findByRole('heading', {
			name: /Die Beschreibung wurde inzwischen geändert/
		});
		expect(question).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
		expect(screen.queryByRole('dialog', { name: /geändert/ })).toBeNull();
		expect(data.update).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Überschreiben' }));

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				ID,
				{ description: 'Mein Text' },
				{ expectedUpdated: '2026-09-03 08:00:00.000Z' }
			)
		);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' })
			)
		);
	});

	it('discards the draft and shows the newer description when asked to', async () => {
		const { store, data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		await fireEvent.input(await descriptionSource(), {
			target: { value: 'Mein Text' }
		});
		store.upsert(ticket({ description: 'Anderer Text', updated: '2026-09-03 08:00:00.000Z' }));
		data.get.mockResolvedValueOnce(
			ticket({ description: 'Anderer Text', updated: '2026-09-03 08:00:00.000Z' })
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen und neu laden' }));

		await vi.waitFor(() => expect(screen.queryByLabelText('Beschreibung (Markdown)')).toBeNull());
		expect(screen.getByText('Anderer Text')).toBeTruthy();
		expect(data.update).not.toHaveBeenCalled();
	});

	it('closes with Escape and with × "Panel schließen", but not from a form field', async () => {
		const { onclose } = await renderPanel();

		await fireEvent.keyDown(screen.getByLabelText('Status'), { key: 'Escape' });
		expect(onclose).not.toHaveBeenCalled();

		await fireEvent.keyDown(heading(), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});

	it('shows "Ticket nicht gefunden" with a link to the list', async () => {
		const context = createStore();
		context.data.get.mockRejectedValueOnce(new DataError('not_found'));
		context.store.open('unknown00000000');
		render(TicketPanel, {
			props: {
				store: context.store,
				catalog: catalogOf(),
				listHref: LIST,
				onclose: vi.fn(),
				ondeleted: vi.fn()
			}
		});
		await vi.waitFor(() => expect(context.store.state).toBe('not_found'));
		await tick();

		expect(heading().textContent).toBe('Ticket nicht gefunden');
		expect(document.activeElement).toBe(heading());
		expect(screen.getByRole('link', { name: 'Zur Liste' }).getAttribute('href')).toBe(LIST);
	});

	it('shows a loading error with "Erneut versuchen"', async () => {
		const context = createStore();
		context.data.get.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		context.store.open(ID);
		render(TicketPanel, {
			props: {
				store: context.store,
				catalog: catalogOf(),
				listHref: LIST,
				onclose: vi.fn(),
				ondeleted: vi.fn()
			}
		});
		await vi.waitFor(() => expect(context.store.state).toBe('error'));
		await tick();

		expect(
			screen.getByText(/Der Server hat mit einem Fehler geantwortet/).closest('.alert-error')
		).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() => expect(heading().textContent).toBe('Steuererklärung'));
	});

	it('renders the activity area below the fields when given', async () => {
		const activity = createRawSnippet(() => ({ render: () => '<section>Aktivität</section>' }));
		await renderPanel(undefined, { activity });

		expect(screen.getByText('Aktivität')).toBeTruthy();
	});
});

describe('ticket panel: project (E3 plan, T-13)', () => {
	async function renderWithProjects(initial?: Ticket) {
		const catalog = catalogOf([HOUSE, OLD]);
		await vi.waitFor(() => expect(catalog.state).toBe('ready'));
		const result = await renderPanel(initial, { catalog });
		return { ...result, select: screen.getByLabelText<HTMLSelectElement>('Projekt') };
	}

	function options(select: HTMLSelectElement) {
		return [...select.options].map((option) => [option.value, option.textContent?.trim()]);
	}

	it('offers "Kein Projekt" and the active projects with a hint about the key', async () => {
		const { select } = await renderWithProjects();

		expect(options(select)).toEqual([
			['', 'Kein Projekt'],
			[HOUSE.id, 'Haushalt (HAUS)']
		]);
		const hint = screen.getByText('Beim Wechsel bekommt das Ticket einen neuen Key.');
		expect(select.getAttribute('aria-describedby')).toBe(hint.id);
	});

	it('keeps an assigned archived project visible as "archiviert"', async () => {
		const { select } = await renderWithProjects(
			ticket({ key: 'ALT-1', projectId: OLD.id, project: OLD })
		);

		expect(options(select)).toEqual([
			['', 'Kein Projekt'],
			[HOUSE.id, 'Haushalt (HAUS)'],
			[OLD.id, 'Altbau (ALT, archiviert)']
		]);
		expect(select.value).toBe(OLD.id);
	});

	it('saves at once, shows the new key and announces it; the URL stays', async () => {
		const { select, data, list } = await renderWithProjects();

		await fireEvent.change(select, { target: { value: HOUSE.id } });
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { project: HOUSE.id }));
		await tick();

		const panel = screen.getByRole('complementary');
		expect(within(panel).getByText('HAUS-1')).toBeTruthy();
		expect(select.value).toBe(HOUSE.id);
		expect(list.announce).toHaveBeenCalledWith('Neuer Key: HAUS-1');
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows a server error at the field and returns to the old value', async () => {
		const { select, data } = await renderWithProjects();
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			})
		);

		await fireEvent.change(select, { target: { value: HOUSE.id } });
		const error = await screen.findByText('Das Projekt ist archiviert.');

		expect(select.value).toBe('');
		expect(select.getAttribute('aria-invalid')).toBe('true');
		expect(select.getAttribute('aria-describedby')).toContain(error.closest('p')?.id);
		expect(error.closest('p')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
	});
});

describe('ticket panel: color (ADR-0052)', () => {
	const BLUE_HOUSE: Project = { ...HOUSE, color: 'blau' };

	async function renderColored(initial: Ticket) {
		const catalog = catalogOf([BLUE_HOUSE]);
		await vi.waitFor(() => expect(catalog.state).toBe('ready'));
		return renderPanel(initial, { catalog });
	}

	const group = () => screen.getByRole('radiogroup', { name: 'Farbe' });
	const mark = () => document.querySelector<HTMLElement>('.color-mark');

	it('shows the color in the header and offers the own color after the project, "Wie Projekt (Blau)" first', async () => {
		await renderColored(ticket({ projectId: HOUSE.id, project: BLUE_HOUSE, color: null }));
		expect(mark()?.getAttribute('title')).toBe('Farbe Blau, vom Projekt „Haushalt“');
		expect(mark()?.closest('header')).not.toBeNull();
		const radios = within(group()).getAllByRole<HTMLInputElement>('radio');
		expect(radios.map((radio) => radio.labels?.[0]?.textContent?.trim())).toEqual([
			'Wie Projekt (Blau)',
			'Violett',
			'Indigo',
			'Blau',
			'Himmelblau',
			'Türkis',
			'Grün',
			'Oliv',
			'Senf',
			'Braun',
			'Grau'
		]);
		expect(
			within(group()).getByRole<HTMLInputElement>('radio', { name: 'Wie Projekt (Blau)' }).checked
		).toBe(true);
	});

	it('saves an own color at once and back to "wie Projekt" as null', async () => {
		const { data } = await renderColored(
			ticket({ projectId: HOUSE.id, project: BLUE_HOUSE, color: null })
		);
		await fireEvent.click(within(group()).getByRole('radio', { name: 'Grün' }));
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { color: 'gruen' }));
		await vi.waitFor(() => expect(mark()?.getAttribute('title')).toBe('Farbe Grün'));
		expect(within(group()).getByRole<HTMLInputElement>('radio', { name: 'Grün' }).checked).toBe(
			true
		);

		await fireEvent.click(within(group()).getByRole('radio', { name: 'Wie Projekt (Blau)' }));
		await vi.waitFor(() => expect(data.update).toHaveBeenLastCalledWith(ID, { color: null }));
	});

	it('shows a refusal of the server at the group', async () => {
		const { data } = await renderColored(ticket({ color: null }));
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { color: { code: 'validation_invalid_value', message: 'Ungültiger Wert.' } }
			})
		);
		await fireEvent.click(within(group()).getByRole('radio', { name: 'Senf' }));
		const error = await screen.findByText('Ungültiger Wert.');
		expect(group().getAttribute('aria-describedby')).toContain(error.closest('p')?.id);
		// The stored value shows again: "Wie Projekt (keine)" without a project.
		expect(
			within(group()).getByRole<HTMLInputElement>('radio', { name: 'Wie Projekt (keine)' }).checked
		).toBe(true);
	});

	it('offers no color and shows none while the server does not know the field', async () => {
		await renderColored(ticket({ projectId: HOUSE.id, project: BLUE_HOUSE }));
		expect(screen.queryByRole('radiogroup', { name: 'Farbe' })).toBeNull();
		// The project knows its color, so the header still shows it.
		expect(mark()?.getAttribute('title')).toBe('Farbe Blau, vom Projekt „Haushalt“');
	});
});

describe('ticket panel: charm (ADR-0062)', () => {
	const charmMark = () => document.querySelector<HTMLElement>('.title .charm-mark');

	it('shows the charm before the title, outside of the heading, and its button in the fields', async () => {
		await renderPanel(ticket({ charm: 'geburtstag' }));
		expect(charmMark()?.getAttribute('title')).toBe('Charm: Geburtstag');
		expect(charmMark()?.textContent?.trim()).toBe('Charm: Geburtstag');
		expect(charmMark()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		expect(heading().textContent).toBe('Steuererklärung');
		expect(heading().contains(charmMark())).toBe(false);
		expect(charmMark()?.nextElementSibling).toBe(heading());
		expect(screen.getByRole('button', { name: 'Charm: Geburtstag' })).toBeTruthy();
	});

	it('saves a chosen charm at once and removes it with "Kein Charm"', async () => {
		const { data } = await renderPanel(ticket({ charm: null }));
		expect(charmMark()).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Charm wählen' }));
		await tick();
		await fireEvent.click(
			document.querySelector('[data-charm-option="flugzeug"]') as HTMLButtonElement
		);
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { charm: 'flugzeug' }));
		await vi.waitFor(() => expect(charmMark()?.getAttribute('title')).toBe('Charm: Flugzeug'));

		await fireEvent.click(screen.getByRole('button', { name: 'Charm: Flugzeug' }));
		await tick();
		await fireEvent.click(
			document.querySelector('[data-charm-option="none"]') as HTMLButtonElement
		);
		await vi.waitFor(() => expect(data.update).toHaveBeenLastCalledWith(ID, { charm: null }));
		await vi.waitFor(() => expect(charmMark()).toBeNull());
	});

	it('shows a refusal of the server at the button', async () => {
		const { data } = await renderPanel(ticket({ charm: null }));
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					charm: {
						code: 'validation_charm_unknown',
						message: 'Diesen Charm gibt es nicht. Bitte einen aus der Liste wählen.'
					}
				}
			})
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Charm wählen' }));
		await tick();
		await fireEvent.click(document.querySelector('[data-charm-option="zug"]') as HTMLButtonElement);
		const error = await screen.findByText(
			'Diesen Charm gibt es nicht. Bitte einen aus der Liste wählen.'
		);
		expect(
			screen.getByRole('button', { name: 'Charm wählen' }).getAttribute('aria-describedby')
		).toBe(error.closest('p')?.id);
	});

	it('offers no charm while the server does not know the field', async () => {
		await renderPanel(ticket());
		expect(screen.queryByRole('button', { name: 'Charm wählen' })).toBeNull();
		expect(charmMark()).toBeNull();
	});
});

describe('ticket panel: tags (E3 plan, T-14)', () => {
	const GARDEN: Tag = {
		id: 'tag000000000001',
		name: 'Garten',
		updated: '2026-09-01 10:00:00.000Z'
	};
	const CALL: Tag = { id: 'tag000000000002', name: 'anrufen', updated: '2026-09-01 10:00:00.000Z' };

	async function renderWithTags(initial?: Ticket, data: Partial<CatalogData> = {}) {
		const catalog = catalogOf([], [GARDEN, CALL], data);
		await vi.waitFor(() => expect(catalog.state).toBe('ready'));
		const result = await renderPanel(initial, { catalog });
		return {
			...result,
			catalog,
			input: screen.getByRole<HTMLInputElement>('combobox', { name: 'Tags' })
		};
	}

	function chips() {
		const list = screen.queryByRole('list', { name: 'Gewählte Tags' });
		return list
			? within(list)
					.getAllByRole('listitem')
					.map((chip) => chip.textContent?.trim())
			: [];
	}

	it('shows the tags of the ticket with names from the catalog', async () => {
		await renderWithTags(ticket({ tagIds: [GARDEN.id], tags: [{ id: GARDEN.id, name: 'alt' }] }));

		expect(chips()).toEqual(['Garten']);
	});

	it('adds a tag by keyboard and saves the whole list at once', async () => {
		const { input, data } = await renderWithTags(ticket({ tagIds: [GARDEN.id] }));

		await fireEvent.input(input, { target: { value: 'anr' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(ID, { tags: [GARDEN.id, CALL.id] })
		);
		await tick();
		expect(chips()).toEqual(['Garten', 'anrufen']);
		expect(input.value).toBe('');
	});

	it('takes a pasted list of tags one after the other, regardless of case', async () => {
		const { input, data } = await renderWithTags(ticket({ tagIds: [] }));

		await fireEvent.paste(input, { clipboardData: { getData: () => 'garten, ANRUFEN' } });

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenLastCalledWith(ID, { tags: [GARDEN.id, CALL.id] })
		);
		expect(data.update).toHaveBeenCalledWith(ID, { tags: [GARDEN.id] });
		await vi.waitFor(() => expect(chips()).toEqual(['Garten', 'anrufen']));
		expect(input.value).toBe('');
	});

	it('brings the last tag back as text with Backspace in the empty input', async () => {
		const { input, data } = await renderWithTags(ticket({ tagIds: [GARDEN.id, CALL.id] }));

		await fireEvent.keyDown(input, { key: 'Backspace' });

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { tags: [GARDEN.id] }));
		await vi.waitFor(() => expect(input.value).toBe('anrufen'));
		expect(chips()).toEqual(['Garten']);
	});

	it('removes a tag by keyboard and puts the focus into the input', async () => {
		const { input, data } = await renderWithTags(ticket({ tagIds: [GARDEN.id, CALL.id] }));

		const remove = screen.getByRole('button', { name: 'Tag Garten entfernen' });
		remove.focus();
		await fireEvent.click(remove);

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { tags: [CALL.id] }));
		await tick();
		expect(chips()).toEqual(['anrufen']);
		expect(document.activeElement).toBe(input);
	});

	it('creates a new tag once and assigns it', async () => {
		const created: Tag = {
			id: 'tag000000000009',
			name: 'Steuer',
			updated: '2026-09-24 10:00:00.000Z'
		};
		const createTag = vi.fn(async () => created);
		const { input, data } = await renderWithTags(undefined, { createTag });

		await fireEvent.input(input, { target: { value: ' Steuer ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { tags: [created.id] }));
		expect(createTag).toHaveBeenCalledExactlyOnceWith('Steuer');
		await tick();
		expect(chips()).toEqual(['Steuer']);
	});

	it('takes the existing tag when the server reports the name as taken', async () => {
		const other: Tag = {
			id: 'tag000000000009',
			name: 'steuer',
			updated: '2026-09-24 10:00:00.000Z'
		};
		const listTags = vi
			.fn<CatalogData['listTags']>()
			.mockResolvedValueOnce([GARDEN, CALL])
			.mockResolvedValue([GARDEN, CALL, other]);
		const createTag = vi.fn(async (): Promise<Tag> => {
			throw new DataError('validation', {
				status: 400,
				fields: { name: { code: 'validation_not_unique', message: 'Schon vergeben.' } }
			});
		});
		const { input, data } = await renderWithTags(undefined, { listTags, createTag });

		await fireEvent.input(input, { target: { value: 'Steuer' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { tags: [other.id] }));
		expect(createTag).toHaveBeenCalledOnce();
	});

	it('shows a failed save at the field and keeps the tags', async () => {
		const { input, data } = await renderWithTags(ticket({ tagIds: [GARDEN.id] }));
		data.update.mockRejectedValueOnce(new DataError('network'));

		await fireEvent.input(input, { target: { value: 'anr' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		const error = await screen.findByText(/Server nicht erreichbar/);
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toContain(error.closest('p')?.id);
		expect(chips()).toEqual(['Garten']);
		expect(input.value).toBe('anr');
	});

	it('lets Escape in the tag input close the suggestions, not the panel', async () => {
		const { input, onclose } = await renderWithTags();

		await fireEvent.input(input, { target: { value: 'gar' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(input.value).toBe('');
		expect(onclose).not.toHaveBeenCalled();
	});
});

function activityStore() {
	const data = {
		listComments: vi.fn(async () => []),
		createComment: vi.fn(),
		updateComment: vi.fn(),
		deleteComment: vi.fn(),
		listHistory: vi.fn(async () => [])
	} satisfies TicketActivityData;
	return new TicketActivityStore(data, { ensureValid: () => true, logout: vi.fn() }, () => 'me');
}

beforeEach(() => {
	mocks.catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		{ ensureValid: () => true, logout: vi.fn() }
	);
});

describe('ticket route', () => {
	it('opens the ticket of the URL and closes back to the list with the same query', async () => {
		const { store } = createStore();
		const open = vi.spyOn(store, 'open');
		mocks.detail = store;
		const activity = activityStore();
		const openComments = vi.spyOn(activity, 'open');
		mocks.activity = activity;

		const { unmount } = renderTicketRoute();
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		expect(open).toHaveBeenCalledWith(ID);
		expect(openComments).toHaveBeenCalledWith(ID);
		await vi.waitFor(() => expect(screen.getByText('Noch keine Kommentare')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/?erledigte=1');

		unmount();
		expect(store.state).toBe('idle');
		expect(activity.ticketId).toBeNull();
	});

	it('offers "Duplizieren …" in the menu "•••" and opens the duplicate in the panel (ADR-0045, AM-1)', async () => {
		const { data } = duplicateStore();
		const { store } = createStore();
		mocks.detail = store;
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		// The header keeps only the menu, "Vollansicht" and × as symbols (plan aktionsmenues).
		const panel = screen.getByRole('complementary', { name: 'Steuererklärung' });
		const header = panel.querySelector('header');
		const controls = [...(header?.querySelectorAll(':scope a, :scope button') ?? [])].filter(
			(element) => element.closest('[popover]') === null
		);
		expect(controls.map((element) => element.getAttribute('aria-label'))).toEqual([
			'Weitere Aktionen',
			'Vollansicht öffnen',
			'Panel schließen'
		]);
		expect(screen.queryByRole('button', { name: 'Duplizieren …' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();

		// "Abbrechen" gives the focus back to the button of the menu.
		const trigger = await chooseAction(document.body, 'Duplizieren …');
		const first = screen.getByRole('dialog', { name: 'TASK-3 duplizieren' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(first).getByLabelText('Titel'))
		);
		await fireEvent.click(within(first).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'TASK-3 duplizieren' })).toBeNull();
		expect(document.activeElement).toBe(trigger);

		await chooseAction(document.body, 'Duplizieren …');
		const dialog = screen.getByRole('dialog', { name: 'TASK-3 duplizieren' });
		expect(within(dialog).getByLabelText<HTMLInputElement>('Titel').value).toBe(
			'Steuererklärung (Kopie)'
		);
		await fireEvent.click(
			within(dialog).getByRole('radio', { name: 'Wie das Original: In Arbeit' })
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Duplizieren' }));

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/dupl00000000013?erledigte=1')
		);
		expect(data.duplicate).toHaveBeenCalledWith(
			ID,
			expect.objectContaining({ status: 'in_progress' })
		);
		expect(screen.queryByRole('dialog', { name: 'TASK-3 duplizieren' })).toBeNull();
	});
});

describe('ticket route: sub-tasks (ADR-0033)', () => {
	const PARENT = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };

	it('shows the section "Unteraufgaben" for a top-level ticket after the description', async () => {
		const context = createStore();
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));

		const panel = screen.getByRole('complementary');
		const section = within(panel).getByRole('region', { name: 'Unteraufgaben' });
		expect(within(section).getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeTruthy();
		expect(within(panel).queryByRole('navigation', { name: 'Pfad des Tickets' })).toBeNull();
		const row = within(panel).getByRole('group', { name: 'Übergeordnet' });
		expect(within(row).getByRole('button', { name: 'Festlegen …' })).toBeTruthy();
	});

	it('shows the path of a sub-task with a link to its parent and no section', async () => {
		const context = createStore(ticket({ parentId: PARENT.id, parentRef: PARENT }));
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));

		const path = screen.getByRole('navigation', { name: 'Pfad des Tickets' });
		const link = within(path).getByRole('link', { name: 'HAUS-12' });
		expect(link.getAttribute('href')).toBe(`/tickets/${PARENT.id}?erledigte=1`);
		expect(link.getAttribute('title')).toBe('Umzug');
		expect(within(path).getByText('TASK-3').getAttribute('aria-current')).toBe('page');
		expect(screen.queryByRole('region', { name: 'Unteraufgaben' })).toBeNull();
		const row = screen.getByRole('group', { name: 'Übergeordnet' });
		expect(within(row).getByRole('link', { name: 'HAUS-12' })).toBeTruthy();
		expect(
			within(row).getByRole('switch', { name: 'Blockiert das übergeordnete Ticket' })
		).toBeTruthy();
	});

	it('starts the path of a ticket in a sub project with "Haus › Garten" (ADR-0034)', async () => {
		const updated = '2026-09-24 08:00:00.000Z';
		const house: Project = {
			id: 'proj00000000001',
			name: 'Haus',
			code: 'HAUS',
			archived: false,
			updated
		};
		const garden: Project = {
			...house,
			id: 'proj00000000011',
			name: 'Garten',
			code: 'GART',
			parentId: house.id
		};
		const context = createStore(
			ticket({ key: 'GART-3', projectId: garden.id, parentId: PARENT.id, parentRef: PARENT })
		);
		mocks.detail = context.store;
		mocks.catalog = catalogOf([house, garden]);
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));

		const path = await screen.findByRole('navigation', { name: 'Pfad des Tickets' });
		await vi.waitFor(() => expect(within(path).getAllByRole('listitem')).toHaveLength(4));
		expect(
			within(path)
				.getAllByRole('listitem')
				.map((item) => item.textContent?.trim())
		).toEqual(['Haus', 'Garten', 'HAUS-12', 'GART-3']);
		// The projects lead to their panels (ADR-0054 §6), not to "Aufgaben" with a filter.
		expect(within(path).getByRole('link', { name: 'Haus' }).getAttribute('href')).toBe(
			`/projekte/${house.id}`
		);
		expect(within(path).getByRole('link', { name: 'Garten' }).getAttribute('href')).toBe(
			`/projekte/${garden.id}`
		);
		expect(within(path).getByRole('link', { name: 'Garten' }).getAttribute('title')).toBe(
			'Haus › Garten (GART)'
		);
		expect(within(path).getByText('GART-3').getAttribute('aria-current')).toBe('page');
	});

	it('shows the path and the section in the full view as well, linking to full views', async () => {
		const context = createStore(ticket({ parentId: PARENT.id, parentRef: PARENT }));
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		mocks.page.route = { id: FULL_ROUTE };
		render(FullViewRouteHarness);
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));

		const dialog = await screen.findByRole('dialog');
		const path = within(dialog).getByRole('navigation', { name: 'Pfad des Tickets' });
		expect(within(path).getByRole('link', { name: 'HAUS-12' }).getAttribute('href')).toBe(
			`/tickets/${PARENT.id}/voll?erledigte=1`
		);

		context.store.upsert({
			...ticket({ parentId: null, parentRef: null }),
			updated: '2026-09-24 10:00:00.000Z'
		});
		await tick();
		expect(within(dialog).getByRole('region', { name: 'Unteraufgaben' })).toBeTruthy();
	});
});

describe('ticket route: recurrence (E5 plan, package 4)', () => {
	it('offers "Wiederholen…" in the panel instead of the plain recurrence line', async () => {
		const context = createStore();
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		expect(screen.getByRole('button', { name: 'Wiederholen…' })).toBeTruthy();
		expect(screen.queryByText('wiederkehrend')).toBeNull();
	});
});

describe('ticket route: new (E4 plan, package 4)', () => {
	it('marks the opened ticket as read', async () => {
		mocks.tickets.markRead.mockClear();
		const context = createStore();
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		renderTicketRoute();
		await vi.waitFor(() =>
			expect(mocks.tickets.markRead).toHaveBeenCalledWith(expect.objectContaining({ id: ID }))
		);
	});
});

describe('ticket route: unsaved text', () => {
	type Guard = (navigation: BeforeNavigate) => void;

	async function renderRoute() {
		const context = createStore();
		const activity = activityStore();
		mocks.detail = context.store;
		mocks.activity = activity;
		mocks.beforeNavigate.mockClear();
		renderTicketRoute();
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		const guard = mocks.beforeNavigate.mock.lastCall?.[0] as Guard | undefined;
		if (guard === undefined) throw new Error('No navigation guard registered');
		return { store: context.store, activity, guard };
	}

	function navigation(
		path: string,
		routeId: string | null,
		type: BeforeNavigate['type'] = 'link',
		delta?: number
	) {
		const cancel = vi.fn();
		const target = {
			url: new URL(path, 'http://localhost:3000'),
			route: { id: routeId },
			params: {}
		};
		return {
			navigation: { type, to: target, from: null, cancel, delta } as unknown as BeforeNavigate,
			cancel
		};
	}

	const OTHER_TICKET = ['/tickets/zzz999zzz999zzz', '/(app)/(tickets)/tickets/[id]'] as const;

	/**
	 * The question "Änderungen verwerfen?" (ADR-0025 section 4; since UI-3 instead of
	 * window.confirm), or null. beforeNavigate cannot wait, so it opens after the guard returned.
	 */
	async function question(): Promise<HTMLDialogElement | null> {
		await tick();
		return screen.queryByRole<HTMLDialogElement>('dialog', { name: 'Änderungen verwerfen?' });
	}

	async function answer(choice: 'Weiter bearbeiten' | 'Verwerfen') {
		const dialog = await question();
		if (dialog === null) throw new Error('No question open');
		await fireEvent.click(within(dialog).getByRole('button', { name: choice }));
	}

	afterEach(() => {
		vi.restoreAllMocks();
		mocks.goto.mockClear();
	});

	it('leaves without a question while nothing is unsaved', async () => {
		const { guard } = await renderRoute();
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(await question()).toBeNull();
		expect(cancel).not.toHaveBeenCalled();
	});

	it('asks before a changed description is lost and stays on "Weiter bearbeiten"', async () => {
		const { store, guard } = await renderRoute();
		store.edit('description');
		store.setDraft('description', 'Neuer Text');
		const { navigation: to, cancel } = navigation('/?erledigte=1', '/(app)/(tickets)');

		guard(to);

		expect(cancel).toHaveBeenCalledOnce();
		const dialog = await question();
		const text = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');
		expect(text?.textContent?.trim()).toBe('Der nicht gespeicherte Text geht verloren.');
		expect(document.activeElement?.textContent?.trim()).toBe('Weiter bearbeiten');

		await answer('Weiter bearbeiten');

		expect(dialog?.open).toBe(false);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(store.hasUnsavedInput).toBe(true);
	});

	// Plan WV: the template of the series edited inline at the ticket counts as unsaved input.
	it('asks before a changed template of the series is lost, not while it is unchanged', async () => {
		const { guard } = await renderRoute();
		const rules = getRecurrenceStore();
		rules.upsert({
			id: 'rule00000000001',
			title: 'Steuererklärung',
			description: '',
			projectId: null,
			tagIds: [],
			priority: 'high',
			mode: 'calendar',
			freq: 'yearly',
			interval: 1,
			weekdays: [],
			monthDay: null,
			anchor: '2026-05-31',
			leadDays: 30,
			nextDue: '2027-05-31',
			lastGeneratedAt: null,
			active: true,
			lastHint: '',
			created: '2026-09-01 10:00:00.000Z',
			updated: '2026-09-01 10:00:00.000Z'
		});
		rules.editTemplate('rule00000000001');
		const unchanged = navigation('/?erledigte=1', '/(app)/(tickets)');
		guard(unchanged.navigation);
		expect(unchanged.cancel).not.toHaveBeenCalled();

		const draft = rules.templateDraft;
		if (draft === null) throw new Error('No draft');
		rules.setTemplateDraft({ ...draft.template, priority: 'low' }, '');
		const changed = navigation('/?erledigte=1', '/(app)/(tickets)');
		guard(changed.navigation);
		expect(changed.cancel).toHaveBeenCalledOnce();
		expect(await question()).not.toBeNull();
		await answer('Weiter bearbeiten');
		expect(rules.templateDirty).toBe(true);
		rules.cancelTemplate();
	});

	it('leaves after "Verwerfen" and does not ask again on the way', async () => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		const { navigation: to, cancel } = navigation(
			`${OTHER_TICKET[0]}?status=open`,
			OTHER_TICKET[1]
		);

		guard(to);
		expect(cancel).toHaveBeenCalledOnce();
		await answer('Verwerfen');

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/tickets/zzz999zzz999zzz?status=open');
		const again = navigation(`${OTHER_TICKET[0]}?status=open`, OTHER_TICKET[1]);
		guard(again.navigation);
		expect(again.cancel).not.toHaveBeenCalled();
	});

	it('goes the same steps back in the history after "Verwerfen" for browser back', async () => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
		const { navigation: to, cancel } = navigation(
			'/?erledigte=1',
			'/(app)/(tickets)',
			'popstate',
			-1
		);

		guard(to);
		expect(cancel).toHaveBeenCalledOnce();
		await answer('Verwerfen');

		expect(go).toHaveBeenCalledExactlyOnceWith(-1);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('asks before a name typed into the tag picker is lost (E3 plan, T-14)', async () => {
		const { guard } = await renderRoute();
		await fireEvent.input(screen.getByRole('combobox', { name: 'Tags' }), {
			target: { value: 'Steu' }
		});
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(cancel).toHaveBeenCalledOnce();
		expect(await question()).not.toBeNull();
	});

	it('asks for a comment being written when switching to another ticket', async () => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(cancel).toHaveBeenCalledOnce();
		expect(await question()).not.toBeNull();
	});

	it('does not ask for an unchanged description editor', async () => {
		const { store, guard } = await renderRoute();
		store.edit('description');

		guard(navigation(...OTHER_TICKET).navigation);

		expect(await question()).toBeNull();
	});

	it.each<[string, string, string | null, BeforeNavigate['type']]>([
		[
			'a query change of the same panel',
			'/tickets/abc123def456ghi',
			'/(app)/(tickets)/tickets/[id]',
			'goto'
		],
		['the login page (logout, session end)', '/login', '/login', 'goto'],
		['closing the tab', '/tickets/zzz999zzz999zzz', '/(app)/(tickets)/tickets/[id]', 'leave']
	])('does not ask for %s', async (_name, path, routeId, type) => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		const { navigation: to, cancel } = navigation(path, routeId, type);

		guard(to);

		expect(await question()).toBeNull();
		expect(cancel).not.toHaveBeenCalled();
	});
});

describe('ticket panel: deleted elsewhere', () => {
	it('says so with a link to the list and moves the focus to the message', async () => {
		const context = createStore();
		let deliver: ((change: RecordChange<Ticket>) => void) | undefined;
		const stop = async () => undefined;
		const live: LiveSource = {
			tickets: async () => stop,
			ticket: async (_id, onChange) => {
				deliver = onChange;
				return stop;
			},
			comments: async () => stop,
			history: async () => stop,
			projects: async () => stop,
			tags: async () => stop,
			inbox: async () => stop,
			reads: async () => stop,
			reconnected: async () => stop
		};
		const disconnect = context.store.connect(live);
		context.store.open(ID);
		render(TicketPanel, {
			props: {
				store: context.store,
				catalog: catalogOf(),
				listHref: LIST,
				onclose: vi.fn(),
				ondeleted: vi.fn()
			}
		});
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));

		deliver?.({ action: 'delete', id: ID });
		await tick();

		const message = screen.getByRole('heading', {
			level: 2,
			name: 'Dieses Ticket wurde gelöscht.'
		});
		expect(document.activeElement).toBe(message);
		expect(screen.getByRole('link', { name: 'Zur Liste' }).getAttribute('href')).toBe(LIST);
		expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
		disconnect();
	});
});

describe('ticket panel: source (E4 plan, package 3)', () => {
	function sourceText() {
		const term = screen.queryByText('Quelle', { selector: 'dt' });
		return term?.nextElementSibling ?? null;
	}

	it('names the source and links the original entry in the inbox', async () => {
		await renderPanel(ticket({ source: 'eml', sourceItem: 'item00000000001' }));
		const value = sourceText();
		expect(value?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Mail-Datei · Original ansehen');
		expect(
			within(value as HTMLElement)
				.getByRole('link', { name: 'Original ansehen' })
				.getAttribute('href')
		).toBe('/eingang/item00000000001');
	});

	it('names the source without a link once the entry is gone', async () => {
		await renderPanel(ticket({ source: 'quick', sourceItem: null }));
		expect(sourceText()?.textContent?.trim()).toBe('Schnellerfassung');
		expect(screen.queryByRole('link', { name: 'Original ansehen' })).toBeNull();
	});

	it('shows no source for tickets from before E4', async () => {
		await renderPanel(ticket({ source: null, sourceItem: null }));
		expect(sourceText()).toBeNull();
	});
});

describe('ticket route: full view (ADR-0025 section 7, UI-7)', () => {
	const PANEL_URL = 'http://localhost:3000/tickets/abc123def456ghi?erledigte=1';

	type Guard = (navigation: BeforeNavigate) => void;

	async function renderFullView(
		initial?: Ticket,
		openMode?: TicketOpenModeStore,
		activity: TicketActivityStore = activityStore()
	) {
		mocks.page.url = new URL(`http://localhost:3000/tickets/${ID}/voll?erledigte=1`);
		mocks.page.route = { id: FULL_ROUTE };
		const context = createStore(initial);
		mocks.detail = context.store;
		mocks.activity = activity;
		mocks.beforeNavigate.mockClear();
		mocks.goto.mockClear();
		render(FullViewRouteHarness, { props: { openMode } });
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		await tick();
		await tick();
		const dialog = screen.getByRole<HTMLDialogElement>('dialog', {
			name: 'TASK-3 · Steuererklärung'
		});
		const guard = mocks.beforeNavigate.mock.lastCall?.[0] as Guard | undefined;
		return { ...context, activity, dialog, guard };
	}

	afterEach(() => {
		mocks.page.url = new URL(PANEL_URL);
	});

	it('offers "Vollansicht öffnen" in the panel with the address of the full view', async () => {
		mocks.detail = createStore().store;
		mocks.activity = activityStore();
		renderTicketRoute();
		const link = await screen.findByRole('link', { name: 'Vollansicht öffnen' });
		expect(link.getAttribute('href')).toBe(`/tickets/${ID}/voll?erledigte=1`);
	});

	it('opens as XL modal instead of the panel: content left, cards right, the key in the tab', async () => {
		const { dialog } = await renderFullView(
			ticket({ source: 'mail', sourceItem: 'item00000000001' })
		);
		expect(dialog.open).toBe(true);
		expect(dialog.classList.contains('size-xl')).toBe(true);
		const view = within(dialog);
		expect(view.getByRole('heading', { level: 2, name: 'Steuererklärung' })).toBeTruthy();
		expect(view.getByRole('region', { name: 'Beschreibung' })).toBeTruthy();
		await vi.waitFor(() => expect(view.getByText('Noch keine Kommentare')).toBeTruthy());
		for (const card of ['Details', 'Wiederholung', 'Quelle', 'Metadaten']) {
			expect(view.getByRole('region', { name: card }), card).toBeTruthy();
		}
		expect(
			within(view.getByRole('region', { name: 'Details' })).getByLabelText('Status')
		).toBeTruthy();
		expect(view.getByRole('button', { name: 'Weitere Aktionen' })).toBeTruthy();
		expect(view.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		// The full view replaces the panel (plan BI-1): the panel is not mounted meanwhile.
		expect(screen.queryByRole('complementary')).toBeNull();
		expect(document.querySelector('aside.drawer')).toBeNull();
		await vi.waitFor(() => expect(document.title).toMatch(/^TASK-3 · Vollansicht/));
	});

	it('shows no card "Quelle" for a ticket without source', async () => {
		const { dialog } = await renderFullView();
		expect(within(dialog).queryByRole('region', { name: 'Quelle' })).toBeNull();
	});

	it('shows the color of the ticket before the title of the header, outside of its name (ADR-0052)', async () => {
		const { dialog } = await renderFullView(ticket({ color: 'violett' }));
		const mark = dialog.querySelector<HTMLElement>('header .color-mark');
		expect(mark?.getAttribute('title')).toBe('Farbe Violett');
		expect(within(mark as HTMLElement).getByText('Farbe Violett')).toBeTruthy();
		// The dialog keeps its name; the field "Farbe" stands in the card "Details".
		expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
		const details = within(within(dialog).getByRole('region', { name: 'Details' }));
		expect(details.getByRole<HTMLInputElement>('radio', { name: 'Violett' }).checked).toBe(true);
	});

	it('edits the fields like the panel', async () => {
		const { dialog, data } = await renderFullView();
		const details = within(within(dialog).getByRole('region', { name: 'Details' }));
		await fireEvent.change(details.getByLabelText('Status'), { target: { value: 'waiting' } });
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(ID, expect.objectContaining({ status: 'waiting' }))
		);
	});

	it.each([
		['×', 'close-button'],
		['Escape', 'escape'],
		['the veil', 'blanket']
	])('closes with %s back to the list without a panel (plan BI-1)', async (way) => {
		const { dialog } = await renderFullView();
		if (way === '×') {
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		} else if (way === 'Escape') {
			await fireEvent.keyDown(dialog, { key: 'Escape' });
		} else {
			await fireEvent.pointerDown(dialog);
			await fireEvent.click(dialog);
		}
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(LIST, { noScroll: true }));
	});

	it('returns the focus to the row of the ticket after closing', async () => {
		const { dialog } = await renderFullView();
		// The row of the list behind the modal (TicketTable), as the tickets layout renders it.
		const table = document.createElement('table');
		table.innerHTML = `<tbody><tr data-ticket-id="${ID}"><th><a class="title-link" href="#">Steuererklärung</a></th></tr></tbody>`;
		document.body.append(table);
		try {
			await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(table.querySelector('a.title-link'))
			);
		} finally {
			table.remove();
		}
	});

	it('closes back to the panel below 64rem, with the focus on "Vollansicht"', async () => {
		const { dialog } = await renderFullView(undefined, openModeStore({ wide: false }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(`/tickets/${ID}?erledigte=1`, { noScroll: true })
		);
	});

	describe('remembered way to open a ticket (plan BI-1)', () => {
		afterEach(() => {
			localStorage.clear();
		});

		it('offers "Im Seitenpanel öffnen" in the header of the full view', async () => {
			const openMode = openModeStore({ stored: 'full' });
			const { dialog } = await renderFullView(undefined, openMode);
			const link = within(dialog).getByRole('link', { name: 'Im Seitenpanel öffnen' });
			expect(link.getAttribute('href')).toBe(`/tickets/${ID}?erledigte=1`);
			expect(link.getAttribute('title')).toBe('Im Seitenpanel öffnen');
			// Next to the ×, after the menu "•••", like "Vollansicht" in the panel (plan aktionsmenues).
			const header = dialog.querySelector('header');
			const buttons = [...(header?.querySelectorAll('a, button') ?? [])].filter(
				(element) => element.closest('[popover]') === null
			);
			expect(buttons.map((element) => element.getAttribute('aria-label'))).toEqual([
				'Weitere Aktionen',
				'Im Seitenpanel öffnen',
				'Schließen'
			]);
			expect(buttons.at(-2)).toBe(link);

			link.addEventListener('click', (event) => event.preventDefault(), { once: true });
			await fireEvent.click(link);

			expect(openMode.mode).toBe('panel');
			expect(localStorage.getItem('byl-ticket-open')).toBeNull();
		});

		it('remembers "Vollansicht" chosen in the panel', async () => {
			const openMode = openModeStore();
			mocks.detail = createStore().store;
			mocks.activity = activityStore();
			render(FullViewRouteHarness, { props: { full: false, openMode } });
			const link = await screen.findByRole('link', { name: 'Vollansicht öffnen' });

			link.addEventListener('click', (event) => event.preventDefault(), { once: true });
			await fireEvent.click(link);

			expect(openMode.mode).toBe('full');
			expect(localStorage.getItem('byl-ticket-open')).toBe('full');
		});

		it('keeps the remembered choice below 64rem', async () => {
			const openMode = openModeStore({ stored: 'full', wide: false });
			const { dialog } = await renderFullView(undefined, openMode);
			const link = within(dialog).getByRole('link', { name: 'Im Seitenpanel öffnen' });

			link.addEventListener('click', (event) => event.preventDefault(), { once: true });
			await fireEvent.click(link);

			expect(openMode.mode).toBe('full');
			expect(localStorage.getItem('byl-ticket-open')).toBe('full');
		});

		it('links sub-tasks of the panel in the remembered way', async () => {
			const PARENT = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };
			const openMode = openModeStore({ stored: 'full' });
			mocks.detail = createStore(ticket({ parentId: PARENT.id, parentRef: PARENT })).store;
			mocks.activity = activityStore();
			render(FullViewRouteHarness, { props: { full: false, openMode } });
			const path = await screen.findByRole('navigation', { name: 'Pfad des Tickets' });
			expect(within(path).getByRole('link', { name: 'HAUS-12' }).getAttribute('href')).toBe(
				`/tickets/${PARENT.id}/voll?erledigte=1`
			);
		});
	});

	it('moves between panel and full view of the same ticket without asking', async () => {
		const { store, guard } = await renderFullView();
		store.edit('description');
		store.setDraft('description', 'Halber Text');
		if (guard === undefined) throw new Error('No navigation guard registered');
		const cancel = vi.fn();
		guard({
			type: 'link',
			from: null,
			cancel,
			to: {
				url: new URL(`/tickets/${ID}?erledigte=1`, 'http://localhost:3000'),
				route: { id: '/(app)/(tickets)/tickets/[id]' },
				params: { id: ID }
			}
		} as unknown as BeforeNavigate);
		expect(cancel).not.toHaveBeenCalled();
		guard({
			type: 'link',
			from: null,
			cancel,
			to: {
				url: new URL('/tickets/zzz999zzz999zzz/voll', 'http://localhost:3000'),
				route: { id: '/(app)/(tickets)/tickets/[id]/voll' },
				params: { id: 'zzz999zzz999zzz' }
			}
		} as unknown as BeforeNavigate);
		expect(cancel).toHaveBeenCalledOnce();
	});

	describe('unsaved text when a link leaves the ticket', () => {
		const OTHER = 'zzz999zzz999zzz';

		/** Guard call for the full view of another ticket; returns its cancel spy. */
		function leave(guard: Guard | undefined) {
			if (guard === undefined) throw new Error('No navigation guard registered');
			const cancel = vi.fn();
			guard({
				type: 'link',
				from: null,
				cancel,
				to: {
					url: new URL(`/tickets/${OTHER}/voll?erledigte=1`, 'http://localhost:3000'),
					route: { id: '/(app)/(tickets)/tickets/[id]/voll' },
					params: { id: OTHER }
				}
			} as unknown as BeforeNavigate);
			return cancel;
		}

		async function withDraft() {
			const view = await renderFullView();
			view.store.edit('description');
			view.store.setDraft('description', 'Halber Text');
			await tick();
			return view;
		}

		const question = () => screen.queryByRole('group', { name: 'Änderungen verwerfen?' });

		it('asks inline in the full view, without a dialog over it', async () => {
			const { dialog, guard } = await withDraft();
			const origin = within(dialog).getByRole('button', { name: 'Weitere Aktionen' });
			origin.focus();

			const cancel = leave(guard);
			await tick();

			expect(cancel).toHaveBeenCalledOnce();
			expect(screen.getAllByRole('dialog')).toHaveLength(1);
			const group = question();
			if (group === null) throw new Error('No inline question');
			expect(dialog.contains(group)).toBe(true);
			expect(within(group).getByRole('heading', { name: /Änderungen verwerfen\?/ })).toBeTruthy();
			expect(within(group).getByText('Der nicht gespeicherte Text geht verloren.')).toBeTruthy();
			const stay = within(group).getByRole('button', { name: 'Weiter bearbeiten' });
			expect(document.activeElement).toBe(stay);

			await fireEvent.click(stay);
			await tick();

			expect(question()).toBeNull();
			expect(document.activeElement).toBe(origin);
			expect(mocks.goto).not.toHaveBeenCalled();
		});

		it('goes on after "Verwerfen" without asking again', async () => {
			const { guard } = await withDraft();
			leave(guard);
			await tick();
			const group = question();
			if (group === null) throw new Error('No inline question');

			await fireEvent.click(within(group).getByRole('button', { name: 'Verwerfen' }));

			expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(`/tickets/${OTHER}/voll?erledigte=1`);
			expect(leave(guard)).not.toHaveBeenCalled();
		});

		it('stays with Escape, consumed so that the full view stays open', async () => {
			const { dialog, guard } = await withDraft();
			leave(guard);
			await tick();
			const group = question();
			if (group === null) throw new Error('No inline question');

			await fireEvent.keyDown(within(group).getByRole('button', { name: 'Weiter bearbeiten' }), {
				key: 'Escape'
			});
			await tick();

			expect(question()).toBeNull();
			expect(dialog.open).toBe(true);
			expect(mocks.goto).not.toHaveBeenCalled();
		});
	});

	it('deletes from the full view inline, without a dialog over it, and goes back to the list', async () => {
		const { dialog, data } = await renderFullView();
		data.delete.mockResolvedValueOnce(null);
		// The entry of the menu "•••" unfolds a question, it opens no dialog (plan aktionsmenues).
		expect(
			actionEntry(dialog, 'In den Papierkorb …').entry.getAttribute('aria-haspopup')
		).toBeNull();
		await chooseAction(dialog, 'In den Papierkorb …');

		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		const question = within(dialog).getByRole('heading', {
			name: /TASK-3 in den Papierkorb verschieben\?/
		});
		expect(question).toBeTruthy();
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));

		await fireEvent.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));
		await vi.waitFor(() => expect(data.delete).toHaveBeenCalledWith(ID, 'inbox'));
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/?erledigte=1'));
	});

	it('cancels the inline question with Escape, keeps the full view and returns the focus', async () => {
		const { dialog, data } = await renderFullView();
		const trigger = await chooseAction(dialog, 'In den Papierkorb …');
		const cancel = within(dialog).getByRole('button', { name: 'Abbrechen' });
		expect(document.activeElement).toBe(cancel);

		await fireEvent.keyDown(cancel, { key: 'Escape' });
		await tick();

		expect(within(dialog).queryByRole('button', { name: 'In den Papierkorb' })).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(screen.getByRole('dialog')).toBe(dialog);
		expect(data.delete).not.toHaveBeenCalled();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	// ADR-0025 section 3, addendum 16: no dialog from the full view. Forms unfold inline where they
	// were asked for, questions stand inline; Escape closes them first and is consumed, so the full
	// view stays, and the focus goes back to the button that opened them.
	describe('no dialog from the full view (ADR-0025 addendum 16)', () => {
		it('unfolds "Wiederholen…" inline in the card, closes it with Escape and "Abbrechen"', async () => {
			const { dialog } = await renderFullView();
			const card = within(dialog).getByRole('region', { name: 'Wiederholung' });
			const trigger = within(card).getByRole('button', { name: 'Wiederholen…' });
			expect(trigger.getAttribute('aria-haspopup')).toBeNull();
			expect(trigger.getAttribute('aria-expanded')).toBe('false');
			trigger.focus();
			await fireEvent.click(trigger);
			await tick();

			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
			const area = within(card).getByRole('region', { name: 'Wiederholen…' });
			expect(trigger.getAttribute('aria-expanded')).toBe('true');
			expect(within(area).getByRole('button', { name: 'Wiederholung anlegen' })).toBeTruthy();
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(
					within(area).getByRole('radio', { name: 'Fester Rhythmus' })
				)
			);

			const escape = new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true
			});
			document.activeElement?.dispatchEvent(escape);
			await tick();
			await tick();
			expect(escape.defaultPrevented).toBe(true);
			expect(within(card).queryByRole('region', { name: 'Wiederholen…' })).toBeNull();
			expect(dialog.open).toBe(true);
			expect(mocks.goto).not.toHaveBeenCalled();
			await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

			await fireEvent.click(trigger);
			await tick();
			const again = within(card).getByRole('region', { name: 'Wiederholen…' });
			await fireEvent.click(within(again).getByRole('button', { name: 'Abbrechen' }));
			await tick();
			await tick();
			expect(within(card).queryByRole('region', { name: 'Wiederholen…' })).toBeNull();
			await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		});

		it('creates the rule inline and puts the focus on "Regel bearbeiten" of the new series', async () => {
			const rules = getRecurrenceStore();
			const created = {
				id: 'rule00000000009',
				title: 'Steuererklärung',
				description: '',
				projectId: null,
				tagIds: [],
				priority: 'high' as const,
				mode: 'calendar' as const,
				freq: 'weekly' as const,
				interval: 1,
				weekdays: ['TH' as const],
				monthDay: null,
				anchor: '2026-10-01',
				leadDays: 3,
				nextDue: '2026-10-08',
				lastGeneratedAt: null,
				active: true,
				lastHint: '',
				created: '2026-09-25 10:00:00.000Z',
				updated: '2026-09-25 10:00:00.000Z'
			};
			const repeat = vi.spyOn(rules, 'repeat').mockImplementation(async () => {
				rules.upsert(created);
				return { ok: true, value: created };
			});
			try {
				const { dialog } = await renderFullView();
				const card = within(dialog).getByRole('region', { name: 'Wiederholung' });
				const trigger = within(card).getByRole('button', { name: 'Wiederholen…' });
				// A browser focuses the button on the click; it gives way to the series afterwards.
				trigger.focus();
				await fireEvent.click(trigger);
				const area = within(card).getByRole('region', { name: 'Wiederholen…' });
				await fireEvent.click(within(area).getByRole('button', { name: 'Wiederholung anlegen' }));

				await vi.waitFor(() => expect(repeat).toHaveBeenCalledOnce());
				await vi.waitFor(() =>
					expect(document.activeElement).toBe(
						within(card).getByRole('button', { name: 'Regel bearbeiten' })
					)
				);
				expect(within(card).queryByRole('region', { name: 'Wiederholen…' })).toBeNull();
				expect(screen.getAllByRole('dialog')).toEqual([dialog]);
			} finally {
				repeat.mockRestore();
				rules.remove(created.id);
			}
		});

		it('unfolds "Quelle hinzufügen …" inline below the heading of the sources', async () => {
			const { dialog } = await renderFullView();
			const sources = within(dialog).getByRole('region', { name: 'Quellen' });
			const trigger = within(sources).getByRole('button', { name: 'Quelle hinzufügen …' });
			trigger.focus();
			await fireEvent.click(trigger);
			await tick();

			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
			const area = within(sources).getByRole('region', { name: 'Quelle hinzufügen' });
			expect(trigger.getAttribute('aria-expanded')).toBe('true');
			expect(within(area).getByText('Keine neuen Einträge')).toBeTruthy();
			await fireEvent.keyDown(within(area).getByRole('button', { name: 'Abbrechen' }), {
				key: 'Escape'
			});
			await tick();
			await tick();
			expect(within(sources).queryByRole('region', { name: 'Quelle hinzufügen' })).toBeNull();
			expect(dialog.open).toBe(true);
			await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		});

		it('asks before deleting a comment inline, with the focus on "Abbrechen" and Escape', async () => {
			const comment = {
				id: 'comment00000001',
				ticket: ID,
				author: 'me',
				body: 'Belege liegen im Ordner.',
				created: '2026-09-02 12:00:00.000Z',
				updated: '2026-09-02 12:00:00.000Z'
			};
			const data = {
				listComments: vi.fn(async () => [comment]),
				createComment: vi.fn(),
				updateComment: vi.fn(),
				deleteComment: vi.fn(async () => undefined),
				listHistory: vi.fn(async () => [])
			} satisfies TicketActivityData;
			const activity = new TicketActivityStore(
				data,
				{ ensureValid: () => true, logout: vi.fn() },
				() => 'me'
			);
			const { dialog } = await renderFullView(undefined, undefined, activity);
			const remove = await within(dialog).findByRole('button', { name: /^Löschen: Kommentar/ });
			remove.focus();
			await fireEvent.click(remove);
			await tick();

			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
			const question = within(dialog).getByRole('group', { name: 'Kommentar löschen?' });
			expect(within(question).getByText(/wird endgültig gelöscht/)).toBeTruthy();
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(
					within(question).getByRole('button', { name: 'Abbrechen' })
				)
			);
			await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
			await tick();
			await tick();
			expect(within(dialog).queryByRole('group', { name: 'Kommentar löschen?' })).toBeNull();
			expect(dialog.open).toBe(true);
			await vi.waitFor(() => expect(document.activeElement).toBe(remove));

			await fireEvent.click(remove);
			await tick();
			await fireEvent.click(
				within(within(dialog).getByRole('group', { name: 'Kommentar löschen?' })).getByRole(
					'button',
					{ name: 'Löschen' }
				)
			);
			await vi.waitFor(() => expect(data.deleteComment).toHaveBeenCalledWith(comment.id));
			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
		});

		it('pins and replaces a comment in the full view without a dialog (ADR-0044)', async () => {
			const at = (hour: number) => `2026-09-02 ${hour}:00:00.000Z`;
			const comments = [
				{
					id: 'comment00000001',
					ticket: ID,
					author: 'me',
					body: 'Erster',
					created: at(10),
					updated: at(10)
				},
				{
					id: 'comment00000002',
					ticket: ID,
					author: 'other',
					body: 'Zweiter',
					created: at(11),
					updated: at(11)
				}
			];
			const data = {
				listComments: vi.fn(async () => comments),
				createComment: vi.fn(),
				updateComment: vi.fn(),
				deleteComment: vi.fn(),
				listHistory: vi.fn(async () => [])
			} satisfies TicketActivityData;
			const activity = new TicketActivityStore(
				data,
				{ ensureValid: () => true, logout: vi.fn() },
				() => 'me'
			);
			const { dialog, data: tickets } = await renderFullView(
				ticket({ pinnedComment: 'comment00000001' }),
				undefined,
				activity
			);
			const view = within(dialog);
			await vi.waitFor(() => expect(view.getByText('Angepinnt')).toBeTruthy());

			await fireEvent.click(view.getByRole('button', { name: /^Anpinnen: Kommentar von Anderes/ }));

			await vi.waitFor(() =>
				expect(tickets.update).toHaveBeenCalledWith(ID, { pinnedComment: 'comment00000002' })
			);
			await vi.waitFor(() =>
				expect(
					view.getByText('Angepinnt').closest('article')?.getAttribute('data-comment-id')
				).toBe('comment00000002')
			);
			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
		});

		it('unfolds "Duplizieren …" of the menu inline and opens the duplicate in the remembered full view (ADR-0045, AM-1)', async () => {
			const { data } = duplicateStore();
			const { dialog } = await renderFullView(undefined, openModeStore({ stored: 'full' }));
			expect(actionEntry(dialog, 'Duplizieren …').entry.getAttribute('aria-haspopup')).toBeNull();
			const trigger = await chooseAction(dialog, 'Duplizieren …');

			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
			const area = within(dialog).getByRole('region', { name: 'TASK-3 duplizieren' });
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(within(area).getByLabelText('Titel'))
			);

			// Escape closes only the area; the full view stays and the focus goes back.
			const escape = new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true
			});
			document.activeElement?.dispatchEvent(escape);
			await tick();
			await tick();
			expect(escape.defaultPrevented).toBe(true);
			expect(within(dialog).queryByRole('region', { name: 'TASK-3 duplizieren' })).toBeNull();
			expect(dialog.open).toBe(true);
			await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

			// "In den Papierkorb …" and "Duplizieren …" close each other.
			await chooseAction(dialog, 'In den Papierkorb …');
			expect(
				within(dialog).getByRole('heading', { name: /TASK-3 in den Papierkorb verschieben\?/ })
			).toBeTruthy();
			await chooseAction(dialog, 'Duplizieren …');
			expect(within(dialog).queryByRole('button', { name: 'In den Papierkorb' })).toBeNull();
			const again = within(dialog).getByRole('region', { name: 'TASK-3 duplizieren' });
			await fireEvent.click(within(again).getByRole('radio', { name: 'Offen' }));
			await fireEvent.click(within(again).getByRole('button', { name: 'Duplizieren' }));
			await vi.waitFor(() =>
				expect(mocks.goto).toHaveBeenCalledWith('/tickets/dupl00000000013/voll?erledigte=1')
			);
			expect(data.duplicate).toHaveBeenCalledWith(ID, expect.objectContaining({ status: 'open' }));
			expect(screen.getAllByRole('dialog')).toEqual([dialog]);
		});
	});
});
