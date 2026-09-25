import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import { defaultFormValues } from '$lib/domain/recurrence-rule';
import type { Ticket } from '$lib/domain/ticket';
import type { RecordChange, Unsubscribe } from './realtime';
import { RecurrenceStore, type RecurrenceData, type RecurrenceLive } from './recurrence.svelte';

// RecurrenceStore (E5 plan, T-7 and package 4): loading once, "unavailable" before the migration,
// order, rhythm in words, live events, the actions with their announcements and field errors.

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
		title: 'Steuer',
		description: 'Belege',
		sourceItem: null,
		status: 'open',
		priority: 'high',
		due: '2026-09-28',
		projectId: 'proj00000000001',
		tagIds: ['tag000000000001'],
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

function fakeData(rules: RecurrenceRule[] | null = []): RecurrenceData {
	return {
		listRules: vi.fn(async () => rules),
		createRule: vi.fn(async () => rule({ id: 'rule00000000009' })),
		updateRule: vi.fn(async (id: string) => rule({ id, updated: '2026-09-02 10:00:00.000Z' })),
		setActive: vi.fn(async (id: string, active: boolean) =>
			rule({ id, active, updated: '2026-09-02 10:00:00.000Z' })
		),
		deleteRule: vi.fn(async () => undefined),
		detachTicket: vi.fn(async (id: string) => ticket({ id, recurring: false, recurrenceId: null }))
	};
}

const session = () => ({ ensureValid: vi.fn(() => true), logout: vi.fn() });

function fakeLive() {
	let listener: ((change: RecordChange<RecurrenceRule>) => void) | null = null;
	let reconnect: (() => void) | null = null;
	const stop: Unsubscribe = async () => undefined;
	const live: RecurrenceLive = {
		rules: async (onChange) => {
			listener = onChange;
			return stop;
		},
		reconnected: async (callback) => {
			reconnect = callback;
			return stop;
		}
	};
	return {
		live,
		emit: (change: RecordChange<RecurrenceRule>) => listener?.(change),
		reconnect: () => reconnect?.()
	};
}

describe('RecurrenceStore', () => {
	it('loads the rules once: active first, then by the next ticket', async () => {
		const data = fakeData([
			rule({ id: 'rule00000000001', title: 'Pausiert', active: false, nextDue: '2026-09-01' }),
			rule({ id: 'rule00000000002', title: 'Später', nextDue: '2026-10-05' }),
			rule({
				id: 'rule00000000003',
				title: 'Nach Erledigung',
				mode: 'after_completion',
				nextDue: null
			}),
			rule({ id: 'rule00000000004', title: 'Bald', nextDue: '2026-09-28' })
		]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		await store.load();

		expect(data.listRules).toHaveBeenCalledTimes(1);
		expect(store.state).toBe('ready');
		expect(store.rules.map((item) => item.title)).toEqual([
			'Bald',
			'Später',
			'Nach Erledigung',
			'Pausiert'
		]);
		expect(store.textOf('rule00000000004')).toBe('jeden Montag');
		expect(store.textOf('unknown')).toBe('');
		expect(store.textOf(null)).toBe('');
	});

	it('says neutrally that the rules come with the next start before the migration', async () => {
		const store = new RecurrenceStore(fakeData(null), session());
		await store.load();
		expect(store.state).toBe('unavailable');
		expect(store.error).toBeNull();
		expect(store.rules).toEqual([]);
	});

	it('shows a failed load as an error and loads again on retry', async () => {
		const data = fakeData([rule()]);
		vi.mocked(data.listRules).mockRejectedValueOnce(new DataError('network'));
		const store = new RecurrenceStore(data, session());
		await store.load();
		expect(store.state).toBe('error');
		expect(store.error).toMatch(/Server nicht erreichbar/);
		await store.reload();
		expect(store.state).toBe('ready');
	});

	it('follows live events: newer versions, deletions, reconciliation after a reconnect', async () => {
		const data = fakeData([rule()]);
		const store = new RecurrenceStore(data, session());
		const { live, emit, reconnect } = fakeLive();
		await store.load();
		const stop = store.connect(live);
		await Promise.resolve();

		emit({
			action: 'update',
			record: rule({ weekdays: ['TH'], updated: '2026-09-03 10:00:00.000Z' })
		});
		expect(store.textOf('rule00000000001')).toBe('jeden Donnerstag');
		// An older event does not win.
		emit({
			action: 'update',
			record: rule({ weekdays: ['FR'], updated: '2026-09-02 10:00:00.000Z' })
		});
		expect(store.textOf('rule00000000001')).toBe('jeden Donnerstag');
		emit({ action: 'delete', id: 'rule00000000001' });
		expect(store.rules).toEqual([]);
		// A late create of a deleted rule does not bring it back.
		emit({ action: 'create', record: rule({ updated: '2026-09-09 10:00:00.000Z' }) });
		expect(store.rules).toEqual([]);

		reconnect();
		await vi.waitFor(() => expect(data.listRules).toHaveBeenCalledTimes(2));
		stop();
	});

	it('creates a rule from a ticket ("Wiederholen…") with the ticket as instance', async () => {
		const data = fakeData([]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		const values = defaultFormValues('2026-09-28', '2026-09-25');

		const result = await store.repeat(ticket(), values);

		expect(result.ok).toBe(true);
		expect(data.createRule).toHaveBeenCalledWith(
			{
				title: 'Steuer',
				description: 'Belege',
				project: 'proj00000000001',
				tags: ['tag000000000001'],
				priority: 'high',
				mode: 'calendar',
				freq: 'weekly',
				interval: 1,
				weekdays: ['MO'],
				month_day: 0,
				anchor: '2026-09-28',
				lead_days: 3
			},
			'ticket000000001'
		);
		expect(store.ruleById('rule00000000009')).not.toBeNull();
		expect(store.announcement).toBe('Wiederholung angelegt: jeden Montag.');
	});

	it('pauses, resumes, saves a rhythm, deletes and detaches with announcements', async () => {
		const data = fakeData([rule()]);
		const store = new RecurrenceStore(data, session());
		await store.load();

		expect((await store.setActive('rule00000000001', false)).ok).toBe(true);
		expect(store.announcement).toBe('Regel pausiert.');
		expect(store.ruleById('rule00000000001')?.active).toBe(false);
		await store.setActive('rule00000000001', true);
		expect(store.announcement).toBe('Regel fortgesetzt.');

		const values = { ...defaultFormValues('2026-09-28', '2026-09-25'), weekdays: ['TU' as const] };
		await store.saveRhythm('rule00000000001', values);
		expect(data.updateRule).toHaveBeenCalledWith(
			'rule00000000001',
			expect.objectContaining({ weekdays: ['TU'], month_day: 0 })
		);

		const detached = await store.detach('ticket000000001');
		expect(detached.ok && detached.value.recurring).toBe(false);
		expect(store.announcement).toBe('TASK-3 ist aus der Serie gelöst.');

		await store.deleteRule('rule00000000001');
		expect(store.rules).toEqual([]);
		expect(store.announcement).toBe('Regel gelöscht. Die Tickets bleiben erhalten.');
	});

	it('returns field errors of the server at their field and other refusals as message', async () => {
		const data = fakeData([]);
		vi.mocked(data.createRule)
			.mockRejectedValueOnce(
				new DataError('validation', {
					status: 400,
					fields: {
						weekdays: {
							code: 'validation_recurrence_weekdays',
							message: 'Bitte mindestens einen Wochentag wählen.'
						}
					}
				})
			)
			.mockRejectedValueOnce(new DataError('network'));
		const store = new RecurrenceStore(data, session());
		const values = defaultFormValues(null, '2026-09-25');

		expect(await store.repeat(ticket(), values)).toEqual({
			ok: false,
			message: null,
			fields: { weekdays: 'Bitte mindestens einen Wochentag wählen.' }
		});
		const network = await store.repeat(ticket(), values);
		expect(network.ok).toBe(false);
		expect(!network.ok && network.message).toMatch(/Server nicht erreichbar/);
	});

	it('ends an expired session instead of sending', async () => {
		const data = fakeData([]);
		const guard = { ensureValid: vi.fn(() => false), logout: vi.fn() };
		const store = new RecurrenceStore(data, guard);
		expect(await store.setActive('rule00000000001', false)).toEqual({
			ok: false,
			message: null,
			fields: {}
		});
		expect(data.setActive).not.toHaveBeenCalled();
	});
});
