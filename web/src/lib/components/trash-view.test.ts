// View "Papierkorb" (ADR-0037 §9, plan PB-2): table with key, title, project, date, person and
// days, the retention with its link, the empty state, the hint before the migration, the bar of
// the chosen rows (the glass bar of the ticket table) with "Wiederherstellen" and "Endgültig
// löschen …", the confirmation that says it cannot be undone (no red), the inline questions of a
// restore, the read-only preview, and the hint "liegt im Papierkorb" with the count in the switch.
// Real TrashStore on a fake data layer; page state is mocked; jsdom has no showModal(), the
// shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { ProjectRef } from '$lib/domain/ticket';
import type { TrashItem, TrashPreview } from '$lib/domain/trash';
import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
import { TrashStore, type TrashData } from '$lib/stores/trash.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TrashContextHarness from '$lib/test/TrashContextHarness.svelte';
import TrashPanel from './TrashPanel.svelte';
import TrashView from './TrashView.svelte';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/papierkorb') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SELF = 'user00000000001';
const A = 'ticket00000000a';
const B = 'ticket00000000b';
const PROJECTS: ProjectRef[] = [
	{
		id: 'project00000001',
		name: 'Garten',
		code: 'GART',
		archived: false,
		parentId: null
	} as ProjectRef
];

function item(id: string, overrides: Partial<TrashItem> = {}): TrashItem {
	return {
		id,
		key: id === A ? 'HAUS-1' : 'TASK-2',
		title: id === A ? 'Dach reparieren' : 'Keller',
		status: 'open',
		priority: 'medium',
		due: '',
		project: id === A ? { id: 'p1', code: 'HAUS', name: 'Haus', exists: false } : null,
		recurring: false,
		children: id === A ? 2 : 0,
		deletedAt: '2026-09-28 10:00:00.000Z',
		deletedBy: SELF,
		updated: '2026-09-28 10:00:00.000Z',
		daysLeft: id === A ? 30 : 1,
		...overrides
	};
}

function projectNeed(): DataError {
	return new DataError('validation', {
		status: 400,
		fields: {
			project: {
				code: 'validation_trash_project_required',
				message: 'Bitte ein Zielprojekt wählen.',
				params: { code: 'HAUS', reason: 'missing' }
			}
		}
	});
}

async function showView(overrides: Partial<TrashData> = {}, items = [item(A), item(B)]) {
	const data: TrashData = {
		list: vi.fn(async () => ({ items, retention: '30' as const })),
		preview: vi.fn(),
		restore: vi.fn(async (id: string) => ({
			id,
			key: 'HAUS-1',
			updated: '',
			tickets: [],
			newKeys: [],
			parentDetached: false,
			ruleMissing: [],
			seriesDetached: [],
			sourcesSkipped: []
		})),
		purge: vi.fn(async () => undefined),
		purgeAll: vi.fn(async () => items.length),
		saveRetention: vi.fn(async (value) => value),
		...overrides
	};
	const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() }, SILENT_FLAGS);
	await store.reload();
	render(TrashView, { props: { store, projects: PROJECTS, selfId: SELF } });
	await tick();
	return { store, data };
}

describe('view "Papierkorb"', () => {
	it('lists the tickets with key, title, project, date, person and days left', async () => {
		await showView();
		expect(screen.getByRole('heading', { level: 2, name: 'Papierkorb' })).toBeTruthy();
		const rows = screen.getAllByRole('row').slice(1);
		expect(rows).toHaveLength(2);
		const first = within(rows[0] as HTMLElement);
		expect(first.getByText('HAUS-1')).toBeTruthy();
		expect(first.getByRole('link', { name: 'Dach reparieren' }).getAttribute('href')).toBe(
			`/papierkorb/${A}`
		);
		expect(first.getByText('mit 2 Unteraufgaben')).toBeTruthy();
		expect(first.getByText('gelöscht oder geändert')).toBeTruthy();
		expect(first.getByText('28.09.2026 12:00')).toBeTruthy();
		expect(first.getByText('Du')).toBeTruthy();
		expect(first.getByText('in 30 Tagen')).toBeTruthy();
		expect(within(rows[1] as HTMLElement).getByText('in 1 Tag')).toBeTruthy();
		expect(screen.getByText(/nach 30 Tagen endgültig gelöscht/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Aufbewahrung ändern' }).getAttribute('href')).toBe(
			'/einstellungen/tickets'
		);
	});

	it('shows the empty state and the hint before the migration', async () => {
		await showView({}, []);
		expect(screen.getByRole('heading', { name: 'Der Papierkorb ist leer' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Papierkorb leeren …' })).toBeNull();
	});

	it('says that the trash comes with the next start before the migration', async () => {
		await showView({
			list: vi.fn(async () => Promise.reject(new DataError('server', { status: 503 })))
		});
		expect(
			screen.getByText(/Der Papierkorb ist nach dem nächsten Neustart verfügbar/)
		).toBeTruthy();
	});

	it('restores a row and asks inline for a target project when the old one is gone', async () => {
		const restore = vi
			.fn<TrashData['restore']>()
			.mockRejectedValueOnce(projectNeed())
			.mockImplementation(async (id) => ({
				id,
				key: 'GART-1',
				updated: '',
				tickets: [],
				newKeys: [],
				parentDetached: false,
				ruleMissing: [],
				seriesDetached: [],
				sourcesSkipped: []
			}));
		await showView({ restore });
		await fireEvent.click(screen.getByRole('button', { name: 'HAUS-1 wiederherstellen' }));
		await vi.waitFor(() =>
			expect(screen.getByText(/Das Projekt HAUS gibt es nicht mehr/)).toBeTruthy()
		);
		const target = screen.getByLabelText('Zielprojekt für HAUS-1') as HTMLSelectElement;
		await fireEvent.change(target, { target: { value: 'project00000001' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));
		await vi.waitFor(() =>
			expect(restore).toHaveBeenLastCalledWith(A, { project: 'project00000001' })
		);
		await vi.waitFor(() => expect(screen.queryByText('Dach reparieren')).toBeNull());
	});

	it('deletes for good only after a confirmation that says it cannot be undone, without red', async () => {
		const { data } = await showView();
		await fireEvent.click(screen.getByRole('button', { name: 'HAUS-1 endgültig löschen …' }));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'HAUS-1 endgültig löschen?' });
		expect(within(dialog).getByText(/Das lässt sich nicht rückgängig machen\./)).toBeTruthy();
		const confirm = within(dialog).getByRole('button', { name: 'Endgültig löschen' });
		expect(confirm.className).toContain('button-primary');
		expect(dialog.querySelector('.alert-error, [class*="danger"]')).toBeNull();
		await fireEvent.click(confirm);
		await vi.waitFor(() => expect(data.purge).toHaveBeenCalledExactlyOnceWith(A));
	});

	it('chooses rows and offers the bulk actions in the shared glass bar', async () => {
		const { data } = await showView();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' })
		);
		const bar = screen.getByRole('region', { name: '2 Tickets ausgewählt' });
		expect(bar.className).toContain('bulk-bar');
		await fireEvent.click(within(bar).getByRole('button', { name: 'Wiederherstellen' }));
		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledTimes(2));
	});

	it('empties the whole trash after asking', async () => {
		const { data } = await showView();
		await fireEvent.click(screen.getByRole('button', { name: 'Papierkorb leeren …' }));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Papierkorb leeren?' });
		expect(within(dialog).getByText(/Alle 2 Tickets im Papierkorb/)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Papierkorb leeren' }));
		await vi.waitFor(() => expect(data.purgeAll).toHaveBeenCalledOnce());
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Der Papierkorb ist leer' })).toBeTruthy()
		);
	});
});

describe('preview of a ticket in the trash', () => {
	const preview: TrashPreview = {
		...item(A),
		description: '**Wichtig**',
		tags: [{ id: 't1', name: 'bau' }],
		subtasks: [{ id: 'c1', key: 'HAUS-2', title: 'Ziegel', status: 'done' }],
		group: '',
		sources: { handling: 'discard', count: 2 }
	};

	it('shows the ticket read-only with its sub-tasks, sources and actions', async () => {
		const onrestore = vi.fn();
		const onpurge = vi.fn();
		render(TrashPanel, {
			props: {
				preview,
				selfId: SELF,
				projects: PROJECTS,
				need: null,
				onrestore,
				onpurge,
				ondismissneed: vi.fn(),
				onclose: vi.fn()
			}
		});
		expect(screen.getByRole('heading', { level: 2, name: 'Dach reparieren' })).toBeTruthy();
		expect(screen.getByText('Wichtig').tagName).toBe('STRONG');
		expect(screen.getByText(/HAUS-2/)).toBeTruthy();
		expect(screen.getByText(/bleiben beim Ticket und kommen mit ihm zurück/)).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));
		expect(onrestore).toHaveBeenCalledWith({});
		await fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen …' }));
		expect(onpurge).toHaveBeenCalledOnce();
	});

	it('offers no actions for a sub-task of a group, only the way to its parent', () => {
		render(TrashPanel, {
			props: {
				preview: { ...preview, group: B },
				selfId: SELF,
				projects: PROJECTS,
				need: { kind: 'series', key: 'TASK-9', ticketId: 'x' },
				onrestore: vi.fn(),
				onpurge: vi.fn(),
				ondismissneed: vi.fn(),
				onclose: vi.fn()
			}
		});
		expect(
			screen.getByRole('link', { name: 'Übergeordnetes Ticket ansehen' }).getAttribute('href')
		).toBe(`/papierkorb/${B}`);
		expect(screen.queryByRole('button', { name: 'Endgültig löschen …' })).toBeNull();
		expect(
			screen.getByRole('button', { name: 'Als normales Ticket wiederherstellen (aus Serie lösen)' })
		).toBeTruthy();
	});
});

describe('links to tickets in the trash', () => {
	it('show the number in the switch and "liegt im Papierkorb" with a link there', async () => {
		const data: TrashData = {
			list: vi.fn(async () => ({ items: [item(A)], retention: '30' as const })),
			preview: vi.fn(async () => {
				throw new DataError('not_found', { status: 404 });
			}),
			restore: vi.fn(),
			purge: vi.fn(),
			purgeAll: vi.fn(),
			saveRetention: vi.fn()
		};
		const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() });
		await store.reload();
		render(TrashContextHarness, { props: { store, ticketId: A } });
		await tick();
		expect(screen.getByRole('link', { name: 'Papierkorb (1 Ticket)' }).getAttribute('href')).toBe(
			'/papierkorb'
		);
		expect(screen.getByRole('heading', { name: /Dieses Ticket liegt im Papierkorb/ })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Im Papierkorb ansehen' }).getAttribute('href')).toBe(
			`/papierkorb/${A}`
		);
	});

	it('say nothing for a ticket that is not in the trash', async () => {
		const data: TrashData = {
			list: vi.fn(async () => ({ items: [], retention: '30' as const })),
			preview: vi.fn(async () => {
				throw new DataError('not_found', { status: 404 });
			}),
			restore: vi.fn(),
			purge: vi.fn(),
			purgeAll: vi.fn(),
			saveRetention: vi.fn()
		};
		const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() });
		await store.reload();
		render(TrashContextHarness, { props: { store, ticketId: B } });
		await vi.waitFor(() => expect(data.preview).toHaveBeenCalled());
		await tick();
		expect(screen.queryByText(/liegt im Papierkorb/)).toBeNull();
		expect(screen.getByRole('link', { name: 'Papierkorb' })).toBeTruthy();
	});
});
