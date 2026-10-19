// The choice of new entries of the inbox (InboxEntryChoice, in "Quelle hinzufügen …" and "Neues
// Ticket") with the search of QS-2 (ADR-0031 addendum N): the words and the normalisation of every
// search of the app over title, channel and connection, date, sender, chat and address; the hits
// next to the field and said after a pause; Escape empties the field first; the list follows
// entries that arrive or leave while a search is typed.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { ConnectionNamesStore } from '$lib/stores/connection-names.svelte';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import ConnectionNamesHarness from '$lib/test/ConnectionNamesHarness.svelte';
import InboxEntryChoice from './InboxEntryChoice.svelte';

function entry(id: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id,
		channel: 'quick',
		kind: 'todo',
		title: `Eintrag ${id}`,
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-10-01 08:00:00.000Z',
		updated: '2026-10-01 08:00:00.000Z',
		...overrides
	};
}

const BANK = entry('bank00000000001', { title: 'Anruf Bank' });
const AMT = entry('amt000000000001', {
	channel: 'mail',
	kind: 'mail',
	title: 'Mail vom Amt',
	sourceDate: '2026-09-30 07:00:00.000Z',
	sourceMeta: { from: 'Amt <amt@example.com>' }
});
const FEST = entry('fest00000000001', {
	channel: 'whatsapp',
	kind: 'message',
	title: 'Straßenfest',
	sourceMeta: { chat: 'Nachbarn', sender: 'Ben' }
});

const field = () =>
	screen.getByRole<HTMLInputElement>('searchbox', { name: 'Einträge durchsuchen' });
/** Titles of the entries shown, in their order. */
const titles = () =>
	screen
		.queryAllByRole('checkbox')
		.map((box) => box.closest('label')?.querySelector('.title')?.textContent ?? '');
const described = () => {
	const id = field().getAttribute('aria-describedby');
	return id ? (document.getElementById(id)?.textContent ?? null) : null;
};
const said = () =>
	field().closest('.list-search')?.querySelector('[aria-live="polite"]')?.textContent ?? '';

async function type(value: string) {
	await fireEvent.input(field(), { target: { value } });
}

afterEach(() => {
	cleanup();
});

describe('InboxEntryChoice search (QS-2)', () => {
	it('finds every word in any field and order, without case, umlaut dots and ß', async () => {
		render(InboxEntryChoice, { props: { candidates: [BANK, AMT, FEST] } });
		const label = document.querySelector(`label[for="${field().id}"]`);
		expect(label?.textContent?.trim()).toBe('Einträge durchsuchen');

		// Before QS-2 the text was one phrase over title and the first of sender, chat or address.
		await type('bank anruf');
		expect(titles()).toEqual(['Anruf Bank']);
		await type('STRASSENFEST');
		expect(titles()).toEqual(['Straßenfest']);
		await type('nachbarn');
		expect(titles()).toEqual(['Straßenfest']);
		await type('postfach');
		expect(titles()).toEqual(['Mail vom Amt']);
		await type('30.09.2026 amt@');
		expect(titles()).toEqual(['Mail vom Amt']);
		await type('ämt');
		expect(titles()).toEqual(['Mail vom Amt']);
	});

	it('names the hits next to the field and says them after a pause', async () => {
		render(InboxEntryChoice, { props: { candidates: [BANK, AMT, FEST] } });
		expect(described()).toBeNull();
		await type('amt');
		expect(described()).toBe('1 von 3');
		expect(field().getAttribute('aria-controls')).toBe(screen.getByRole('list').getAttribute('id'));
		await vi.waitFor(() => expect(said()).toBe('1 von 3'), { timeout: 2000 });

		await type(' Mahnung ');
		expect(titles()).toEqual([]);
		expect(screen.getByText('Kein Eintrag passt zu „Mahnung“.')).toBeTruthy();
		expect(described()).toBeNull();
		await vi.waitFor(() => expect(said()).toBe('Kein Eintrag passt zu „Mahnung“.'), {
			timeout: 2000
		});
	});

	it('empties the search on Escape first and lets Escape through when it is empty', async () => {
		render(InboxEntryChoice, { props: { candidates: [BANK, AMT, FEST] } });
		await type('amt');
		expect(titles()).toHaveLength(1);
		// fireEvent answers false when the event was cancelled (consumed).
		expect(await fireEvent.keyDown(field(), { key: 'Escape' })).toBe(false);
		expect(field().value).toBe('');
		expect(titles()).toHaveLength(3);
		expect(await fireEvent.keyDown(field(), { key: 'Escape' })).toBe(true);
	});

	it('keeps a chosen entry chosen while a search hides it', async () => {
		const onchange = vi.fn();
		render(InboxEntryChoice, { props: { candidates: [BANK, AMT, FEST], onchange } });
		await fireEvent.click(screen.getByRole('checkbox', { name: /Anruf Bank/ }));
		expect(onchange).toHaveBeenCalledTimes(1);
		await type('amt');
		expect(screen.queryByRole('checkbox', { name: /Anruf Bank/ })).toBeNull();
		await type('');
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Anruf Bank/ }).checked).toBe(
			true
		);
	});

	it('follows entries that arrive or leave while a search is typed', async () => {
		const { rerender } = render(InboxEntryChoice, { props: { candidates: [BANK, AMT, FEST] } });
		await type('amt');
		expect(titles()).toEqual(['Mail vom Amt']);

		// Every new entry is loaded and follows realtime (InboxStore): a new one is searched at once.
		const later = entry('amt000000000002', { title: 'Antwort vom Amt' });
		await rerender({ candidates: [later, BANK, AMT, FEST] });
		expect(titles()).toEqual(['Antwort vom Amt', 'Mail vom Amt']);
		expect(described()).toBe('2 von 4');

		// Linked to a ticket in another tab: it is no new entry any more and leaves the choice.
		await rerender({ candidates: [later, BANK, FEST] });
		expect(titles()).toEqual(['Antwort vom Amt']);
		expect(described()).toBe('1 von 3');
	});

	it('shows the name of the connection with the channel and finds the entry by it (KK-3)', async () => {
		const names = new ConnectionNamesStore(
			{
				list: async () => [{ id: 'conn00000000001', label: 'Gmail Arbeit' }],
				subscribe: async () => async () => undefined,
				reconnected: async () => async () => undefined
			},
			{ ensureValid: () => true, logout: vi.fn() },
			{ health: new LiveHealth() }
		);
		const stop = names.start();
		render(ConnectionNamesHarness, {
			props: {
				names,
				component: InboxEntryChoice,
				props: { candidates: [BANK, { ...AMT, connectionId: 'conn00000000001' }] }
			}
		});
		const amt = screen.getByRole('checkbox', { name: /Mail vom Amt/ }).closest('label');
		await vi.waitFor(() =>
			expect(within(amt as HTMLElement).getByText(/Postfach · Gmail Arbeit/)).toBeTruthy()
		);
		await type('gmail');
		expect(titles()).toEqual(['Mail vom Amt']);
		stop();
	});
});
