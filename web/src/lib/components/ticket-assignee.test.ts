// "Zuständig" in the fields of panel and full view (E7-5, ADR-0068 §1): only at a ticket of the
// household once the server knows the field, a native select with "Niemand" and the members (the own
// account first, "(ich)"), saved at once, and "Ich übernehme" as one click while the ticket is not
// the own one. A refusal of the server stands at the field. The detail store runs for real on a fake
// data layer.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssigneeContext } from '$lib/domain/assignee';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import type { AssigneeSource } from '$lib/stores/assignees.svelte';
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
const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const HOUSE = 'h:house0000000001';
const CONTEXT: AssigneeContext = {
	selfId: SELF,
	selfName: 'Anna Beispiel',
	names: { nameOf: (id) => (id === BERT ? 'Bert Beispiel' : null) }
};
const ASSIGNEES: AssigneeSource = {
	active: true,
	members: [
		{ id: SELF, name: 'Anna Beispiel', self: true },
		{ id: BERT, name: 'Bert Beispiel', self: false }
	],
	context: CONTEXT
};

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: 'ticket000000001',
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-10-02 10:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z',
		scope: HOUSE,
		assignee: null,
		...overrides
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

async function show(item: Ticket, update?: (patch: TicketPatch) => Promise<Ticket>) {
	let current = item;
	const data = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch) => {
			current = update
				? await update(patch)
				: { ...current, ...(patch.assignee !== undefined && { assignee: patch.assignee }) };
			return current;
		}),
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
			assignees: ASSIGNEES,
			get ticket() {
				return store.ticket as Ticket;
			}
		}
	});
	await tick();
	return { data, store };
}

function field() {
	return screen.getByLabelText<HTMLSelectElement>('Zuständig');
}

describe('"Zuständig" at a ticket of the household (ADR-0068)', () => {
	it('is a select with "Niemand" and the members, the own account first', async () => {
		await show(ticket());
		const select = field();
		expect(select.tagName).toBe('SELECT');
		expect(
			within(select)
				.getAllByRole('option')
				.map((option) => option.textContent)
		).toEqual(['Niemand', 'Anna Beispiel (ich)', 'Bert Beispiel']);
		expect(select.value).toBe('');
	});

	it('saves a chosen member at once and shows the initials', async () => {
		const { data } = await show(ticket());

		await fireEvent.change(field(), { target: { value: BERT } });

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith('ticket000000001', { assignee: BERT })
		);
		await vi.waitFor(() => expect(field().value).toBe(BERT));
		expect(document.querySelector('.assignee-badge')?.getAttribute('title')).toBe(
			'Zuständig: Bert Beispiel'
		);

		await fireEvent.change(field(), { target: { value: '' } });
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenLastCalledWith('ticket000000001', { assignee: null })
		);
	});

	it('takes the ticket over with one click on "Ich übernehme", which then goes away', async () => {
		const { data } = await show(ticket({ assignee: BERT }));
		const button = screen.getByRole('button', { name: 'Ich übernehme' });

		await fireEvent.click(button);

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith('ticket000000001', { assignee: SELF })
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole('button', { name: 'Ich übernehme' })).toBeNull()
		);
		expect(field().value).toBe(SELF);
	});

	it('shows a refusal of the server at the field', async () => {
		await show(ticket(), async () => {
			throw Object.assign(new Error('Failed to update record.'), {
				status: 400,
				response: {
					message: 'Failed to update record.',
					data: { assignee: { code: 'validation_assignee_member', message: 'invalid' } }
				}
			});
		});

		await fireEvent.change(field(), { target: { value: BERT } });

		const error = await screen.findByText('Zuständig sein kann nur ein Mitglied des Haushalts.');
		expect(error.closest('.field-error')?.id).toBe(field().getAttribute('aria-describedby'));
		expect(field().getAttribute('aria-invalid')).toBe('true');
	});

	it.each<[string, Ticket]>([
		['a private ticket', ticket({ scope: 'u:anna00000000001' })],
		['a server before the migration', ticket({ assignee: undefined })]
	])('is not offered for %s', async (_case, item) => {
		await show(item);
		expect(screen.queryByLabelText('Zuständig')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Ich übernehme' })).toBeNull();
	});
});
