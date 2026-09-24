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
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { LiveSource, RecordChange } from '$lib/stores/realtime';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import TicketPanel from './TicketPanel.svelte';
import TicketPage from '../../routes/(app)/(tickets)/tickets/[id]/+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn(),
	page: {
		url: new URL('http://localhost:3000/tickets/abc123def456ghi?erledigte=1'),
		params: { id: 'abc123def456ghi' } as Record<string, string>
	},
	detail: null as unknown,
	activity: null as unknown,
	catalog: null as unknown
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

const ID = 'abc123def456ghi';
const LIST = '/?erledigte=1' as ResolvedPathname;

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Steuererklärung',
		description: '**Belege** sammeln',
		status: 'in_progress',
		priority: 'high',
		due: '2026-10-01',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-02 12:30:00.000Z',
		...overrides
	};
}

function createStore(initial: Ticket = ticket()) {
	let current = initial;
	let clock = 0;
	const data = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			clock += 1;
			current = { ...current, ...patch, updated: `2026-09-24 10:00:0${clock}.000Z` };
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
		props: { store: context.store, listHref: LIST, onclose, ondeleted: vi.fn(), ...props }
	});
	await vi.waitFor(() => expect(context.store.state).not.toBe('loading'));
	await tick();
	return { ...result, ...context, onclose };
}

function heading() {
	return screen.getByRole('heading', { level: 2 });
}

beforeEach(() => {
	mocks.goto.mockClear();
});

describe('ticket panel', () => {
	it('shows the ticket and moves the focus to its heading', async () => {
		await renderPanel(
			ticket({
				project: { id: 'p1', name: 'Finanzen', code: 'FIN', archived: false },
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
		expect(within(panel).getByText('Finanzen')).toBeTruthy();
		expect(within(panel).getByText('Amt')).toBeTruthy();
		expect(within(panel).getByText('wiederkehrend')).toBeTruthy();
		expect(within(panel).getByText('01.09.2026 12:00')).toBeTruthy();
		expect(within(panel).getByText('02.09.2026 14:30')).toBeTruthy();
		expect(within(panel).queryByText('Erledigt am')).toBeNull();
	});

	it('leaves out project, tags and recurrence when the ticket has none', async () => {
		await renderPanel(ticket({ description: '' }));

		expect(screen.queryByText('Projekt')).toBeNull();
		expect(screen.queryByText('Tags')).toBeNull();
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

	it('saves the due date when the field is left and removes it with "Entfernen"', async () => {
		const { data } = await renderPanel();

		const input = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: '2026-12-24' } });
		await fireEvent.blur(input);
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { due: '2026-12-24' }));

		await fireEvent.click(screen.getByRole('button', { name: 'Entfernen: Fälligkeit' }));
		await vi.waitFor(() => expect(data.update).toHaveBeenLastCalledWith(ID, { due: null }));
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('');
		expect(screen.queryByRole('button', { name: 'Entfernen: Fälligkeit' })).toBeNull();
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

	it('edits the description with preview, saves with Ctrl+Enter and cancels', async () => {
		const { data } = await renderPanel();

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		const text = screen.getByLabelText<HTMLTextAreaElement>('Beschreibung (Markdown)');
		expect(document.activeElement).toBe(text);
		expect(text.value).toBe('**Belege** sammeln');
		expect(text.maxLength).toBe(100_000);
		await fireEvent.input(text, { target: { value: '# Neu' } });
		await fireEvent.keyDown(text, { key: 'Enter', ctrlKey: true });
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { description: '# Neu' }));
		await tick();
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Neu');

		await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten: Beschreibung' }));
		await fireEvent.input(screen.getByLabelText('Beschreibung (Markdown)'), {
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

	it('closes with Escape and with "Schließen", but not from a form field', async () => {
		const { onclose } = await renderPanel();

		await fireEvent.keyDown(screen.getByLabelText('Status'), { key: 'Escape' });
		expect(onclose).not.toHaveBeenCalled();

		await fireEvent.keyDown(heading(), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});

	it('shows "Ticket nicht gefunden" with a link to the list', async () => {
		const context = createStore();
		context.data.get.mockRejectedValueOnce(new DataError('not_found'));
		context.store.open('unknown00000000');
		render(TicketPanel, {
			props: { store: context.store, listHref: LIST, onclose: vi.fn(), ondeleted: vi.fn() }
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
			props: { store: context.store, listHref: LIST, onclose: vi.fn(), ondeleted: vi.fn() }
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
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []) },
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

		const { unmount } = render(TicketPage);
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		expect(open).toHaveBeenCalledWith(ID);
		expect(openComments).toHaveBeenCalledWith(ID);
		await vi.waitFor(() => expect(screen.getByText('Noch keine Kommentare.')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/?erledigte=1');

		unmount();
		expect(store.state).toBe('idle');
		expect(activity.ticketId).toBeNull();
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
		render(TicketPage);
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		const guard = mocks.beforeNavigate.mock.lastCall?.[0] as Guard | undefined;
		if (guard === undefined) throw new Error('No navigation guard registered');
		return { store: context.store, activity, guard };
	}

	function navigation(path: string, routeId: string | null, type: BeforeNavigate['type'] = 'link') {
		const cancel = vi.fn();
		const target = {
			url: new URL(path, 'http://localhost:3000'),
			route: { id: routeId },
			params: {}
		};
		return {
			navigation: { type, to: target, from: null, cancel } as unknown as BeforeNavigate,
			cancel
		};
	}

	const OTHER_TICKET = ['/tickets/zzz999zzz999zzz', '/(app)/(tickets)/tickets/[id]'] as const;

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('leaves without a question while nothing is unsaved', async () => {
		const { guard } = await renderRoute();
		const confirm = vi.spyOn(window, 'confirm');
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(confirm).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
	});

	it('asks before a changed description is lost and stays on "Abbrechen"', async () => {
		const { store, guard } = await renderRoute();
		store.edit('description');
		store.setDraft('description', 'Neuer Text');
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { navigation: to, cancel } = navigation('/?erledigte=1', '/(app)/(tickets)');

		guard(to);

		expect(confirm).toHaveBeenCalledWith(
			'Änderungen verwerfen? Der nicht gespeicherte Text geht verloren.'
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('leaves after confirming', async () => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(cancel).not.toHaveBeenCalled();
	});

	it('asks for a comment being written when switching to another ticket', async () => {
		const { activity, guard } = await renderRoute();
		activity.setNewComment('Halber Kommentar');
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(confirm).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('does not ask for an unchanged description editor', async () => {
		const { store, guard } = await renderRoute();
		store.edit('description');
		const confirm = vi.spyOn(window, 'confirm');

		guard(navigation(...OTHER_TICKET).navigation);

		expect(confirm).not.toHaveBeenCalled();
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
		const confirm = vi.spyOn(window, 'confirm');
		const { navigation: to, cancel } = navigation(path, routeId, type);

		guard(to);

		expect(confirm).not.toHaveBeenCalled();
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
			reconnected: async () => stop
		};
		const disconnect = context.store.connect(live);
		context.store.open(ID);
		render(TicketPanel, {
			props: { store: context.store, listHref: LIST, onclose: vi.fn(), ondeleted: vi.fn() }
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
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		disconnect();
	});
});
