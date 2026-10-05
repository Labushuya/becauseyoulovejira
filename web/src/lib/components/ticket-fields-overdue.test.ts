// "überfällig seit …" below the due date in the fields of panel and full view (WH-1): the same text
// as the list and the day plan, for an open ticket due before today only, describing the field.
// The detail store runs for real on a fake data layer.

import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketFields from './TicketFields.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const TODAY = '2026-10-07';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: 'ticket000000001',
		key: 'HAUS-12',
		title: 'Spülmaschine ausräumen',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: '2026-10-05',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: true,
		recurrenceId: 'rule00000000001',
		source: null,
		completedAt: null,
		created: '2026-10-02 10:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z',
		...overrides
	};
}

/** `today` null: a view that passes no day (the line stays away). */
async function show(item: Ticket, today: string | null = TODAY) {
	const data = {
		get: vi.fn(async () => item),
		update: vi.fn(),
		create: vi.fn(),
		delete: vi.fn()
	} satisfies TicketDetailData;
	const list = {
		find: () => null,
		upsert: vi.fn((summary: TicketSummary) => summary),
		completed: vi.fn(),
		remove: vi.fn(),
		announce: vi.fn(),
		subtasksOf: () => []
	} satisfies TicketListSync;
	const store = new TicketDetailStore(data, SESSION, list);
	store.open(item.id);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	render(TicketFields, {
		props: {
			store,
			catalog,
			today: today ?? undefined,
			get ticket() {
				return store.ticket as Ticket;
			}
		}
	});
	await tick();
}

describe('"überfällig seit …" below the due date (WH-1)', () => {
	it('names the day an open ticket is overdue since and describes the field with it', async () => {
		await show(ticket());
		const line = screen.getByText('überfällig seit 05.10.');
		const input = screen.getByLabelText('Fälligkeit');
		const id = line.closest('p')?.id ?? '';
		expect(id).not.toBe('');
		expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(id);
		// Bold in text colour with the clock of the list, never red (ADR-0009).
		expect(line.closest('p')?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(line.closest('.field-error')).toBeNull();
	});

	it('names the year of a date of another year', async () => {
		await show(ticket({ due: '2025-12-29' }));
		expect(screen.getByText('überfällig seit 29.12.2025')).toBeTruthy();
	});

	it.each<[string, Ticket, string | null]>([
		['a done ticket', ticket({ status: 'done', completedAt: '2026-10-07 08:00:00.000Z' }), TODAY],
		['a ticket due today', ticket({ due: TODAY }), TODAY],
		['a ticket without due date', ticket({ due: null }), TODAY],
		['a view without today', ticket(), null]
	])('says nothing for %s', async (_case, item, today) => {
		await show(item, today);
		expect(screen.queryByText(/überfällig seit/)).toBeNull();
		expect(screen.getByLabelText('Fälligkeit').getAttribute('aria-describedby')).toBeNull();
	});
});
