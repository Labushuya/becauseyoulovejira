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
	KEEP_MS,
	OFFLINE_TEXTS,
	type ActionOutcome,
	type DayPlanAction,
	type DueAction,
	type KeptAction,
	type OutboxAction
} from '$lib/domain/offline';
import { ConnectivityStore } from '$lib/offline/connectivity.svelte';
import { OutboxNoWayError, OutboxStore } from '$lib/offline/outbox.svelte';
import { MemoryOutboxStorage } from '$lib/offline/outbox-storage';
import OfflineNoticeHarness from '$lib/test/OfflineNoticeHarness.svelte';
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
/** A check mark of a day gone by, as the server refuses it (OF-3). */
const DAY_OVER: ActionOutcome = {
	code: 'validation_dayplan_readonly',
	message: OFFLINE_TEXTS.dayOver
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

/** A kept check mark of the entry of HAUS-12 in the day plan (OF-3). */
function check(overrides: Partial<DayPlanAction> = {}): DayPlanAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'dayplan.check',
		target: 'item00000000001',
		ticket: 'tick00000000001',
		ticketKind: 'task',
		dependsOn: [],
		payload: { action: 'complete', mode: 'check' },
		expected: { doneToday: false, status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 27 * 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

/** A kept due date of HAUS-12 (OF-3). */
function due(overrides: Partial<DueAction> = {}): DueAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: 'tick00000000001',
		dependsOn: [],
		payload: { due: '2026-10-22' },
		expected: { due: null },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 27 * 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

async function outboxWith(actions: KeptAction[], reachable = false, notices: unknown[] = []) {
	const storage = new MemoryOutboxStorage();
	for (const action of actions) await storage.put(action);
	// Notices of the account on the device (OF-3c), as another tab or an earlier start left them.
	if (notices.length > 0) await storage.notices(USER, () => notices);
	const server = { reachable };
	const connectivity = new ConnectivityStore(async () => server.reachable);
	// Nothing leaves the device in these tests: the error of an app without the way of the kind, so an
	// attempt of the worker before the check of the connection counts as not arrived (OF-3c, R3-2).
	const refuse = async () => {
		throw new OutboxNoWayError();
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
	it('warns without red what is kept, with "Erneut versuchen"', async () => {
		const outbox = await outboxWith([]);
		const { container } = render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(statusText()).toContain(
			'Keine Verbindung zu becauseyoulovejira. Abhaken, Status, Tagesplan und Fälligkeit werden gemerkt und später übertragen.'
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

describe('OfflineNotice (OF-3b round 3)', () => {
	it('names the changes deleted after 7 days and stays until it is closed (R2-2)', async () => {
		const outbox = await outboxWith([stored({ createdAt: NOW - KEEP_MS })], true);
		const { container } = render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		const text =
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: HAUS-12. Bitte im Ticket prüfen.';
		expect(statusText()).toContain(text);
		const message = container.querySelector('.section-message');
		expect(message?.getAttribute('data-tone')).toBe('warning');
		await vi.advanceTimersByTimeAsync(120_000);
		expect(statusText()).toContain(text);
		const close = within(screen.getByRole('status')).getByRole('button', { name: 'Schließen' });
		expect(close.getAttribute('aria-describedby')).not.toBeNull();
		await fireEvent.click(close);
		expect(statusText()).not.toContain(text);
		expect(outbox.notices).toEqual([]);
	});
});

describe('OfflineNotice (OF-3c)', () => {
	/** Two notices about sub-tasks that are not done, as the device keeps them. */
	const children = ['HAUS-13', 'HAUS-14'].map((key, index) => ({
		v: 1,
		id: `child-${index}`,
		kind: 'childNotDone',
		at: NOW - 60_000,
		key,
		parent: 'HAUS-12',
		child: `tick0000000001${index + 3}`,
		after: 1
	}));

	it('moves the focus to the next "Schließen" once a notice is closed, then to the hints (R3-3)', async () => {
		const outbox = await outboxWith([], true, children);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		const status = screen.getByRole('status');
		const [first, second] = within(status).getAllByRole('button', { name: 'Schließen' });
		expect(statusText()).toContain(
			'Unteraufgabe HAUS-13 ist nicht erledigt, obwohl sie mit HAUS-12 erledigt werden sollte. Bitte im Ticket prüfen.'
		);
		first?.focus();
		await fireEvent.click(first as HTMLElement);
		await vi.advanceTimersByTimeAsync(0);
		expect(statusText()).not.toContain('HAUS-13');
		expect(document.activeElement).toBe(second);
		await fireEvent.click(second as HTMLElement);
		await vi.advanceTimersByTimeAsync(0);
		expect(within(status).queryByRole('button', { name: 'Schließen' })).toBeNull();
		expect(status.getAttribute('tabindex')).toBe('-1');
		expect(document.activeElement).toBe(status);
	});

	it.each([
		{ heading: true, target: 'heading' },
		{ heading: false, target: 'main' }
	])(
		'moves the focus to the $target once the region goes with the last notice outside the phone frame (round 2, C-3)',
		async ({ heading, target }) => {
			const outbox = await outboxWith([], true, children);
			// Outside the phone frame without kept changes the layout shows the hints only for the notices.
			outbox.setFrame(false);
			await tick();
			expect(outbox.watching).toBe(false);
			render(OfflineNoticeHarness, { props: { outbox, heading } });
			const status = screen.getByRole('status');
			const [first, second] = within(status).getAllByRole('button', { name: 'Schließen' });
			first?.focus();
			await fireEvent.click(first as HTMLElement);
			await vi.advanceTimersByTimeAsync(0);
			expect(document.activeElement).toBe(second);
			await fireEvent.click(second as HTMLElement);
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.queryByRole('status')).toBeNull();
			const expected =
				target === 'heading'
					? screen.getByRole('heading', { name: 'Aufgaben' })
					: screen.getByRole('main');
			expect(document.activeElement).toBe(expected);
			expect(document.activeElement).not.toBe(document.body);
		}
	);
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

	it('marks an entry of the day plan with a kept check mark, and the ticket it completes (OF-3)', async () => {
		const today = check({
			op: 'zzzzzzzzzzzzzzzzzzz2',
			target: 'item00000000002',
			ticket: 'tick00000000002',
			payload: { action: 'today', mode: 'today' }
		});
		const outbox = await outboxWith([check(), today]);
		const mark = (id: string) => render(PendingMark, { props: { id, outbox } }).container;
		expect(mark('item00000000001').textContent).toBe(', Noch nicht übertragen');
		expect(mark('tick00000000001').textContent).toBe(', Noch nicht übertragen');
		expect(mark('item00000000002').textContent).toBe(', Noch nicht übertragen');
		// A check of the day leaves its ticket as it is: no mark there.
		expect(mark('tick00000000002').textContent).toBe('');
	});
});

describe('OfflineNotice (OF-3)', () => {
	it('names a check mark of a day gone by as refused, with its reason', async () => {
		const outbox = await outboxWith([check({ state: 'refused', outcome: DAY_OVER })], true);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(statusText()).toContain(
			'1 Änderung konnte nicht übertragen werden. HAUS-12: Der Tag ist vorbei, der Plan dieses Tages bleibt unverändert.'
		);
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

	it('asks whether to complete the task of a check mark of a day gone by, and lets one of an ongoing project lapse (OF-3)', async () => {
		const over = DAY_OVER;
		const actions = [
			check({ state: 'refused', outcome: over }),
			check({
				op: 'zzzzzzzzzzzzzzzzzzz2',
				seq: 2,
				key: 'HAUS-13',
				target: 'item00000000002',
				ticket: 'tick00000000002',
				ticketKind: 'ongoing',
				payload: { action: 'today', mode: 'check' },
				state: 'refused',
				outcome: over
			})
		];
		const outbox = await outboxWith(actions);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const [task, ongoing] = within(dialog()).getAllByRole('listitem');
		expect(task?.textContent).toContain('HAUS-12 im Tagesplan erledigt');
		expect(task?.textContent).toContain('Der Tag ist vorbei. HAUS-12 trotzdem erledigen?');
		expect(within(task as HTMLElement).getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
		expect(ongoing?.textContent).toContain('HAUS-13 im Tagesplan für heute abgehakt');
		expect(ongoing?.textContent).toContain(
			'Der Tag ist vorbei, der Plan dieses Tages bleibt unverändert. Der Haken verfällt.'
		);
		const lapsed = within(ongoing as HTMLElement);
		expect(lapsed.queryByRole('button', { name: 'Trotzdem erledigen' })).toBeNull();
		const choices = within(task as HTMLElement);
		await fireEvent.click(choices.getByRole('button', { name: 'Trotzdem erledigen' }));
		await vi.advanceTimersByTimeAsync(0);
		const completion = outbox.actions.find((action) => action.kind === 'ticket.update');
		expect(completion).toMatchObject({ target: 'tick00000000001', payload: { status: 'done' } });
	});

	it('refuses a changed check mark with its reason and opens the ticket, not the entry (OF-3)', async () => {
		const changed: ActionOutcome = {
			code: 'validation_dayplan_conflict',
			message: 'Der Haken wurde inzwischen geändert.'
		};
		const outbox = await outboxWith([check({ state: 'refused', outcome: changed })]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		expect(dialog().textContent).toContain('Der Haken wurde inzwischen geändert.');
		const open = within(dialog()).getByRole('link', { name: 'Ticket öffnen' });
		expect(open.getAttribute('href')).toBe('/tickets/tick00000000001');
	});

	it('names a kept due date and what happened to the due date meanwhile (OF-3)', async () => {
		const moved: ActionOutcome = {
			code: 'validation_ticket_conflict',
			message: 'Die Fälligkeit wurde inzwischen geändert.',
			actual: '2026-10-25 00:00:00.000Z',
			updated: '2026-10-20 12:10:00.000Z'
		};
		const outbox = await outboxWith([
			due(),
			due({
				op: 'zzzzzzzzzzzzzzzzzzz2',
				seq: 2,
				key: 'HAUS-13',
				target: 'tick00000000002',
				state: 'conflict',
				outcome: moved
			})
		]);
		const changedBy = vi.fn(async () => 'Anna Beispiel');
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href, changedBy } });
		await vi.advanceTimersByTimeAsync(0);
		const text = dialog().textContent;
		expect(text).toContain('HAUS-12 fällig am 22.10.2026');
		expect(text).toContain(
			'Deine Änderung (offline um 14:03 laut Gerät): HAUS-13 fällig am 22.10.2026'
		);
		expect(text).toContain(
			'Inzwischen: Anna Beispiel hat die Fälligkeit auf 25.10.2026 gesetzt (14:10).'
		);
	});

	it('says that a discarded change is taken back once there is a connection, and names its counter action (OF-3)', async () => {
		const original = stored({ sent: true, unanswered: true, discarded: true });
		const counter = stored({
			op: 'zzzzzzzzzzzzzzzzzzz2',
			seq: 2,
			dependsOn: [original.op],
			undoes: original.op,
			payload: { status: 'open' },
			expected: { status: 'done' }
		});
		const outbox = await outboxWith([original, counter]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const [first, second] = within(dialog()).getAllByRole('listitem');
		expect(first?.textContent).toContain(
			'offline um 14:03 · wird zurückgenommen, sobald eine Verbindung besteht'
		);
		expect(within(first as HTMLElement).queryByRole('button', { name: 'Verwerfen' })).toBeNull();
		expect(second?.textContent).toContain('Rücknahme: HAUS-12 auf „Offen“');
		// Since OF-3b round 2 (S2) a take-back has no "Verwerfen" of its own and says why; since round
		// 3 (R2-5) the way that always works first, "Rückgängig" only right after "Verwerfen".
		expect(within(second as HTMLElement).queryByRole('button', { name: 'Verwerfen' })).toBeNull();
		expect(second?.textContent).toContain(
			'Nimmt eine verworfene Änderung zurück. Wer es sich anders überlegt, setzt den Wert neu; direkt nach dem Verwerfen geht auch „Rückgängig“ im Hinweis.'
		);
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

describe('OutboxDialog (OF-3b)', () => {
	const href = (id: string) => `/tickets/${id}` as never;

	function dialog() {
		return screen.getByRole('dialog', { name: 'Gemerkte Änderungen' });
	}

	it('asks whether to open the ticket again when taking back a completion was refused for a day gone by (M4)', async () => {
		const back = check({
			kind: 'dayplan.uncheck',
			payload: { action: 'complete', status: 'open' },
			expected: { doneToday: false, status: 'done' },
			state: 'refused',
			outcome: DAY_OVER
		});
		const outbox = await outboxWith([back]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		expect(dialog().textContent).toContain('HAUS-12 im Tagesplan wieder offen');
		expect(dialog().textContent).toContain('Der Tag ist vorbei. HAUS-12 trotzdem wieder öffnen?');
		const buttons = within(dialog());
		expect(buttons.getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
		await fireEvent.click(buttons.getByRole('button', { name: 'Trotzdem wieder öffnen' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(outbox.actions).toMatchObject([
			{ kind: 'ticket.update', target: 'tick00000000001', payload: { status: 'open' } }
		]);
	});

	it('says that a discarded change refused with 404 may have arrived, and lets it go on "Verwerfen" (M2)', async () => {
		const gone: ActionOutcome = { code: 'not_found', message: 'Nicht gefunden.' };
		const refused = stored({
			sent: true,
			unanswered: true,
			discarded: true,
			state: 'refused',
			outcome: gone
		});
		const outbox = await outboxWith([refused]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const [first] = within(dialog()).getAllByRole('listitem');
		expect(first?.textContent).toContain('Nicht gefunden.');
		expect(first?.textContent).toContain(
			'Die Änderung ist vielleicht schon angekommen und ließ sich nicht zurücknehmen. Bitte im Ticket prüfen.'
		);
		await fireEvent.click(within(first as HTMLElement).getByRole('button', { name: 'Verwerfen' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(outbox.count).toBe(0);
	});

	it('names a discarded change whose value a later change sets without saying it is taken back', async () => {
		const original = stored({ sent: true, unanswered: true, discarded: true });
		const later = stored({
			op: 'zzzzzzzzzzzzzzzzzzz2',
			seq: 2,
			dependsOn: [original.op],
			payload: { status: 'in_progress' },
			expected: { status: 'done' }
		});
		const outbox = await outboxWith([original, later]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const [first, second] = within(dialog()).getAllByRole('listitem');
		expect(first?.textContent).toContain(
			'offline um 14:03 · verworfen, es gilt die spätere Änderung'
		);
		expect(first?.textContent).not.toContain('wird zurückgenommen');
		expect(second?.textContent).toContain('HAUS-12 auf „In Arbeit“');
	});
});

describe('OutboxDialog (OF-3b round 2)', () => {
	const href = (id: string) => `/tickets/${id}` as never;
	const lost = { sent: true as const, unanswered: true as const, discarded: true as const };

	function dialog() {
		return screen.getByRole('dialog', { name: 'Gemerkte Änderungen' });
	}

	it('says of two discarded changes that both are taken back, not that the later one counts', async () => {
		const first = stored(lost);
		const later = stored({
			...lost,
			op: 'zzzzzzzzzzzzzzzzzzz2',
			seq: 2,
			dependsOn: [first.op],
			payload: { status: 'in_progress' },
			expected: { status: 'done' }
		});
		const back = stored({
			op: 'zzzzzzzzzzzzzzzzzzz3',
			seq: 3,
			dependsOn: [first.op, later.op],
			undoes: later.op,
			payload: { status: 'open' },
			expected: { status: 'in_progress' }
		});
		const outbox = await outboxWith([first, later, back]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		const rows = within(dialog()).getAllByRole('listitem');
		expect(rows.map((row) => row.textContent?.includes(OFFLINE_TEXTS.takingBack))).toEqual([
			true,
			true,
			false
		]);
		expect(dialog().textContent).not.toContain(OFFLINE_TEXTS.discardedLater);
		expect(within(rows[2] as HTMLElement).queryByRole('button', { name: 'Verwerfen' })).toBeNull();
	});

	it('names the sub-tasks of a discarded completion whose status before is unknown', async () => {
		const completion = stored({
			...lost,
			completion: 'complete_children',
			children: ['tick00000000003', 'tick00000000004'],
			childrenBefore: [null, 'open']
		});
		const outbox = await outboxWith([completion]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref: href } });
		expect(dialog().textContent).toContain(OFFLINE_TEXTS.childrenUnknown(1));
	});
});
