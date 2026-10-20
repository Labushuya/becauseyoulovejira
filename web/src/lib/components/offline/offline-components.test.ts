// The hints, the symbol, the mark and the dialog of the outbox (OF-2, concept OF-0 §2.1, §2.3):
// without a connection a warning without red with "Erneut versuchen" and the number of kept
// changes; conflicts, refusals, changes older than 48 hours and, since OF-2b, those whose time of
// the device lies in the future with "Ansehen"; the dialog "Gemerkte Änderungen" with the choices of
// each state; the mark "Noch nicht übertragen" for screen readers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTO_SEND_MS,
	CLOCK_CODE,
	OFFLINE_TEXTS,
	type ActionOutcome,
	type OutboxAction
} from '$lib/domain/offline';
import { ConnectivityStore } from '$lib/offline/connectivity.svelte';
import { OutboxStore } from '$lib/offline/outbox.svelte';
import { MemoryOutboxStorage } from '$lib/offline/outbox-storage';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import OfflineNotice from './OfflineNotice.svelte';
import OutboxButton from './OutboxButton.svelte';
import OutboxDialog from './OutboxDialog.svelte';
import PendingMark from './PendingMark.svelte';

useOverlayStubs();

const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const LATE = NOW - AUTO_SEND_MS - 1;
const CONFLICT: ActionOutcome = {
	code: 'validation_ticket_conflict',
	message: 'Der Status wurde inzwischen geändert.',
	actual: 'waiting',
	updated: '2026-10-20 12:10:00.000Z'
};

function stored(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: 'tick00000000001',
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 27 * 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

/** A second (or third) action of another ticket. */
function other(index: number, overrides: Partial<OutboxAction> = {}): OutboxAction {
	return stored({
		op: `zzzzzzzzzzzzzzzzzzz${index}`,
		seq: index,
		key: `HAUS-1${index}`,
		target: `tick0000000000${index}`,
		...overrides
	});
}

async function outboxWith(actions: OutboxAction[], reachable = false) {
	const storage = new MemoryOutboxStorage();
	for (const action of actions) await storage.put(action);
	const server = { reachable };
	const connectivity = new ConnectivityStore(async () => server.reachable);
	const refuse = async () => {
		throw new Error('not in these tests');
	};
	const outbox = new OutboxStore({ storage, connectivity, send: refuse, get: refuse, tab: 'a' });
	outbox.attach(USER);
	outbox.setSupport({ version: 1, kinds: ['ticket.update'] });
	outbox.setFrame(true);
	const flags = { show: vi.fn(() => ''), dismiss: vi.fn() };
	outbox.connect({ upsert: vi.fn(), flags, sessionEnded: vi.fn() });
	await vi.advanceTimersByTimeAsync(0);
	await connectivity.check();
	await tick();
	return outbox;
}

function statusText(): string {
	return screen.getByRole('status').textContent ?? '';
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('OfflineNotice', () => {
	it('warns without red that check marks and status are kept, with "Erneut versuchen"', async () => {
		const outbox = await outboxWith([]);
		const { container } = render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(statusText()).toContain(
			'Keine Verbindung zu becauseyoulovejira. Abhaken und Status werden gemerkt und später übertragen.'
		);
		const message = container.querySelector('.section-message');
		expect(message?.getAttribute('data-tone')).toBe('warning');
		const status = screen.getByRole('status');
		expect(within(status).getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
		expect(within(status).queryByRole('button', { name: 'Ansehen' })).toBeNull();
	});

	it('names the kept changes and opens the dialog with "Ansehen"', async () => {
		const outbox = await outboxWith([stored(), other(2)]);
		const onshow = vi.fn();
		render(OfflineNotice, { props: { outbox, onshow } });
		expect(statusText()).toContain(
			'Keine Verbindung. 2 Änderungen sind gemerkt und werden übertragen, sobald die Verbindung zurück ist.'
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }));
		expect(onshow).toHaveBeenCalledTimes(1);
	});

	it('asks for a decision about a conflict, a refusal and a change older than 48 hours', async () => {
		const gone: ActionOutcome = { code: 'not_found', message: 'Nicht gefunden.' };
		const actions = [
			stored({ state: 'conflict', outcome: CONFLICT }),
			other(3, { state: 'refused', outcome: gone }),
			other(4, { createdAt: LATE })
		];
		const outbox = await outboxWith(actions, true);
		const { container } = render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		const text = statusText();
		expect(text).toContain(
			'1 Änderung braucht deine Entscheidung: HAUS-12 wurde inzwischen geändert.'
		);
		expect(text).toContain('1 Änderung konnte nicht übertragen werden. HAUS-13: Nicht gefunden.');
		expect(text).toContain('1 Änderung ist älter als 48 Stunden und wurde nicht übertragen.');
		expect(text).not.toContain('Keine Verbindung');
		const messages = [...container.querySelectorAll('.section-message')];
		const tones = messages.map((element) => element.getAttribute('data-tone'));
		expect(tones).toEqual(['warning', 'error', 'warning']);
		expect(screen.getAllByRole('button', { name: 'Ansehen' })).toHaveLength(3);
	});

	it('names a change whose time of the device lies in the future apart from the old ones (OF-2b)', async () => {
		const clock: ActionOutcome = { code: CLOCK_CODE, message: OFFLINE_TEXTS.clockHint };
		const actions = [stored({ state: 'expired', outcome: clock }), other(2, { createdAt: LATE })];
		const outbox = await outboxWith(actions, true);
		const { container } = render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		const text = statusText();
		expect(text).toContain('1 Änderung ist älter als 48 Stunden und wurde nicht übertragen.');
		expect(text).toContain(
			'Bei 1 Änderung liegt die Zeit des Geräts in der Zukunft; sie wurde nicht übertragen.'
		);
		const tones = [...container.querySelectorAll('.section-message')].map((element) =>
			element.getAttribute('data-tone')
		);
		expect(tones).toEqual(['warning', 'warning']);
	});
});

describe('OutboxButton', () => {
	it('shows "Offline · 2" without a connection and opens the dialog', async () => {
		const outbox = await outboxWith([stored(), other(2)]);
		const onshow = vi.fn();
		render(OutboxButton, { props: { outbox, onshow } });
		const button = screen.getByRole('button', { name: 'Offline, 2 Änderungen gemerkt' });
		expect(button.textContent).toContain('Offline · 2');
		await fireEvent.click(button);
		expect(onshow).toHaveBeenCalledTimes(1);
	});

	it('is not there while the connection stands and nothing waits', async () => {
		const outbox = await outboxWith([], true);
		render(OutboxButton, { props: { outbox, onshow: vi.fn() } });
		expect(screen.queryByRole('button')).toBeNull();
	});
});

describe('PendingMark', () => {
	it('marks a kept change for screen readers and with a title, and a decision in other words', async () => {
		const outbox = await outboxWith([stored(), other(2, { state: 'conflict', outcome: CONFLICT })]);
		const mark = (id: string, box: OutboxStore | null = outbox) =>
			render(PendingMark, { props: { id, outbox: box } }).container;
		const pending = mark('tick00000000001');
		expect(pending.textContent).toBe(', Noch nicht übertragen');
		expect(pending.querySelector('[title="Noch nicht übertragen"] svg')).not.toBeNull();
		expect(mark('tick00000000002').textContent).toBe(', Entscheidung nötig');
		expect(mark('tick00000000003').textContent).toBe('');
		expect(mark('tick00000000001', null).textContent).toBe('');
	});
});

describe('OutboxDialog', () => {
	const href = (id: string) => `/tickets/${id}` as never;

	function dialog() {
		return screen.getByRole('dialog', { name: 'Gemerkte Änderungen' });
	}

	it('lists each kept change with what it does, the time of the device and "Verwerfen"', async () => {
		const outbox = await outboxWith([stored()]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		expect(dialog().textContent).toContain('HAUS-12 erledigt');
		expect(dialog().textContent).toContain('Müll rausbringen');
		expect(dialog().textContent).toContain('offline um 14:03 · wartet');
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Verwerfen' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(outbox.count).toBe(0);
		expect(dialog().textContent).toContain('Keine gemerkten Änderungen.');
	});

	it('shows a conflict with the own change, what happened meanwhile and the three ways', async () => {
		const outbox = await outboxWith([stored({ state: 'conflict', outcome: CONFLICT })], true);
		const changedBy = vi.fn(async () => 'Anna Beispiel');
		const props = { outbox, onclose: vi.fn(), ticketHref: href, changedBy };
		render(OutboxDialog, { props });
		await vi.advanceTimersByTimeAsync(0);
		const text = dialog().textContent;
		expect(text).toContain('Deine Änderung (offline um 14:03 laut Gerät): HAUS-12 erledigt');
		expect(text).toContain(
			'Inzwischen: Anna Beispiel hat den Status auf „Wartet“ gesetzt (14:10).'
		);
		const buttons = within(dialog());
		expect(buttons.getByRole('button', { name: 'Meine Änderung übernehmen' })).toBeTruthy();
		expect(buttons.getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
		const open = buttons.getByRole('link', { name: 'Ticket öffnen' });
		expect(open.getAttribute('href')).toBe('/tickets/tick00000000001');
	});

	it('offers the answers to open sub-tasks and "Trotzdem übertragen" after 48 hours', async () => {
		const open: ActionOutcome = { code: 'validation_parent_open_children', message: '', count: 2 };
		const actions = [stored({ state: 'refused', outcome: open }), other(2, { createdAt: LATE })];
		const outbox = await outboxWith(actions);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const buttons = within(dialog());
		expect(dialog().textContent).toContain('2 Unteraufgaben sind noch offen.');
		expect(buttons.getByRole('button', { name: 'Unteraufgaben mit erledigen' })).toBeTruthy();
		expect(buttons.getByRole('button', { name: 'Trotzdem erledigen' })).toBeTruthy();
		expect(dialog().textContent).toContain('Älter als 48 Stunden, nicht von selbst übertragen.');
		expect(buttons.getByRole('button', { name: 'Trotzdem übertragen' })).toBeTruthy();
	});

	it('says why a change from the future waits and offers "Trotzdem übertragen" and "Verwerfen" (OF-2b)', async () => {
		const clock: ActionOutcome = { code: CLOCK_CODE, message: OFFLINE_TEXTS.clockHint };
		const outbox = await outboxWith([stored({ state: 'expired', outcome: clock })], true);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		expect(dialog().textContent).toContain(
			'Die Zeit des Geräts liegt in der Zukunft, deshalb nicht von selbst übertragen.'
		);
		expect(dialog().textContent).not.toContain('Älter als 48 Stunden');
		const buttons = within(dialog());
		expect(buttons.getByRole('button', { name: 'Trotzdem übertragen' })).toBeTruthy();
		await fireEvent.click(buttons.getByRole('button', { name: 'Verwerfen' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(outbox.count).toBe(0);
	});
});
