// The pin toggle of a ticket (PIN-1, ADR-0064): a native button in the tab order, so Enter and Space
// press it; the same name in both states and aria-pressed for the state; the tooltip says what a
// click does („Anheften“, „Lösen“); busy and locked while the request runs; a refusal of the server
// as an error flag with its reason; nothing for a done ticket or without the pins of the server.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { TicketPin } from '$lib/domain/pins';
import { FlagStore } from '$lib/stores/flags.svelte';
import { PinStore } from '$lib/stores/pins.svelte';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import TicketPinToggle from './TicketPinToggle.svelte';

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const TICKET = { id: 'ticket000000012', key: 'HAUS-12', status: 'open' as const };

async function show(
	pinned: TicketPin[] = [],
	ticket: { id: string; key: string; status: 'open' | 'done' } = TICKET,
	variant: 'row' | 'head' = 'row'
) {
	const fake = fakePins(pinned);
	const flags = new FlagStore();
	const pins = new PinStore(fake.data, SESSION, flags);
	await pins.load();
	const onchanged = vi.fn();
	render(TicketPinToggle, { props: { ticket, pins, variant, onchanged } });
	return { fake, flags, pins, onchanged };
}

const toggle = () => screen.getByRole('button', { name: 'HAUS-12 anheften' });

afterEach(() => {
	document.body.innerHTML = '';
});

describe('pin toggle', () => {
	it('is a native button in the tab order with a fixed name, aria-pressed and the tooltip of its action', async () => {
		const { fake, onchanged } = await show();
		const button = toggle();
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect(button.tabIndex).toBe(0);
		expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(button.getAttribute('title')).toBe('Anheften');
		expect(button.classList.contains('button-icon')).toBe(true);
		expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

		// Enter and Space press a native button, as the click of the keyboard does.
		button.focus();
		button.click();
		await vi.waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe('true'));
		expect(fake.data.pin).toHaveBeenCalledWith(TICKET.id);
		expect(toggle().getAttribute('title')).toBe('Lösen');
		expect(onchanged).toHaveBeenCalledWith(TICKET.id);

		toggle().click();
		await vi.waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe('false'));
		expect(fake.data.unpin).toHaveBeenCalledWith(pinOf(TICKET.id, 31).id);
		expect(toggle().getAttribute('title')).toBe('Anheften');
	});

	it('shows on pointing in a row and always in the head of the detail', async () => {
		await show([], TICKET, 'row');
		expect(toggle().classList.contains('reveal')).toBe(true);
		document.body.innerHTML = '';
		await show([], TICKET, 'head');
		expect(toggle().classList.contains('reveal')).toBe(false);
		expect(toggle().classList.contains('head')).toBe(true);
	});

	it('is busy and locked while the request runs; a second press waits for it', async () => {
		const { fake } = await show();
		let finish: (pin: TicketPin) => void = () => undefined;
		fake.data.pin.mockImplementationOnce(
			() =>
				new Promise<TicketPin | null>((resolve) => {
					finish = resolve;
				})
		);
		await fireEvent.click(toggle());
		expect(toggle().getAttribute('aria-busy')).toBe('true');
		expect(toggle().getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(toggle());
		expect(fake.data.pin).toHaveBeenCalledOnce();

		finish(pinOf(TICKET.id, 40));
		await vi.waitFor(() => expect(toggle().getAttribute('aria-pressed')).toBe('true'));
		expect(toggle().hasAttribute('aria-busy')).toBe(false);
		expect(toggle().hasAttribute('aria-disabled')).toBe(false);
	});

	it('names a refusal of the server in an error flag and stays as it was', async () => {
		const { fake, flags } = await show();
		fake.data.pin.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					ticket: {
						code: 'validation_pin_done',
						message: 'Erledigte Tickets lassen sich nicht anheften.'
					}
				}
			})
		);
		await fireEvent.click(toggle());
		await vi.waitFor(() => expect(flags.flags).toHaveLength(1));
		expect(flags.flags[0]).toMatchObject({
			tone: 'error',
			title: 'HAUS-12 ließ sich nicht anheften.',
			description: 'Erledigte Tickets lassen sich nicht anheften.'
		});
		await tick();
		expect(toggle().getAttribute('aria-pressed')).toBe('false');
	});

	it('offers nothing for a done ticket, but lets a pinned one be released', async () => {
		await show([], { ...TICKET, status: 'done' });
		expect(screen.queryByRole('button', { name: 'HAUS-12 anheften' })).toBeNull();
		document.body.innerHTML = '';
		await show([pinOf(TICKET.id, 10)], { ...TICKET, status: 'done' });
		expect(toggle().getAttribute('aria-pressed')).toBe('true');
	});

	it('offers nothing before the server knows the pins', async () => {
		const fake = fakePins();
		fake.data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		const pins = new PinStore(fake.data, SESSION);
		await pins.load();
		expect(pins.available).toBe(false);
		render(TicketPinToggle, { props: { ticket: TICKET, pins } });
		expect(screen.queryByRole('button', { name: 'HAUS-12 anheften' })).toBeNull();
		document.body.innerHTML = '';
		render(TicketPinToggle, { props: { ticket: TICKET, pins: null } });
		expect(screen.queryByRole('button', { name: 'HAUS-12 anheften' })).toBeNull();
	});
});
