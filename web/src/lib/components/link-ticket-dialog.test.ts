// "Mit Ticket verknüpfen …" (ADR-0031 sections 2 and 7): the ticket search as combobox (APG
// pattern: arrow keys, Enter, Escape, status line) and the modal that links one or several entries,
// with failures per entry. Real store with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { TicketChoice } from '$lib/data/tickets';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import LinkTicketDialog from './LinkTicketDialog.svelte';

useOverlayStubs();

const CHOICES: TicketChoice[] = [
	{ id: 'ticket000000004', key: 'TASK-4', title: 'Steuer 2025', status: 'open' },
	{ id: 'ticket000000009', key: 'HAUS-9', title: 'Steuerbescheid prüfen', status: 'done' }
];

function setup(items = [{ id: 'item00000000001', title: 'Brief vom Finanzamt' }]) {
	const data = {
		list: vi.fn<TicketSourcesData['list']>(async () => []),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) => ({
			id,
			channel: 'mail',
			kind: 'mail',
			title: items.find((entry) => entry.id === id)?.title ?? '',
			sourceUrl: '',
			sourceRef: '',
			sourceDate: null,
			sourceMeta: {},
			original: '',
			state: 'converted',
			ticketId,
			handledAt: '2026-09-25 10:00:00.000Z',
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 10:00:00.000Z'
		})),
		release: vi.fn<TicketSourcesData['release']>(),
		search: vi.fn<TicketSourcesData['search']>(async (text) =>
			CHOICES.filter((choice) =>
				`${choice.key} ${choice.title}`.toLowerCase().includes(text.toLowerCase())
			)
		),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
	} satisfies TicketSourcesData;
	const flags = new FlagStore();
	const store = new TicketSourcesStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	const onclose = vi.fn();
	const onlinked = vi.fn();
	render(LinkTicketDialog, { props: { items, store, onclose, onlinked } });
	const input = screen.getByRole('combobox', { name: 'Ticket' }) as HTMLInputElement;
	return { data, flags, onclose, onlinked, input };
}

async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	await fireEvent.input(input);
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('ticket search (combobox)', () => {
	it('searches after a pause, moves with the arrow keys and chooses with Enter', async () => {
		const { data, input } = setup();
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(input.getAttribute('aria-autocomplete')).toBe('list');
		expect(input.getAttribute('aria-describedby')).toBeTruthy();

		await type(input, 'steuer');
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		expect(data.search).toHaveBeenCalledOnce();
		expect(data.search.mock.calls[0]?.[0]).toBe('steuer');
		const listbox = screen.getByRole('listbox', { name: 'Tickets' });
		const options = within(listbox).getAllByRole('option');
		expect(options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'TASK-4 Steuer 2025',
			'HAUS-9 Steuerbescheid prüfen Erledigt'
		]);
		expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
		expect(screen.getByText('2 Tickets gefunden.')).toBeTruthy();

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
		expect(options[1]?.getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('HAUS-9 Steuerbescheid prüfen');
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(screen.getByText('HAUS-9 gewählt.')).toBeTruthy();
	});

	it('closes the list with Escape, then empties the field, and consumes both', async () => {
		const { input } = setup();
		await type(input, 'task');
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		const outside = vi.fn();
		document.addEventListener('keydown', outside);
		try {
			await fireEvent.keyDown(input, { key: 'Escape' });
			expect(input.getAttribute('aria-expanded')).toBe('false');
			expect(input.value).toBe('task');
			await fireEvent.keyDown(input, { key: 'Escape' });
			expect(input.value).toBe('');
			expect(outside).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener('keydown', outside);
		}
		// The dialog is still open: Escape only closed the list and emptied the field.
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('says when nothing is found and chooses with the mouse', async () => {
		const { input } = setup();
		await type(input, 'nichts');
		await vi.waitFor(() => expect(screen.getByText('Kein Ticket gefunden.')).toBeTruthy());
		expect(input.getAttribute('aria-expanded')).toBe('false');
		await type(input, 'task-4');
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.click(screen.getByRole('option', { name: /TASK-4/ }));
		expect(input.value).toBe('TASK-4 Steuer 2025');
	});
});

describe('LinkTicketDialog', () => {
	it('links one entry to the chosen ticket and closes with a flag', async () => {
		const { data, flags, onclose, onlinked, input } = setup();
		const dialog = screen.getByRole('dialog', { name: 'Mit Ticket verknüpfen' });
		expect(
			within(dialog).getByText('„Brief vom Finanzamt“ wird eine Quelle des gewählten Tickets.')
		).toBeTruthy();

		// Without a ticket: a field error, nothing is sent.
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(within(dialog).getByText('Bitte ein Ticket wählen.')).toBeTruthy();
		expect(data.link).not.toHaveBeenCalled();

		await type(input, 'TASK-4');
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));

		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.link).toHaveBeenCalledWith('item00000000001', 'ticket000000004');
		expect(onlinked).toHaveBeenCalledWith(['item00000000001']);
		expect(flags.flags.at(-1)?.title).toBe('1 Eintrag mit TASK-4 verknüpft.');
	});

	it('links several entries and keeps the failed ones with their reason', async () => {
		const { data, onclose, onlinked, input } = setup([
			{ id: 'item00000000001', title: 'Brief' },
			{ id: 'item00000000002', title: 'Mahnung' }
		]);
		data.link.mockImplementation(async (id) => {
			throw new DataError('validation', {
				fields: {
					state: {
						code: 'validation_inbox_item_handled',
						message: `Dieser Eintrag wurde schon bearbeitet. (${id})`
					}
				}
			});
		});
		data.link.mockImplementationOnce(async (id, ticketId) => ({
			id,
			channel: 'mail',
			kind: 'mail',
			title: 'Brief',
			sourceUrl: '',
			sourceRef: '',
			sourceDate: null,
			sourceMeta: {},
			original: '',
			state: 'converted',
			ticketId,
			handledAt: null,
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 10:00:00.000Z'
		}));
		const dialog = screen.getByRole('dialog', { name: '2 Einträge mit Ticket verknüpfen' });
		await type(input, 'steuer');
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));

		const alert = await within(dialog).findByRole('alert');
		expect(alert.textContent).toContain(
			'„Mahnung“: Dieser Eintrag wurde schon bearbeitet. (item00000000002)'
		);
		expect(onlinked).toHaveBeenCalledWith(['item00000000001']);
		expect(onclose).not.toHaveBeenCalled();
		expect(
			within(dialog).getByText('„Mahnung“ wird eine Quelle des gewählten Tickets.')
		).toBeTruthy();
		// The footer says "Schließen" now (next to × of the header), no longer "Abbrechen".
		expect(within(dialog).getAllByRole('button', { name: 'Schließen' })).toHaveLength(2);
		expect(within(dialog).queryByRole('button', { name: 'Abbrechen' })).toBeNull();
	});
});
