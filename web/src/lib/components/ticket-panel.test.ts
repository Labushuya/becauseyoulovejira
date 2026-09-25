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
	catalog: null as unknown,
	tickets: { markRead: vi.fn(async () => undefined), today: '2026-09-25', upsert: vi.fn() }
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

const ID = 'abc123def456ghi';
const LIST = '/?erledigte=1' as ResolvedPathname;

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

describe('ticket route: recurrence (E5 plan, package 4)', () => {
	it('offers "Wiederholen…" in the panel instead of the plain recurrence line', async () => {
		const context = createStore();
		mocks.detail = context.store;
		mocks.catalog = catalogOf();
		mocks.activity = activityStore();
		render(TicketPage);
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
		render(TicketPage);
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

	it('asks before a name typed into the tag picker is lost (E3 plan, T-14)', async () => {
		const { guard } = await renderRoute();
		await fireEvent.input(screen.getByRole('combobox', { name: 'Tags' }), {
			target: { value: 'Steu' }
		});
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { navigation: to, cancel } = navigation(...OTHER_TICKET);

		guard(to);

		expect(confirm).toHaveBeenCalledWith(
			'Änderungen verwerfen? Der nicht gespeicherte Text geht verloren.'
		);
		expect(cancel).toHaveBeenCalledOnce();
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
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
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
