import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { Ticket } from '$lib/domain/ticket';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
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
	data: Partial<RecurrenceData> = {}
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
	const store = new RecurrenceStore(fake, { ensureValid: () => true, logout: vi.fn() });
	await store.load();
	const onticket = vi.fn();
	render(RecurrenceSummary, { props: { ticket: item, store, today: TODAY, onticket } });
	return { fake, store, onticket };
}

describe('RecurrenceSummary', () => {
	it('offers "Wiederholen…" for an open ticket and makes it the first instance', async () => {
		const { fake, onticket } = await setup(ticket());
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
		expect(screen.getByText('Wiederholung angelegt: jeden Montag.')).toBeTruthy();
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

	it('returns the focus to "Wiederholen…" after Escape', async () => {
		await setup(ticket());
		const button = screen.getByRole('button', { name: 'Wiederholen…' });
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
		expect(screen.getByText(/nach dem nächsten Start der App bereit/)).toBeTruthy();
		expect(document.querySelector('.alert-error')).toBeNull();
	});

	it('shows the series of a ticket and pauses and resumes it', async () => {
		const { fake } = await setup(ticket({ recurring: true, recurrenceId: 'rule00000000001' }), [
			rule()
		]);
		expect(screen.getByText('Wiederholt sich: jeden Montag')).toBeTruthy();
		expect(screen.getByText('Nächstes Ticket am 28.09.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Pausieren' }));
		await vi.waitFor(() => expect(screen.getByText('Pausiert')).toBeTruthy());
		expect(fake.setActive).toHaveBeenCalledWith('rule00000000001', false);
		expect(screen.getByText('Regel pausiert.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }));
		await vi.waitFor(() => expect(screen.getByText('Regel fortgesetzt.')).toBeTruthy());
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
		const { fake, onticket } = await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()]
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Aus der Serie lösen' }));
		await vi.waitFor(() => expect(onticket).toHaveBeenCalledTimes(1));
		expect(fake.detachTicket).toHaveBeenCalledWith('ticket000000001');
		expect(onticket.mock.calls[0]?.[0]).toMatchObject({ recurring: false });
		expect(screen.getByText('TASK-3 ist aus der Serie gelöst.')).toBeTruthy();
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
