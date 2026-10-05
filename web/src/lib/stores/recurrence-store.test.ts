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

		const result = await store.repeat(ticket(), { values, initialStatus: 'open' });

		expect(result.ok).toBe(true);
		expect(data.createRule).toHaveBeenCalledWith(
			{
				title: 'Steuer',
				description: 'Belege',
				project: 'proj00000000001',
				tags: ['tag000000000001'],
				priority: 'high',
				// "Status beim Anlegen": the answer to "Folgetickets starten mit" (ADR-0022 addendum 9).
				initial_status: 'open',
				mode: 'calendar',
				freq: 'weekly',
				interval: 1,
				weekdays: ['MO'],
				month_day: 0,
				anchor: '2026-09-28',
				lead_days: 3,
				each_occurrence: false,
				// "Serie ab heute beginnen", chosen in advance (WH-2, ADR-0022 addendum 14).
				start: 'today'
			},
			'ticket000000001'
		);
		expect(store.ruleById('rule00000000009')).not.toBeNull();
		expect(flags.shown).toEqual([
			{ tone: 'success', title: 'Wiederholung angelegt: jeden Montag.' }
		]);
	});

	// Plan WV, the report of the user: the next ticket came "open" instead of the chosen status.
	// Since ADR-0022 addendum 9 the user answers "Folgetickets starten mit"; nothing comes silently
	// from the status of the ticket.
	it('takes the chosen status and every value of the ticket into the template, also for "Neues Ticket"', async () => {
		const data = fakeData([]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		const values = defaultFormValues('2026-09-28', '2026-09-25');

		await store.repeat(ticket({ status: 'backlog', priority: 'urgent' }), {
			values,
			initialStatus: 'backlog'
		});
		await store.repeatCreated(ticket({ status: 'waiting', priority: 'low' }), {
			values,
			initialStatus: 'open'
		});
		await store.repeat(ticket({ status: 'open' }), { values, initialStatus: 'in_progress' });
		// Nothing asked (before the migration of "Status beim Anlegen"): the field is left out.
		await store.repeat(ticket({ status: 'in_progress' }), { values, initialStatus: null });

		const drafts = vi.mocked(data.createRule).mock.calls.map(([draft]) => draft);
		expect(drafts.map(({ priority, initial_status }) => ({ priority, initial_status }))).toEqual([
			{ priority: 'urgent', initial_status: 'backlog' },
			{ priority: 'low', initial_status: 'open' },
			{ priority: 'high', initial_status: 'in_progress' },
			{ priority: 'high', initial_status: undefined }
		]);
		expect(drafts[3]).not.toHaveProperty('initial_status');
		for (const draft of drafts) {
			expect(draft).toMatchObject({
				title: 'Steuer',
				description: 'Belege',
				project: 'proj00000000001',
				tags: ['tag000000000001']
			});
		}
	});

	// WH-2 (ADR-0022 addendum 14): the choice of the form goes along as the body field `start` on
	// every way with a ticket ("Wiederholen…", "Neues Ticket", the prepared offer); the hook decides.
	it('sends where the series begins: "today" unless the user keeps the date', async () => {
		const data = fakeData([]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		const values = defaultFormValues('2024-03-12', '2026-09-25');

		await store.repeat(ticket({ due: '2024-03-12' }), { values, initialStatus: 'open' });
		await store.repeat(ticket({ due: '2024-03-12' }), {
			values: { ...values, start: 'keep' },
			initialStatus: 'open'
		});
		await store.repeatCreated(ticket({ due: '2024-03-12' }), {
			values: { ...values, start: 'today' },
			initialStatus: 'open'
		});

		const starts = vi.mocked(data.createRule).mock.calls.map(([draft]) => draft.start);
		expect(starts).toEqual(['today', 'keep', 'today']);
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
		const request = { values: defaultFormValues(null, '2026-09-25'), initialStatus: null };

		expect(await store.repeat(ticket(), request)).toEqual({
			ok: false,
			message: null,
			fields: { weekdays: 'Bitte mindestens einen Wochentag wählen.' }
		});
		const network = await store.repeat(ticket(), request);
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
		const created = await store.repeatCreated(ticket({ due: null }), {
			values,
			initialStatus: 'waiting'
		});
		expect(created?.id).toBe('rule00000000009');
		expect(data.createRule).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Steuer',
				freq: 'weekly',
				weekdays: ['MO'],
				initial_status: 'waiting'
			}),
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

		// The answer to "Folgetickets starten mit" comes along: the user gave it already.
		expect(await store.repeatCreated(ticket(), { values, initialStatus: 'backlog' })).toBeNull();
		expect(store.takeOffer('another00000001')).toBeNull();
		const offer = store.takeOffer('ticket000000001');
		expect(offer).toEqual({
			ticketId: 'ticket000000001',
			values,
			initialStatus: 'backlog',
			message: `${REPEAT_FAILED} Das Ticket gehört schon zu einer Serie.`
		});
		// The offer holds a copy: the form may change its values without touching the caller's.
		expect(offer?.values).not.toBe(values);
		expect(store.takeOffer('ticket000000001')).toBeNull();

		expect(await store.repeatCreated(ticket(), { values, initialStatus: null })).toBeNull();
		expect(store.takeOffer('ticket000000001')?.message).toMatch(
			new RegExp(`^${REPEAT_FAILED} .*Server nicht erreichbar`)
		);
	});

	it('hands values from the inbox panel to the ticket panel; the newest offer wins, logout drops it', () => {
		const store = new RecurrenceStore(fakeData([]), session());
		store.offerRepeat('ticket000000001', values);
		store.offerRepeat('ticket000000002', values);
		expect(store.takeOffer('ticket000000001')).toBeNull();
		// From the inbox nothing was answered yet: the dialog asks (ADR-0022 addendum 9).
		expect(store.takeOffer('ticket000000002')).toEqual({
			ticketId: 'ticket000000002',
			values,
			initialStatus: null,
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
						message: '„Verpasste Termine nachholen“ gibt es nur bei einem festen Rhythmus.'
					}
				}
			})
		);
		const store = new RecurrenceStore(data, session());
		const result = await store.repeat(ticket(), {
			values: { ...values, eachOccurrence: true },
			initialStatus: 'open'
		});
		expect(vi.mocked(data.createRule).mock.calls[0]?.[0]).toMatchObject({ each_occurrence: true });
		expect(result).toEqual({
			ok: false,
			message: null,
			fields: {
				each_occurrence: '„Verpasste Termine nachholen“ gibt es nur bei einem festen Rhythmus.'
			}
		});
	});
});

// Plan WV (ADR-0023 addendum 6): the template at the ticket and the offer after a change.
describe('RecurrenceStore: the template of a series (plan WV)', () => {
	/** Flag sink that keeps every flag with its action and whether it was dismissed. */
	function flagLog() {
		const flags: (FlagInput & { id: string; dismissed: boolean })[] = [];
		const sink: FlagSink = {
			show: (input) => {
				const id = `flag-${flags.length + 1}`;
				flags.push({ ...input, id, dismissed: false });
				return id;
			},
			dismiss: (id) => {
				const flag = flags.find((entry) => entry.id === id);
				if (flag !== undefined && !flag.dismissed) {
					flag.dismissed = true;
					flag.onclose?.();
				}
			}
		};
		return { sink, flags };
	}

	/** A change of an open ticket of the series of rule 1. */
	function change(before: Partial<Ticket>, after: Partial<Ticket>) {
		const base = ticket({ recurring: true, recurrenceId: 'rule00000000001', priority: 'medium' });
		return { before: { ...base, ...before }, after: { ...base, ...after } };
	}

	it('knows "Status beim Anlegen" only after its migration', async () => {
		const ready = new RecurrenceStore(
			{ ...fakeData([]), initialStatusReady: vi.fn(async () => true) },
			session()
		);
		expect(ready.statusReady).toBe(false);
		await ready.load();
		expect(ready.statusReady).toBe(true);
		const before = new RecurrenceStore(
			{ ...fakeData([]), initialStatusReady: vi.fn(async () => false) },
			session()
		);
		await before.load();
		expect(before.statusReady).toBe(false);
		const failing = new RecurrenceStore(
			{ ...fakeData([]), initialStatusReady: vi.fn(async () => Promise.reject(new Error('x'))) },
			session()
		);
		await failing.load();
		expect(failing.statusReady).toBe(false);
	});

	it('offers exactly the changed fields for the next tickets and writes them on the action', async () => {
		const data = fakeData([rule({ priority: 'medium', tagIds: ['tag000000000001'] })]);
		const log = flagLog();
		const store = new RecurrenceStore(data, session(), log.sink);
		await store.load();

		const id = store.offerTemplate([
			change({ priority: 'medium' }, { priority: 'urgent', title: 'Steuer 2027' })
		]);
		expect(id).toBe('flag-1');
		const [flag] = log.flags;
		expect(flag).toMatchObject({
			tone: 'info',
			title: 'Nur dieses Ticket geändert.',
			description:
				'Künftige Tickets von „Müll“ kommen weiter mit der bisherigen Vorlage (Titel, Priorität).',
			action: { label: 'Auch für künftige Tickets übernehmen' }
		});
		flag?.action?.run();
		await vi.waitFor(() => expect(data.updateRule).toHaveBeenCalledTimes(1));
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000001', {
			title: 'Steuer 2027',
			priority: 'urgent'
		});
		await vi.waitFor(() =>
			expect(log.flags.at(-1)).toMatchObject({
				tone: 'success',
				title: 'Vorlage von „Müll“ übernommen.'
			})
		);
	});

	it('offers nothing for status, due date, a done ticket or a template that has the value', async () => {
		const log = flagLog();
		const store = new RecurrenceStore(fakeData([rule({ priority: 'high' })]), session(), log.sink);
		await store.load();
		expect(store.offerTemplate([change({ status: 'open' }, { status: 'in_progress' })])).toBeNull();
		expect(store.offerTemplate([change({ due: '2026-09-28' }, { due: '2026-09-30' })])).toBeNull();
		expect(
			store.offerTemplate([change({ priority: 'low' }, { priority: 'urgent', status: 'done' })])
		).toBeNull();
		expect(store.offerTemplate([change({ priority: 'low' }, { priority: 'high' })])).toBeNull();
		const normal = ticket({ priority: 'low' });
		expect(
			store.offerTemplate([{ before: normal, after: { ...normal, priority: 'high' } }])
		).toBeNull();
		expect(log.flags).toEqual([]);
	});

	it('shows one flag for several tickets and rules, replaces an older one and can withdraw it', async () => {
		const data = fakeData([
			rule(),
			rule({ id: 'rule00000000002', title: 'Blumen', tagIds: ['tag000000000009'] })
		]);
		const log = flagLog();
		const store = new RecurrenceStore(data, session(), log.sink);
		await store.load();
		const first = store.offerTemplate([change({ title: 'Steuer' }, { title: 'Steuern' })]);
		const flowers = { id: 'ticket000000002', key: 'TASK-4', recurrenceId: 'rule00000000002' };
		const second = store.offerTemplate([
			change({ tagIds: [] }, { tagIds: ['tag000000000001'] }),
			change({ ...flowers, tagIds: [] }, { ...flowers, tagIds: ['tag000000000001'] })
		]);
		expect(log.flags.find((flag) => flag.id === first)?.dismissed).toBe(true);
		const flag = log.flags.find((entry) => entry.id === second);
		expect(flag).toMatchObject({
			title: 'Nur diese 2 Tickets geändert.',
			description: 'Künftige Tickets von 2 Serien kommen weiter mit der bisherigen Vorlage (Tags).'
		});
		flag?.action?.run();
		await vi.waitFor(() => expect(data.updateRule).toHaveBeenCalledTimes(2));
		// Tags as the change the tickets got, added to the tags of each template.
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000001', { tags: ['tag000000000001'] });
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000002', {
			tags: ['tag000000000009', 'tag000000000001']
		});
		await vi.waitFor(() =>
			expect(log.flags.at(-1)?.title).toBe('Vorlagen von 2 Serien übernommen.')
		);

		const third = store.offerTemplate([change({ title: 'Steuer' }, { title: 'Abgaben' })]);
		store.withdrawTemplateOffer('flag-unknown');
		expect(log.flags.find((entry) => entry.id === third)?.dismissed).toBe(false);
		store.withdrawTemplateOffer(third ?? '');
		expect(log.flags.find((entry) => entry.id === third)?.dismissed).toBe(true);
	});

	it('names a refusal of the server in an error flag', async () => {
		const data = fakeData([rule()]);
		vi.mocked(data.updateRule).mockRejectedValueOnce(
			new DataError('validation', {
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			})
		);
		const log = flagLog();
		const store = new RecurrenceStore(data, session(), log.sink);
		await store.load();
		store.offerTemplate([change({ projectId: null }, { projectId: 'proj00000000002' })]);
		log.flags[0]?.action?.run();
		await vi.waitFor(() =>
			expect(log.flags.at(-1)).toMatchObject({
				tone: 'error',
				title: 'Die Vorlage von „Müll“ wurde nicht geändert. Das Projekt ist archiviert.'
			})
		);
	});

	it('keeps the draft of the template, knows unsaved input and saves only the changes', async () => {
		const data = fakeData([rule({ tagIds: ['tag000000000001'] })]);
		const store = new RecurrenceStore(
			{ ...data, initialStatusReady: vi.fn(async () => true) },
			session()
		);
		await store.load();
		store.editTemplate('unknown');
		expect(store.templateDraft).toBeNull();
		store.editTemplate('rule00000000001');
		const template = store.templateDraft?.template;
		expect(template).toEqual({
			title: 'Müll',
			description: '',
			projectId: null,
			tagIds: ['tag000000000001'],
			priority: 'medium',
			initialStatus: 'open',
			subtasks: [],
			color: null,
			charm: null
		});
		if (template === undefined) return;
		expect(store.templateDirty).toBe(false);
		store.setTemplateDraft(template, 'neu');
		expect(store.templateDirty).toBe(true);
		store.setTemplateDraft(
			{
				...template,
				title: ' Müll (gelb) ',
				initialStatus: 'backlog',
				tagIds: ['tag000000000001', 'gone00000000001']
			},
			''
		);
		const result = await store.saveTemplate((tagId) => tagId !== 'gone00000000001');
		expect(result.ok).toBe(true);
		expect(data.updateRule).toHaveBeenCalledExactlyOnceWith('rule00000000001', {
			title: 'Müll (gelb)',
			initial_status: 'backlog'
		});
		expect(store.templateDraft).toBeNull();

		store.editTemplate('rule00000000001');
		expect(await store.saveTemplate()).toMatchObject({ ok: true });
		expect(data.updateRule).toHaveBeenCalledTimes(1);
		store.editTemplate('rule00000000001');
		store.cancelTemplate();
		expect(store.templateDraft).toBeNull();
	});
});

// Plan WV-3 (ADR-0022 addendum 10): the sub-tasks of the template and the offer after a sub-task
// was added to an open ticket of a series.
describe('RecurrenceStore: the sub-tasks of the template (plan WV-3)', () => {
	function flagLog() {
		const flags: (FlagInput & { id: string; dismissed: boolean })[] = [];
		const sink: FlagSink = {
			show: (input) => {
				const id = `flag-${flags.length + 1}`;
				flags.push({ ...input, id, dismissed: false });
				return id;
			},
			dismiss: (id) => {
				const flag = flags.find((entry) => entry.id === id);
				if (flag !== undefined && !flag.dismissed) {
					flag.dismissed = true;
					flag.onclose?.();
				}
			}
		};
		return { sink, flags };
	}

	const parent = { key: 'TASK-3', status: 'open' as const, recurrenceId: 'rule00000000001' };
	const ready = (data: RecurrenceData): RecurrenceData => ({
		...data,
		templateSubtasksReady: vi.fn(async () => true)
	});

	it('knows the sub-tasks of the template only after their migration', async () => {
		const after = new RecurrenceStore(ready(fakeData([])), session());
		expect(after.subtasksReady).toBe(false);
		await after.load();
		expect(after.subtasksReady).toBe(true);
		for (const probe of [async () => false, async () => Promise.reject(new Error('x'))]) {
			const before = new RecurrenceStore(
				{ ...fakeData([]), templateSubtasksReady: vi.fn(probe) },
				session()
			);
			await before.load();
			expect(before.subtasksReady).toBe(false);
		}
		after.reset();
		expect(after.subtasksReady).toBe(false);
	});

	it('knows the charms only after their migration and sends a charm of the draft only then (ADR-0062)', async () => {
		const ruleData = fakeData([rule()]);
		const after = new RecurrenceStore(
			{ ...ruleData, charmsReady: vi.fn(async () => true) },
			session()
		);
		expect(after.charmsReady).toBe(false);
		await after.load();
		expect(after.charmsReady).toBe(true);
		after.editTemplate('rule00000000001');
		const template = after.templateDraft?.template;
		if (template === undefined) throw new Error('no draft');
		after.setTemplateDraft({ ...template, charm: 'muell' }, '');
		await after.saveTemplate();
		expect(ruleData.updateRule).toHaveBeenLastCalledWith('rule00000000001', { charm: 'muell' });

		for (const probe of [async () => false, async () => Promise.reject(new Error('x'))]) {
			const data = fakeData([rule()]);
			const before = new RecurrenceStore({ ...data, charmsReady: vi.fn(probe) }, session());
			await before.load();
			expect(before.charmsReady).toBe(false);
			before.editTemplate('rule00000000001');
			const draft = before.templateDraft?.template;
			if (draft === undefined) throw new Error('no draft');
			before.setTemplateDraft({ ...draft, charm: 'muell' }, '');
			await before.saveTemplate();
			expect(data.updateRule).not.toHaveBeenCalled();
		}
		after.reset();
		expect(after.charmsReady).toBe(false);
	});

	it('saves the list of the draft trimmed, and only once the server knows it', async () => {
		const data = fakeData([rule({ templateSubtasks: [{ title: 'Alt', priority: 'low' }] })]);
		const store = new RecurrenceStore(ready(data), session());
		await store.load();
		store.editTemplate('rule00000000001');
		const template = store.templateDraft?.template;
		expect(template?.subtasks).toEqual([{ title: 'Alt', priority: 'low' }]);
		if (template === undefined) return;
		store.setTemplateDraft(
			{
				...template,
				subtasks: [
					{ title: ' Neu ', priority: 'high' },
					{ title: 'Alt', priority: 'low' }
				]
			},
			''
		);
		expect(store.templateDirty).toBe(true);
		await store.saveTemplate();
		expect(data.updateRule).toHaveBeenCalledExactlyOnceWith('rule00000000001', {
			template_subtasks: [
				{ title: 'Neu', priority: 'high' },
				{ title: 'Alt', priority: 'low' }
			]
		});

		const before = fakeData([rule()]);
		const old = new RecurrenceStore(before, session());
		await old.load();
		old.editTemplate('rule00000000001');
		const draft = old.templateDraft?.template;
		if (draft === undefined) return;
		old.setTemplateDraft({ ...draft, subtasks: [{ title: 'X', priority: 'low' }] }, '');
		await old.saveTemplate();
		expect(before.updateRule).not.toHaveBeenCalled();
	});

	it('offers a sub-task added to an open ticket of a series, joins the next one and writes the list', async () => {
		const data = fakeData([
			rule({ templateSubtasks: [{ title: 'Filter wechseln', priority: 'medium' }] })
		]);
		const log = flagLog();
		const store = new RecurrenceStore(ready(data), session(), log.sink);
		await store.load();

		const first = store.offerSubtask(parent, { title: 'Deckel putzen', priority: 'high' });
		expect(log.flags[0]).toMatchObject({
			id: first,
			tone: 'info',
			title: 'Nur dieses Ticket geändert.',
			description: 'Künftige Tickets von „Müll“ bekommen die Unteraufgabe „Deckel putzen“ nicht.',
			action: { label: 'Auch für künftige Tickets übernehmen' }
		});
		// The next sub-task of the same series joins the offer shown, in a new flag.
		const second = store.offerSubtask(parent, { title: 'Entkalken', priority: 'low' });
		expect(log.flags.find((flag) => flag.id === first)?.dismissed).toBe(true);
		const flag = log.flags.find((entry) => entry.id === second);
		expect(flag?.description).toBe(
			'Künftige Tickets von „Müll“ bekommen die Unteraufgaben „Deckel putzen“ und „Entkalken“ nicht.'
		);
		flag?.action?.run();
		await vi.waitFor(() => expect(data.updateRule).toHaveBeenCalledTimes(1));
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000001', {
			template_subtasks: [
				{ title: 'Filter wechseln', priority: 'medium' },
				{ title: 'Deckel putzen', priority: 'high' },
				{ title: 'Entkalken', priority: 'low' }
			]
		});
		await vi.waitFor(() =>
			expect(log.flags.at(-1)).toMatchObject({
				tone: 'success',
				title: 'Vorlage von „Müll“ übernommen.'
			})
		);
	});

	it('offers nothing for a known title, a done ticket, no series or before the migration', async () => {
		const log = flagLog();
		const store = new RecurrenceStore(
			ready(fakeData([rule({ templateSubtasks: [{ title: 'Filter', priority: 'medium' }] })])),
			session(),
			log.sink
		);
		await store.load();
		expect(store.offerSubtask(parent, { title: 'filter', priority: 'high' })).toBeNull();
		expect(
			store.offerSubtask({ ...parent, status: 'done' }, { title: 'Neu', priority: 'high' })
		).toBeNull();
		expect(
			store.offerSubtask({ ...parent, recurrenceId: null }, { title: 'Neu', priority: 'high' })
		).toBeNull();
		const before = new RecurrenceStore(fakeData([rule()]), session(), log.sink);
		await before.load();
		expect(before.offerSubtask(parent, { title: 'Neu', priority: 'high' })).toBeNull();
		expect(log.flags).toEqual([]);
	});

	it('replaces an offer of changed fields and starts a new list after the flag is gone', async () => {
		const data = fakeData([rule()]);
		const log = flagLog();
		const store = new RecurrenceStore(ready(data), session(), log.sink);
		await store.load();
		const fields = store.offerTemplate([
			{
				before: ticket({ recurring: true, recurrenceId: 'rule00000000001', priority: 'medium' }),
				after: ticket({ recurring: true, recurrenceId: 'rule00000000001', priority: 'urgent' })
			}
		]);
		const first = store.offerSubtask(parent, { title: 'A', priority: 'medium' });
		expect(log.flags.find((flag) => flag.id === fields)?.dismissed).toBe(true);
		// The flag went (8 s or ×): the next sub-task is offered alone.
		log.sink.dismiss(first ?? '');
		const next = store.offerSubtask(parent, { title: 'B', priority: 'medium' });
		expect(log.flags.find((flag) => flag.id === next)?.description).toBe(
			'Künftige Tickets von „Müll“ bekommen die Unteraufgabe „B“ nicht.'
		);
	});
});

describe('RecurrenceStore: area of the tab (E7-3, ADR-0059 §2 and §3)', () => {
	it('drops the rules of the old area at once and loads those of the new one', async () => {
		const data = fakeData([rule()]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		const household = rule({ id: 'rule00000000002', title: 'Fenster putzen' });
		vi.mocked(data.listRules).mockResolvedValueOnce([household]);

		store.rescope();

		expect(store.rules).toEqual([]);
		expect(store.ruleById('rule00000000001')).toBeNull();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.rules.map((item) => item.id)).toEqual(['rule00000000002']);
		expect(data.listRules).toHaveBeenCalledTimes(2);
	});

	it('puts the rule of "Wiederholen…" in the area of its ticket, a new one in the area of the tab', async () => {
		const data = fakeData([]);
		const store = new RecurrenceStore(data, session());
		await store.load();
		const values = defaultFormValues('2026-09-28', '2026-09-25');

		await store.repeat(ticket({ scope: 'h:house0000000001' }), { values, initialStatus: 'open' });
		await store.repeat(ticket({ scope: 'u:user00000000001' }), { values, initialStatus: 'open' });
		await store.create({
			title: 'Neu',
			description: '',
			project: null,
			tags: [],
			priority: null,
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['MO'],
			month_day: 0,
			anchor: '2026-09-28',
			lead_days: 3
		});

		const calls = vi.mocked(data.createRule).mock.calls;
		expect(calls[0]?.slice(1)).toEqual(['ticket000000001', 'house0000000001']);
		expect(calls[1]?.slice(1)).toEqual(['ticket000000001', '']);
		expect(calls[2]?.slice(1)).toEqual([null]);
	});
});
