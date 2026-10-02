// Route test of the trash (ADR-0037 §9, ADR-0054 §7): "Wiederherstellen" in the preview and in a
// row keeps the user in the trash; the flag "KEY wiederhergestellt." offers "Öffnen", which opens
// the ticket in "Aufgaben" in the remembered way. Navigation, page state and the data layer are
// fakes; the trash store and the flags are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashItem, TrashPreview } from '$lib/domain/trash';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TrashStore, type TrashData } from '$lib/stores/trash.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TrashRouteHarness from '$lib/test/TrashRouteHarness.svelte';

const A = 'ticket00000000a';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: {
		url: new URL('http://localhost:3000/papierkorb'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/papierkorb' }
	},
	store: null as unknown
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', () => ({
	auth: { userId: 'user00000000001', ensureValid: () => true, logout: vi.fn() }
}));
vi.mock('$lib/stores/trash.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTrashStore: () => mocks.store
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => ({ activeProjects: [] })
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 0 })
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => ({ newInProjects: 0 })
}));

useOverlayStubs();

const ITEM: TrashItem = {
	id: A,
	key: 'HAUS-1',
	title: 'Dach reparieren',
	status: 'open',
	priority: 'medium',
	due: '',
	project: null,
	recurring: false,
	children: 0,
	dependencies: 0,
	deletedAt: '2026-09-28 10:00:00.000Z',
	deletedBy: 'user00000000001',
	updated: '2026-09-28 10:00:00.000Z',
	daysLeft: 30
};

const PREVIEW: TrashPreview = {
	...ITEM,
	description: '',
	tags: [],
	subtasks: [],
	group: '',
	sources: { handling: 'inbox', count: 0 },
	dependencyList: []
};

async function show(path: string) {
	const url = new URL(path, 'http://localhost:3000');
	mocks.page.url = url;
	const id = /^\/papierkorb\/([a-z0-9]{15})$/.exec(url.pathname)?.[1];
	mocks.page.params = id ? { id } : {};
	mocks.page.route = { id: id ? '/(app)/papierkorb/[id]' : '/(app)/papierkorb' };
	const flags = new FlagStore();
	const data: TrashData = {
		list: vi.fn(async () => ({ items: [ITEM], retention: '30' as const })),
		preview: vi.fn(async () => PREVIEW),
		restore: vi.fn(async (ticketId: string) => ({
			id: ticketId,
			key: 'HAUS-1',
			updated: '',
			tickets: [],
			newKeys: [],
			parentDetached: false,
			ruleMissing: [],
			seriesDetached: [],
			sourcesSkipped: []
		})),
		resolve: vi.fn(),
		purge: vi.fn(async () => undefined),
		purgeAll: vi.fn(async () => ({ purged: 1, blocked: [] })),
		saveRetention: vi.fn(async (value) => value)
	};
	const store = new TrashStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	await store.reload();
	mocks.store = store;
	render(TrashRouteHarness, { props: { preview: id !== undefined } });
	await tick();
	return { data, flags };
}

beforeEach(() => {
	mocks.goto.mockClear();
});

describe('trash: restoring keeps the user there (ADR-0054 §7)', () => {
	it('restores from the preview, goes back to the table and offers "Öffnen" in the flag', async () => {
		const { data, flags } = await show(`/papierkorb/${A}`);
		const panel = await screen.findByRole('complementary', { name: 'Dach reparieren' });
		await fireEvent.click(within(panel).getByRole('button', { name: 'Wiederherstellen' }));

		await vi.waitFor(() => expect(data.restore).toHaveBeenCalledWith(A, {}));
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/papierkorb'));
		const flag = flags.flags.at(-1);
		expect(flag?.title).toBe('HAUS-1 wiederhergestellt.');
		expect(flag?.action?.label).toBe('Öffnen');
		flags.act(flag!.id);
		expect(mocks.goto).toHaveBeenLastCalledWith(`/tickets/${A}`);
	});

	it('restores a row of the table, stays there and opens the ticket in "Aufgaben"', async () => {
		const { flags } = await show('/papierkorb');
		await fireEvent.click(screen.getByRole('button', { name: 'HAUS-1 wiederherstellen' }));

		await vi.waitFor(() => expect(flags.flags.at(-1)?.title).toBe('HAUS-1 wiederhergestellt.'));
		expect(mocks.goto).not.toHaveBeenCalled();
		flags.act(flags.flags.at(-1)!.id);
		// Without the store of the remembered mode (the (app) layout) the link opens the panel.
		expect(mocks.goto).toHaveBeenLastCalledWith(`/tickets/${A}`);
	});
});
