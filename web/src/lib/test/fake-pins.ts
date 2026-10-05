// Pins in memory for the tests of the pinned tickets (ADR-0064): a fake data layer of the PinStore
// with the realtime handler it subscribed, so a test can send the changes of another tab.

import { vi } from 'vitest';
import type { RecordChange } from '$lib/data/realtime';
import type { TicketPin } from '$lib/domain/pins';
import type { PinData } from '$lib/stores/pins.svelte';

/** A pin of `ticketId`, pinned at minute `minute` of 2026-09-20, 10 o'clock. */
export function pinOf(ticketId: string, minute: number): TicketPin {
	return {
		id: `pin${ticketId.slice(-12)}`,
		ticket: ticketId,
		created: `2026-09-20 10:${String(minute).padStart(2, '0')}:00.000Z`
	};
}

/** The data layer of the pins over `initial`; new pins get later minutes. */
export function fakePins(initial: readonly TicketPin[] = []) {
	let pins = [...initial];
	let handler: ((change: RecordChange<TicketPin>) => void) | null = null;
	let minute = 30;
	const data = {
		list: vi.fn(async () => [...pins]),
		pin: vi.fn(async (ticketId: string): Promise<TicketPin | null> => {
			minute += 1;
			const pin = pinOf(ticketId, minute);
			pins.push(pin);
			return pin;
		}),
		unpin: vi.fn(async (pinId: string) => {
			pins = pins.filter((pin) => pin.id !== pinId);
		}),
		subscribe: vi.fn(async (onChange: (change: RecordChange<TicketPin>) => void) => {
			handler = onChange;
			return async () => {
				handler = null;
			};
		}),
		reconnected: vi.fn<PinData['reconnected']>(async () => async () => undefined)
	} satisfies PinData;
	return {
		data,
		/** A change of the own pins as realtime brings it (another tab, the server). */
		emit: (change: RecordChange<TicketPin>) => handler?.(change)
	};
}
