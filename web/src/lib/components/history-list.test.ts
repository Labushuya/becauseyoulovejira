// Component tests for the history (E2 plan, package 10) and the tabs "Kommentare" / "Verlauf"
// (T-11): readable entries with time, actor and text, the collapsible description as plain text,
// "System" for an empty actor, "(gelöscht)" for unknown IDs, keyboard use of the tabs.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { HistoryEntry } from '$lib/domain/ticket';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import TicketActivity from './TicketActivity.svelte';

const TICKET = 'ticket000000001';
const ME = 'user0000000001';

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
	return {
		id: 'hist00000000001',
		ticket: TICKET,
		field: 'created',
		oldValue: '',
		newValue: 'TASK-3',
		user: ME,
		created: '2026-09-24 09:00:00.000Z',
		...overrides
	};
}

const HISTORY: HistoryEntry[] = [
	entry({
		id: 'h4',
		field: 'description',
		oldValue: '**alt**',
		newValue: '<script>neu</script>',
		created: '2026-09-24 12:00:00.000Z'
	}),
	entry({
		id: 'h3',
		field: 'project',
		oldValue: '',
		newValue: 'proj00000000009',
		user: '',
		created: '2026-09-24 11:00:00.000Z'
	}),
	entry({
		id: 'h2',
		field: 'status',
		oldValue: 'open',
		newValue: 'in_progress',
		created: '2026-09-24 10:00:00.000Z'
	}),
	entry({ id: 'h1' })
];

async function renderActivity(history: HistoryEntry[] = HISTORY) {
	const data = {
		listComments: vi.fn(async () => []),
		createComment: vi.fn(),
		updateComment: vi.fn(),
		deleteComment: vi.fn(),
		listHistory: vi.fn<TicketActivityData['listHistory']>(async () => history),
		listProjects: vi.fn(async () => []),
		listTags: vi.fn(async () => [])
	} satisfies TicketActivityData;
	const store = new TicketActivityStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		() => ME
	);
	store.open(TICKET);
	const result = render(TicketActivity, { props: { store } });
	await vi.waitFor(() => expect(store.historyState).not.toBe('loading'));
	await tick();
	return { ...result, store, data };
}

function tab(name: string) {
	return screen.getByRole('tab', { name: new RegExp(`^${name}`) });
}

describe('activity tabs', () => {
	it('selects "Kommentare" first and shows only its panel', async () => {
		await renderActivity();

		expect(screen.getByRole('tablist', { name: 'Aktivität' })).toBeTruthy();
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('false');
		expect(tab('Kommentare').tabIndex).toBe(0);
		expect(tab('Verlauf').tabIndex).toBe(-1);
		expect(screen.getByRole('tabpanel', { name: /^Kommentare/ })).toBeTruthy();
		expect(screen.queryByRole('tabpanel', { name: 'Verlauf' })).toBeNull();
	});

	it('switches with the mouse and with the arrow keys, Home and End', async () => {
		await renderActivity();

		await fireEvent.click(tab('Verlauf'));
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tabpanel', { name: 'Verlauf' })).toBeTruthy();

		await fireEvent.keyDown(tab('Verlauf'), { key: 'ArrowRight' });
		expect(document.activeElement).toBe(tab('Kommentare'));
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Kommentare'), { key: 'ArrowLeft' });
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Verlauf'), { key: 'Home' });
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Kommentare'), { key: 'End' });
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');
	});

	it('keeps a comment being written when switching tabs', async () => {
		await renderActivity();
		const field = screen.getByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)');
		await fireEvent.input(field, { target: { value: 'Entwurf' } });

		await fireEvent.click(tab('Verlauf'));
		await fireEvent.click(tab('Kommentare'));

		expect(screen.getByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)').value).toBe(
			'Entwurf'
		);
	});
});

describe('history list', () => {
	it('shows each entry newest first with actor, time and readable text', async () => {
		await renderActivity();
		await fireEvent.click(tab('Verlauf'));
		const panel = screen.getByRole('tabpanel', { name: 'Verlauf' });

		const items = within(panel).getAllByRole('listitem');
		expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Du 24.09.2026 14:00 Beschreibung geändert Vorher **alt** Nachher <script>neu</script>',
			'System 24.09.2026 13:00 Projekt: – → (gelöscht)',
			'Du 24.09.2026 12:00 Status: Offen → In Arbeit',
			'Du 24.09.2026 11:00 hat das Ticket angelegt (TASK-3)'
		]);
	});

	it('opens the old and new description as plain text', async () => {
		await renderActivity();
		await fireEvent.click(tab('Verlauf'));
		const details = screen.getByText('Beschreibung geändert').closest('details');

		expect(details?.open).toBe(false);
		await fireEvent.click(screen.getByText('Beschreibung geändert'));
		expect(details?.querySelector('script, strong')).toBeNull();
		expect(within(details as HTMLElement).getByText('<script>neu</script>').tagName).toBe('PRE');
	});

	it('shows the empty state', async () => {
		await renderActivity([]);
		await fireEvent.click(tab('Verlauf'));

		expect(screen.getByText('Noch kein Verlauf.')).toBeTruthy();
	});

	it('shows a loading error with "Erneut versuchen"', async () => {
		const data = {
			listComments: vi.fn(async () => []),
			createComment: vi.fn(),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi
				.fn<TicketActivityData['listHistory']>()
				.mockRejectedValueOnce(new DataError('server', { status: 500 }))
				.mockResolvedValueOnce([entry({})]),
			listProjects: vi.fn(async () => []),
			listTags: vi.fn(async () => [])
		} satisfies TicketActivityData;
		const store = new TicketActivityStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			() => ME
		);
		store.open(TICKET);
		render(TicketActivity, { props: { store } });
		await vi.waitFor(() => expect(store.historyState).toBe('error'));
		await fireEvent.click(tab('Verlauf'));

		const alert = screen.getByText(/Der Server hat mit einem Fehler geantwortet/);
		expect(alert.closest('.alert-error')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() =>
			expect(screen.getByText('hat das Ticket angelegt (TASK-3)')).toBeTruthy()
		);
	});
});
