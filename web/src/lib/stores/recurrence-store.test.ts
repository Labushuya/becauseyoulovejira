import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import {
	CATCH_UP_ALL_HINT,
	CATCH_UP_ASK_HINT,
	defaultFormValues
} from '$lib/domain/recurrence-rule';
import type { Ticket } from '$lib/domain/ticket';
import type { FlagInput, FlagSink } from './flags.svelte';
import type { RecordChange, Unsubscribe } from './realtime';
import {
	REPEAT_FAILED,
	RecurrenceStore,
	waitingTitle,
	type RecurrenceData,
	type RecurrenceLive
} from './recurrence.svelte';

// RecurrenceStore (E5 plan, T-7 and package 4): loading once, "unavailable" before the migration,
// order, rhythm in words, live events, the actions with their success flags (package 5) and field
// errors.

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

/** Flag sink that records what the store shows (E5 plan, package 5). */
function recordedFlags() {
	const shown: { tone: string; title: string }[] = [];
	const sink: FlagSink = {
		show: (input) => {
			shown.push({ tone: input.tone, title: input.title });
			return String(shown.length);
		},
		dismiss: () => undefined
	};
	return { sink, shown, last: () => shown.at(-1)?.title };
}

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
		const flags = recordedFlags();
		const store = new RecurrenceStore(data, session(), flags.sink);
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
				lead_days: 3,
				each_occurrence: false
			},
			'ticket000000001'
		);
		expect(store.ruleById('rule00000000009')).not.toBeNull();
		expect(flags.shown).toEqual([
			{ tone: 'success', title: 'Wiederholung angelegt: jeden Montag.' }
		]);
	});

	it('pauses, resumes, saves a rhythm, deletes and detaches with success flags', async () => {
		const data = fakeData([rule()]);
		const flags = recordedFlags();
		const store = new RecurrenceStore(data, session(), flags.sink);
		await store.load();

		expect((await store.setActive('rule00000000001', false)).ok).toBe(true);
		expect(flags.last()).toBe('Regel pausiert.');
		expect(store.ruleById('rule00000000001')?.active).toBe(false);
		await store.setActive('rule00000000001', true);
		expect(flags.last()).toBe('Regel fortgesetzt.');

		const values = { ...defaultFormValues('2026-09-28', '2026-09-25'), weekdays: ['TU' as const] };
		await store.saveRhythm('rule00000000001', values);
		expect(data.updateRule).toHaveBeenCalledWith(
			'rule00000000001',
			expect.objectContaining({ weekdays: ['TU'], month_day: 0 })
		);

		const detached = await store.detach('ticket000000001');
		expect(detached.ok && detached.value.recurring).toBe(false);
		expect(flags.last()).toBe('TASK-3 ist aus der Serie gelöst.');

		await store.deleteRule('rule00000000001');
		expect(store.rules).toEqual([]);
		expect(flags.last()).toBe('Regel gelöscht. Die Tickets bleiben erhalten.');
		expect(flags.shown.every((flag) => flag.tone === 'success')).toBe(true);
		expect(flags.shown).toHaveLength(5);
	});

	it('shows no flag for a refused action and stays silent without a flag sink', async () => {
		const data = fakeData([rule()]);
		vi.mocked(data.setActive).mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { project: { code: 'validation_project_archived', message: 'Archiviert.' } }
			})
		);
		const flags = recordedFlags();
		const store = new RecurrenceStore(data, session(), flags.sink);
		await store.load();

		const refused = await store.setActive('rule00000000001', true);
		expect(refused).toEqual({ ok: false, message: null, fields: { project: 'Archiviert.' } });
		expect(flags.shown).toEqual([]);

		const silent = new RecurrenceStore(fakeData([rule()]), session());
		await silent.load();
		expect((await silent.setActive('rule00000000001', false)).ok).toBe(true);
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

describe('RecurrenceStore: a series from the inbox (E5 plan, package 6)', () => {
	const values = { ...defaultFormValues('2026-10-05', '2026-09-25'), weekdays: ['MO' as const] };

	it('creates the rule for a converted ticket with the ticket as its instance', async () => {
		const data = fakeData([]);
		const store = new RecurrenceStore(data, session());
		const created = await store.repeatCreated(ticket({ due: null }), values);
		expect(created?.id).toBe('rule00000000009');
		expect(data.createRule).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Steuer', freq: 'weekly', weekdays: ['MO'] }),
			'ticket000000001'
		);
		expect(store.takeOffer('ticket000000001')).toBeNull();
	});

	it('keeps the ticket when the rule fails and offers "Wiederholen…" with the reason, once', async () => {
		const data = fakeData([]);
		vi.mocked(data.createRule)
			.mockRejectedValueOnce(
				new DataError('validation', {
					status: 400,
					fields: {
						ticket: {
							code: 'validation_recurrence_ticket_linked',
							message: 'Das Ticket gehört schon zu einer Serie.'
						}
					}
				})
			)
			.mockRejectedValueOnce(new DataError('network'));
		const store = new RecurrenceStore(data, session());

		expect(await store.repeatCreated(ticket(), values)).toBeNull();
		expect(store.takeOffer('another00000001')).toBeNull();
		const offer = store.takeOffer('ticket000000001');
		expect(offer).toEqual({
			ticketId: 'ticket000000001',
			values,
			message: `${REPEAT_FAILED} Das Ticket gehört schon zu einer Serie.`
		});
		// The offer holds a copy: the form may change its values without touching the caller's.
		expect(offer?.values).not.toBe(values);
		expect(store.takeOffer('ticket000000001')).toBeNull();

		expect(await store.repeatCreated(ticket(), values)).toBeNull();
		expect(store.takeOffer('ticket000000001')?.message).toMatch(
			new RegExp(`^${REPEAT_FAILED} .*Server nicht erreichbar`)
		);
	});

	it('hands values from the inbox panel to the ticket panel; the newest offer wins, logout drops it', () => {
		const store = new RecurrenceStore(fakeData([]), session());
		store.offerRepeat('ticket000000001', values);
		store.offerRepeat('ticket000000002', values);
		expect(store.takeOffer('ticket000000001')).toBeNull();
		expect(store.takeOffer('ticket000000002')).toEqual({
			ticketId: 'ticket000000002',
			values,
			message: null
		});
		store.offerRepeat('ticket000000003', values);
		store.reset();
		expect(store.takeOffer('ticket000000003')).toBeNull();
	});
});

// Plan "Wiederholungen verständlich machen", recommendation 5 (ADR-0022 addendum 5).
describe('RecurrenceStore: a large backlog', () => {
	const TODAY = '2026-09-25';
	const waiting = rule({
		id: 'rule00000000005',
		title: 'Tabletten',
		freq: 'daily',
		weekdays: [],
		anchor: '2026-08-01',
		nextDue: '2026-09-01',
		eachOccurrence: true,
		lastHint: CATCH_UP_ASK_HINT
	});

	it('knows the rules that wait and sends the choice with a flag that names the dates', async () => {
		const data = fakeData([rule(), waiting]);
		vi.mocked(data.updateRule).mockImplementation(async (id, patch) =>
			patch.backlog === 'today'
				? { ...waiting, id, nextDue: TODAY, lastHint: '', updated: '2026-09-25 10:00:00.000Z' }
				: { ...waiting, id, lastHint: CATCH_UP_ALL_HINT, updated: '2026-09-25 10:00:00.000Z' }
		);
		const flags = recordedFlags();
		const store = new RecurrenceStore(data, session(), flags.sink);
		await store.load();
		expect(store.waiting.map((entry) => entry.id)).toEqual(['rule00000000005']);

		await store.decideBacklog('rule00000000005', 'all', TODAY);
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000005', { backlog: 'all' });
		expect(flags.last()).toBe(
			'24 Termine (01.09. bis 24.09.) werden nachgeholt, höchstens 20 je Lauf.'
		);
		expect(store.waiting).toEqual([]);

		store.upsert({ ...waiting, updated: '2026-09-25 11:00:00.000Z' });
		await store.decideBacklog('rule00000000005', 'today', TODAY);
		expect(flags.last()).toBe('24 Termine (01.09. bis 24.09.) übersprungen. Weiter am 25.09.');
	});

	it('announces waiting rules in one flag with "Ansehen", and nothing without', async () => {
		const shown: FlagInput[] = [];
		const dismissed: string[] = [];
		const sink: FlagSink = {
			show: (input) => String(shown.push(input)),
			dismiss: (id) => void dismissed.push(id)
		};
		const open = vi.fn();
		const store = new RecurrenceStore(fakeData([rule(), waiting]), session(), sink);
		await store.load();

		store.announceWaiting(open);
		expect(shown[0]).toMatchObject({
			tone: 'info',
			title: '1 Wiederholung wartet auf deine Entscheidung.',
			description:
				'Viele Termine haben noch kein Ticket. Wähle „Alle nachholen“ oder „Nur ab heute“.'
		});
		shown[0]?.action?.run();
		expect(open).toHaveBeenCalledWith('rule00000000005');

		// Again (the app was opened again): the newer flag replaces the older one.
		store.upsert({ ...waiting, id: 'rule00000000006', title: 'Vitamine' });
		store.announceWaiting(open);
		expect(dismissed).toEqual(['1']);
		expect(shown[1]?.title).toBe('2 Wiederholungen warten auf deine Entscheidung.');
		shown[1]?.action?.run();
		expect(open).toHaveBeenLastCalledWith(null);

		const quiet = new RecurrenceStore(fakeData([rule()]), session(), sink);
		await quiet.load();
		quiet.announceWaiting(open);
		expect(shown).toHaveLength(2);
		expect(waitingTitle(3)).toBe('3 Wiederholungen warten auf deine Entscheidung.');
	});
});

describe('RecurrenceStore: "Jeden Termin einzeln anlegen" (plan OR-5)', () => {
	const values = defaultFormValues('2026-09-28', '2026-09-25');

	it('offers the switch only once the server knows it, and forgets it on logout', async () => {
		const data = { ...fakeData([rule()]), eachOccurrenceReady: vi.fn(async () => true) };
		const store = new RecurrenceStore(data, session());
		expect(store.eachReady).toBe(false);
		await store.load();
		expect(store.eachReady).toBe(true);
		expect(data.eachOccurrenceReady).toHaveBeenCalledOnce();
		store.reset();
		expect(store.eachReady).toBe(false);
	});

	it('leaves it out before the migration, without a probe and when the probe fails', async () => {
		const before = new RecurrenceStore(
			{ ...fakeData([rule()]), eachOccurrenceReady: vi.fn(async () => false) },
			session()
		);
		await before.load();
		expect(before.state).toBe('ready');
		expect(before.eachReady).toBe(false);

		const without = new RecurrenceStore(fakeData([rule()]), session());
		await without.load();
		expect(without.eachReady).toBe(false);

		const failing = new RecurrenceStore(
			{
				...fakeData([rule()]),
				eachOccurrenceReady: vi.fn(async () => {
					throw new Error('offline');
				})
			},
			session()
		);
		await failing.load();
		expect(failing.state).toBe('ready');
		expect(failing.eachReady).toBe(false);

		// Before E5 there are no rules at all, so there is nothing to offer either.
		const unavailable = new RecurrenceStore(
			{ ...fakeData(null), eachOccurrenceReady: vi.fn(async () => true) },
			session()
		);
		await unavailable.load();
		expect(unavailable.eachReady).toBe(false);
	});

	it('sends the switch with a rule from a ticket and shows a refusal at its field', async () => {
		const data = fakeData([]);
		vi.mocked(data.createRule).mockRejectedValueOnce(
			new DataError('validation', {
				fields: {
					each_occurrence: {
						code: 'validation_recurrence_each_mode',
						message: '„Jeden Termin einzeln anlegen“ gibt es nur bei einem festen Rhythmus.'
					}
				}
			})
		);
		const store = new RecurrenceStore(data, session());
		const result = await store.repeat(ticket(), { ...values, eachOccurrence: true });
		expect(vi.mocked(data.createRule).mock.calls[0]?.[0]).toMatchObject({ each_occurrence: true });
		expect(result).toEqual({
			ok: false,
			message: null,
			fields: {
				each_occurrence: '„Jeden Termin einzeln anlegen“ gibt es nur bei einem festen Rhythmus.'
			}
		});
	});
});
