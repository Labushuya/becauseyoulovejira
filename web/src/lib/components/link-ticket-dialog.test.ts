// "Mit Ticket verknüpfen …" (ADR-0031 sections 2 and 7) with the ticket picker (ADR-0042): the list
// opens with the dialog without typing, the modal links one or several entries, with failures per
// entry, and tickets of another area than the entries cannot be chosen. Real store with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { PICKER_REASONS } from '$lib/domain/ticket-picker';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import LinkTicketDialog from './LinkTicketDialog.svelte';

useOverlayStubs();

const TAX = pickerTicket({ key: 'TASK-4', title: 'Steuer 2025' });
const NOTICE = pickerTicket({
	key: 'HAUS-9',
	title: 'Steuerbescheid prüfen',
	status: 'done',
	updated: '2026-08-01 10:00:00.000Z'
});
const SHARED = pickerTicket({ key: 'HH-2', title: 'Steuer Haushalt', scope: 'h:house0000000001' });

function linked(id: string, ticketId: string, title: string): InboxItemSummary {
	return {
		id,
		channel: 'mail',
		kind: 'mail',
		title,
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
	};
}

function setup(
	items: { id: string; title: string; scope?: string }[] = [
		{ id: 'item00000000001', title: 'Brief vom Finanzamt', scope: 'u:owner0000000001' }
	]
) {
	const data = {
		list: vi.fn<TicketSourcesData['list']>(async () => []),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) =>
			linked(id, ticketId, items.find((entry) => entry.id === id)?.title ?? '')
		),
		release: vi.fn<TicketSourcesData['release']>(),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
	} satisfies TicketSourcesData;
	const flags = new FlagStore();
	const store = new TicketSourcesStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	const { source, listDone } = fakePickerSource({ open: [TAX, SHARED], done: [NOTICE] });
	const onclose = vi.fn();
	const onlinked = vi.fn();
	render(LinkTicketDialog, { props: { items, store, picker: source, onclose, onlinked } });
	const input = screen.getByRole('combobox', { name: 'Ticket' }) as HTMLInputElement;
	return { data, flags, onclose, onlinked, input, listDone };
}

function option(key: string): HTMLElement {
	const found = screen
		.getAllByRole('option', { hidden: true })
		.find((entry) => entry.querySelector('.key')?.textContent === key);
	if (found === undefined) throw new Error(`No option ${key}`);
	return found;
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('LinkTicketDialog', () => {
	it('opens the list without typing and links one entry to the chosen ticket', async () => {
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

		await fireEvent.focus(input);
		expect(input.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(option('TASK-4'));
		expect(input.value).toBe('TASK-4 Steuer 2025');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));

		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.link).toHaveBeenCalledWith('item00000000001', TAX.id);
		expect(onlinked).toHaveBeenCalledWith(['item00000000001']);
		expect(flags.flags.at(-1)?.title).toBe('1 Eintrag mit TASK-4 verknüpft.');
	});

	it('keeps tickets of another area visible but not choosable', async () => {
		const { input } = setup();
		await fireEvent.focus(input);
		const shared = option('HH-2');
		expect(shared.getAttribute('aria-disabled')).toBe('true');
		expect(shared.textContent).toContain(PICKER_REASONS.otherScope);
		await fireEvent.click(shared);
		expect(input.value).toBe('');
	});

	it('offers done tickets with "Nur offene" switched off', async () => {
		const { input, listDone } = setup();
		await fireEvent.focus(input);
		await fireEvent.click(screen.getByRole('button', { name: 'Nur offene' }));
		await vi.waitFor(() => expect(listDone).toHaveBeenCalled());
		await vi.waitFor(() => expect(option('HAUS-9')).toBeTruthy());
		await fireEvent.click(option('HAUS-9'));
		expect(input.value).toBe('HAUS-9 Steuerbescheid prüfen');
	});

	it('closes the list with Escape first, and the dialog stays open', async () => {
		const { input } = setup();
		await fireEvent.focus(input);
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(screen.getByRole('dialog')).toBeTruthy();
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
		data.link.mockImplementationOnce(async (id, ticketId) => linked(id, ticketId, 'Brief'));
		const dialog = screen.getByRole('dialog', { name: '2 Einträge mit Ticket verknüpfen' });
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'steuer 2025' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('TASK-4 Steuer 2025');
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
