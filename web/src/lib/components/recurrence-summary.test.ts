import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { defaultFormValues, type RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { HistoryEntry, Ticket } from '$lib/domain/ticket';
import type { FlagSink } from '$lib/stores/flags.svelte';
import { REPEAT_FAILED, RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import RecurrenceSummary from './RecurrenceSummary.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

// Recurrence in the ticket panel (E5 plan, package 4): "Wiederholen…" for an open ticket, the
// line "Wiederholt sich: …" with its actions for a ticket in a series, neutral hints, errors of
// refused requests, focus. The store runs for real on a fake data layer.

const TODAY = '2026-09-25';

useOverlayStubs();

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll',
		description: '',
		projectId: null,
		tagIds: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-09-28',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: 'ticket000000001',
		key: 'TASK-3',
		title: 'Müll rausbringen',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: '2026-09-28',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

async function setup(
	item: Ticket,
	rules: RecurrenceRule[] | null = [],
	data: Partial<RecurrenceData> = {},
	/** Runs on the store before the panel opens (an offer of package 6). */
	before: (store: RecurrenceStore) => void = () => undefined,
	/** History of the ticket as the panel loaded it (ADR-0022 addendum 4). */
	history: HistoryEntry[] = []
) {
	const fake: RecurrenceData = {
		listRules: vi.fn(async () => rules),
		createRule: vi.fn(async () => rule({ id: 'rule00000000009' })),
		updateRule: vi.fn(async (id: string) =>
			rule({ id, weekdays: ['TH'], updated: '2026-09-02 10:00:00.000Z' })
		),
		setActive: vi.fn(async (id: string, active: boolean) =>
			rule({ id, active, updated: '2026-09-02 10:00:00.000Z' })
		),
		deleteRule: vi.fn(async () => undefined),
		detachTicket: vi.fn(async (id: string) =>
			ticket({ id, recurring: false, recurrenceId: null, updated: '2026-09-02 10:00:00.000Z' })
		),
		...data
	};
	// Results go out as flags of the store (package 5); the test records their titles.
	const flagTitles: string[] = [];
	const flags: FlagSink = {
		show: (input) => String(flagTitles.push(input.title)),
		dismiss: () => undefined
	};
	const store = new RecurrenceStore(fake, { ensureValid: () => true, logout: vi.fn() }, flags);
	await store.load();
	before(store);
	const onticket = vi.fn();
	render(RecurrenceSummary, { props: { ticket: item, store, today: TODAY, history, onticket } });
	return { fake, store, onticket, flagTitles };
}

describe('RecurrenceSummary', () => {
	it('offers "Wiederholen…" for an open ticket and makes it the first instance', async () => {
		const { fake, onticket, flagTitles } = await setup(ticket());
		const button = screen.getByRole('button', { name: 'Wiederholen…' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');

		await fireEvent.click(button);
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Montag' }).checked).toBe(
			true
		);
		expect(within(dialog).getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-28');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));

		await vi.waitFor(() => expect(onticket).toHaveBeenCalledTimes(1));
		expect(fake.createRule).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Müll rausbringen',
				weekdays: ['MO'],
				anchor: '2026-09-28'
			}),
			'ticket000000001'
		);
		expect(onticket.mock.calls[0]?.[0]).toMatchObject({
			recurring: true,
			recurrenceId: 'rule00000000009',
			due: '2026-09-28'
		});
		expect(flagTitles).toEqual(['Wiederholung angelegt: jeden Montag.']);
	});

	it('names the first date of a ticket without due date and passes it on', async () => {
		const { onticket } = await setup(ticket({ due: null }));
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		expect(
			screen.getByText(
				'Das Ticket hat noch keine Fälligkeit und bekommt den ersten Termin: 25.09.2026.'
			)
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(onticket).toHaveBeenCalledTimes(1));
		expect(onticket.mock.calls[0]?.[0]).toMatchObject({ due: '2026-09-25' });
	});

	it('returns the focus to "Wiederholen…" after Escape through the modal (no own fallback)', async () => {
		await setup(ticket());
		const button = screen.getByRole('button', { name: 'Wiederholen…' });
		// A browser focuses the button on the click; the modal returns the focus to it.
		button.focus();
		await fireEvent.click(button);
		await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
		await tick();
		await tick();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('offers nothing for a done ticket without a series', async () => {
		await setup(ticket({ status: 'done' }));
		expect(screen.queryByRole('button', { name: 'Wiederholen…' })).toBeNull();
	});

	it('says neutrally that recurrences come with the next start', async () => {
		await setup(ticket(), null);
		expect(screen.queryByRole('button', { name: 'Wiederholen…' })).toBeNull();
		expect(
			screen.getByText(/Wiederholungen sind nach dem nächsten Neustart verfügbar/)
		).toBeTruthy();
		expect(document.querySelector('.alert-error')).toBeNull();
	});

	it('shows the series of a ticket and pauses and resumes it', async () => {
		const { fake, flagTitles } = await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()]
		);
		expect(screen.getByText('Wiederholt sich: jeden Montag')).toBeTruthy();
		expect(screen.getByText('Nächstes Ticket am 28.09.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Pausieren' }));
		await vi.waitFor(() => expect(screen.getByText('Pausiert')).toBeTruthy());
		expect(fake.setActive).toHaveBeenCalledWith('rule00000000001', false);
		expect(flagTitles).toEqual(['Regel pausiert.']);
		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }));
		await vi.waitFor(() => expect(flagTitles).toEqual(['Regel pausiert.', 'Regel fortgesetzt.']));
		// No own live region any more: the flag group announces the results.
		expect(document.querySelector('[aria-live]')).toBeNull();
	});

	it('shows the hint of a paused rule neutrally', async () => {
		await setup(ticket({ recurring: true, recurrenceId: 'rule00000000001' }), [
			rule({ active: false, lastHint: 'Projekt archiviert – Regel pausiert.' })
		]);
		const hint = screen.getByText('Projekt archiviert – Regel pausiert.');
		expect(hint.closest('.alert-error')).toBeNull();
		expect(hint.getAttribute('role')).toBeNull();
		expect(screen.getByText('Pausiert')).toBeTruthy();
	});

	it('names the missed dates a catch-up ticket stands for, neutrally (ADR-0022 addendum 4)', async () => {
		const note: HistoryEntry = {
			id: 'hist00000000001',
			ticket: 'ticket000000001',
			field: 'recurrence_skipped',
			oldValue: 'rule00000000001',
			newValue: JSON.stringify({ count: 2, dates: ['2026-10-12', '2026-10-19'], more: false }),
			user: '',
			created: '2026-10-27 10:00:00.000Z'
		};
		await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()],
			{},
			() => undefined,
			[note, { ...note, id: 'hist00000000002', ticket: 'ticket000000002' }]
		);
		const text = screen.getByText(/2 Termine übersprungen \(12\.10\., 19\.10\.\)/);
		expect(text.textContent).toContain('dieses Ticket steht für sie mit.');
		expect(text.closest('.alert-error')).toBeNull();
		expect(screen.getAllByText(/Termine übersprungen/)).toHaveLength(1);
	});

	it('shows a refused resume as an error with its reason', async () => {
		await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule({ active: false })],
			{
				setActive: vi.fn(async () => {
					throw new DataError('validation', {
						status: 400,
						fields: {
							project: {
								code: 'validation_project_archived',
								message: 'Das Projekt ist archiviert.'
							}
						}
					});
				})
			}
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Das Projekt ist archiviert.');
	});

	it('releases the ticket from its series', async () => {
		const { fake, onticket, flagTitles } = await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()]
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Aus der Serie lösen' }));
		await vi.waitFor(() => expect(onticket).toHaveBeenCalledTimes(1));
		expect(fake.detachTicket).toHaveBeenCalledWith('ticket000000001');
		expect(onticket.mock.calls[0]?.[0]).toMatchObject({ recurring: false });
		expect(flagTitles).toEqual(['TASK-3 ist aus der Serie gelöst.']);
	});

	it('edits the rhythm of the rule', async () => {
		const { fake } = await setup(ticket({ recurring: true, recurrenceId: 'rule00000000001' }), [
			rule()
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'Regel bearbeiten' }));
		const dialog = screen.getByRole('dialog', { name: 'Regel bearbeiten' });
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Donnerstag' }));
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Montag' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(fake.updateRule).toHaveBeenCalledWith(
			'rule00000000001',
			expect.objectContaining({ weekdays: ['TH'] })
		);
		expect(screen.getByText('Wiederholt sich: jeden Donnerstag')).toBeTruthy();
	});
});

describe('RecurrenceSummary: "Wiederholen…" prepared from a calendar series (E5 plan, package 6)', () => {
	const series = {
		...defaultFormValues(null, TODAY),
		freq: 'monthly' as const,
		monthDay: '31',
		anchor: '2026-10-31'
	};

	it('opens the prepared dialog at once when the inbox panel handed it over', async () => {
		const { fake, onticket } = await setup(ticket({ due: null }), [], {}, (store) =>
			store.offerRepeat('ticket000000001', series)
		);
		const dialog = await screen.findByRole('dialog', { name: 'Wiederholen…' });
		expect(within(dialog).getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-10-31');
		expect(within(dialog).getByLabelText<HTMLSelectElement>('Einheit').value).toBe('monthly');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(onticket).toHaveBeenCalledTimes(1));
		expect(fake.createRule).toHaveBeenCalledWith(
			expect.objectContaining({ freq: 'monthly', month_day: 31, anchor: '2026-10-31' }),
			'ticket000000001'
		);
		expect(onticket.mock.calls[0]?.[0]).toMatchObject({ recurring: true, due: '2026-10-31' });
	});

	it('shows why the rule failed and offers the prepared dialog, not the default', async () => {
		await setup(ticket(), [], {}, (store) =>
			store.offerRepeat('ticket000000001', series, `${REPEAT_FAILED} Server nicht erreichbar.`)
		);
		expect(screen.getByRole('alert').textContent).toContain(REPEAT_FAILED);
		expect(screen.queryByRole('dialog')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		expect(within(dialog).getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-10-31');
	});

	it('leaves an offer for another ticket or for a ticket in a series alone', async () => {
		const { store } = await setup(ticket(), [], {}, (current) =>
			current.offerRepeat('another00000001', series)
		);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(store.takeOffer('another00000001')).not.toBeNull();
	});

	it('does not open the dialog for a ticket that joined a series meanwhile', async () => {
		await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()],
			{},
			(store) => store.offerRepeat('ticket000000001', series)
		);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('Wiederholt sich: jeden Montag')).toBeTruthy();
	});
});
