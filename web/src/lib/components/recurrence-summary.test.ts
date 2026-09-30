import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	CATCH_UP_ASK_HINT,
	defaultFormValues,
	type OpenInstance,
	type RecurrenceRule
} from '$lib/domain/recurrence-rule';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { HistoryEntry, Ticket } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { FlagSink } from '$lib/stores/flags.svelte';
import { REPEAT_FAILED, RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import RecurrenceSummary from './RecurrenceSummary.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

// Recurrence in the ticket panel (E5 plan, package 4): "Wiederholen…" for an open ticket, the
// line "Wiederholt sich: …" with its actions for a ticket in a series, neutral hints, errors of
// refused requests, focus. Since plan WV the template of the next tickets with its inline editor.
// The store runs for real on a fake data layer.

const TODAY = '2026-09-25';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: '2026-09-01 10:00:00.000Z' };
const WASTE: Tag = { id: 'tag000000000002', name: 'Müll', updated: '2026-09-01 10:00:00.000Z' };

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
	history: HistoryEntry[] = [],
	/** Open tickets of the series (recommendation 6). */
	openTickets: OpenInstance[] = []
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
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE]),
			listTags: vi.fn(async () => [GARDEN, WASTE]),
			createTag: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	await catalog.load();
	const onticket = vi.fn();
	render(RecurrenceSummary, {
		props: { ticket: item, store, catalog, today: TODAY, history, openTickets, onticket }
	});
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
		expect(screen.getByText('Nächstes Ticket fällig 28.09., erscheint in Kürze')).toBeTruthy();

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

	// Recommendations 5 and 6 (ADR-0022 addendum 5).
	it('asks about a large backlog and sends the choice', async () => {
		const waiting = rule({
			freq: 'daily',
			weekdays: [],
			nextDue: '2026-09-01',
			eachOccurrence: true,
			lastHint: CATCH_UP_ASK_HINT
		});
		const updateRule = vi.fn(async () => ({ ...waiting, lastHint: '', nextDue: TODAY }));
		const { flagTitles } = await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[waiting],
			{ updateRule },
			() => undefined,
			[]
		);
		expect(screen.getByRole('heading', { name: /Wartet auf deine Entscheidung/ })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Nur ab heute' }));
		await vi.waitFor(() =>
			expect(updateRule).toHaveBeenCalledWith('rule00000000001', { backlog: 'today' })
		);
		// The series starts on 07.09.: 18 dates up to 24.09.
		expect(flagTitles.at(-1)).toMatch(/^18 Termine \(07\.09\. bis 24\.09\.\) übersprungen\./);
	});

	it('says the series goes on once all open tickets are done', async () => {
		await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()],
			{},
			() => undefined,
			[],
			[
				{ id: 'ticket000000001', key: 'TASK-3', title: 'Müll' },
				{ id: 'ticket000000002', key: 'TASK-4', title: 'Müll' }
			]
		);
		expect(
			screen.getByText(
				'Die Serie geht weiter, sobald alle 2 offenen Tickets erledigt sind (TASK-3, TASK-4).'
			)
		).toBeTruthy();
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

describe('RecurrenceSummary: the template of the next tickets (plan WV)', () => {
	const inSeries = () => ticket({ recurring: true, recurrenceId: 'rule00000000001' });
	const series = () =>
		rule({
			priority: 'high',
			projectId: HOUSE.id,
			tagIds: [GARDEN.id],
			initialStatus: 'waiting'
		});
	const statusReady = { initialStatusReady: vi.fn(async () => true) };

	it('names what the next tickets get', async () => {
		await setup(inSeries(), [series()], statusReady);
		expect(
			screen.getByText(
				'Künftige Tickets: Priorität Hoch · Projekt Haus · Tags Garten · Status beim Anlegen Wartet'
			)
		).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Vorlage bearbeiten' }).textContent?.trim()).toBe(
			'Bearbeiten'
		);
	});

	it('leaves the status out before its migration, and so does the editor', async () => {
		await setup(inSeries(), [rule()]);
		expect(
			screen.getByText('Künftige Tickets: Priorität Mittel · ohne Projekt · ohne Tags')
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }));
		expect(screen.queryByLabelText('Status beim Anlegen')).toBeNull();
	});

	it('edits the template inline, without a dialog, and sends only the changed fields', async () => {
		const updateRule = vi.fn(async (id: string, patch: object) => ({
			...series(),
			...patch,
			id,
			priority: 'urgent' as const,
			initialStatus: 'backlog' as const,
			updated: '2026-09-02 10:00:00.000Z'
		}));
		const { flagTitles } = await setup(inSeries(), [series()], { ...statusReady, updateRule });
		const edit = screen.getByRole('button', { name: 'Vorlage bearbeiten' });
		edit.focus();
		await fireEvent.click(edit);
		const form = screen.getByRole('form', { name: 'Vorlage der künftigen Tickets' });
		expect(screen.queryByRole('dialog')).toBeNull();
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(form).getByLabelText('Titel'))
		);
		expect(within(form).getByLabelText<HTMLInputElement>('Titel').value).toBe('Müll');
		expect(within(form).getByLabelText<HTMLSelectElement>('Projekt').value).toBe(HOUSE.id);
		const status = within(form).getByLabelText<HTMLSelectElement>('Status beim Anlegen');
		expect([...status.options].map((option) => option.textContent)).toEqual([
			'Backlog',
			'Offen',
			'In Arbeit',
			'Wartet'
		]);

		await fireEvent.change(within(form).getByLabelText('Priorität'), {
			target: { value: 'urgent' }
		});
		await fireEvent.change(status, { target: { value: 'backlog' } });
		await fireEvent.click(within(form).getByRole('button', { name: 'Vorlage speichern' }));

		await vi.waitFor(() => expect(screen.queryByRole('form')).toBeNull());
		expect(updateRule).toHaveBeenCalledExactlyOnceWith('rule00000000001', {
			priority: 'urgent',
			initial_status: 'backlog'
		});
		expect(flagTitles).toEqual([
			'Vorlage gespeichert. Sie gilt für die künftigen Tickets der Serie.'
		]);
		expect(
			screen.getByText(
				/Priorität Dringend · Projekt Haus · Tags Garten · Status beim Anlegen Backlog/
			)
		).toBeTruthy();
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Vorlage bearbeiten' })
			)
		);
	});

	it('drops the draft with Escape and "Abbrechen", without a request', async () => {
		const { fake, store } = await setup(inSeries(), [series()], statusReady);
		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }));
		const title = screen.getByLabelText('Titel');
		await fireEvent.input(title, { target: { value: 'Papiermüll' } });
		expect(store.templateDirty).toBe(true);
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		title.dispatchEvent(escape);
		await tick();
		expect(escape.defaultPrevented).toBe(true);
		expect(screen.queryByRole('form')).toBeNull();
		expect(store.templateDraft).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }));
		expect(screen.getByLabelText<HTMLInputElement>('Titel').value).toBe('Müll');
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(screen.queryByRole('form')).toBeNull();
		expect(fake.updateRule).not.toHaveBeenCalled();
	});

	it('checks the title and shows a refusal of the server at its field, keeping the draft', async () => {
		const updateRule = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			});
		});
		await setup(inSeries(), [series()], { ...statusReady, updateRule });
		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }));
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: '  ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
		expect(updateRule).not.toHaveBeenCalled();
		expect(screen.getByText('Bitte einen Titel eingeben.')).toBeTruthy();

		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Müll' } });
		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: '' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Vorlage speichern' }));
		await vi.waitFor(() =>
			expect(screen.getByLabelText('Projekt').getAttribute('aria-invalid')).toBe('true')
		);
		expect(screen.getByText('Das Projekt ist archiviert.')).toBeTruthy();
		expect(screen.getByRole('form', { name: 'Vorlage der künftigen Tickets' })).toBeTruthy();
	});

	it('"Wiederholen…" names what the next tickets take from the ticket and asks for the status', async () => {
		const { fake } = await setup(
			ticket({ status: 'in_progress', priority: 'high', tagIds: [WASTE.id] }),
			[],
			statusReady
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		expect(
			within(dialog).getByText(
				'Künftige Tickets bekommen die Werte dieses Tickets: Priorität Hoch · ohne Projekt · Tags Müll. Ändern kannst du sie danach hier unter „Wiederholt sich“.'
			)
		).toBeTruthy();
		await fireEvent.click(
			within(dialog).getByRole('radio', { name: 'Wie dieses Ticket: In Arbeit' })
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(fake.createRule).toHaveBeenCalledTimes(1));
		expect(fake.createRule).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Müll rausbringen',
				priority: 'high',
				tags: [WASTE.id],
				initial_status: 'in_progress'
			}),
			'ticket000000001'
		);
	});
});

// ADR-0022 addendum 9, decision of the user: "den Benutzer fragen, mit welchem Status das
// Folge-Ticket starten soll." "Wiederholen…" asks it as a required choice without an answer in
// advance; "Regel bearbeiten" does not ask again.
describe('RecurrenceSummary: "Folgetickets starten mit" in "Wiederholen…" (ADR-0022 addendum 9)', () => {
	const statusReady = { initialStatusReady: vi.fn(async () => true) };
	const REQUIRED = 'Bitte wählen, mit welchem Status Folgetickets starten.';
	const question = (dialog: HTMLElement) =>
		within(dialog).getByRole('radiogroup', { name: 'Folgetickets starten mit' });
	const answers = (group: HTMLElement) =>
		within(group)
			.getAllByRole<HTMLInputElement>('radio')
			.map((radio) => [radio.labels?.[0]?.textContent?.trim(), radio.checked]);

	it('asks without an answer in advance and sends nothing until one is chosen', async () => {
		const { fake } = await setup(ticket({ status: 'waiting' }), [], statusReady);
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		const group = question(dialog);
		expect(group.getAttribute('aria-required')).toBe('true');
		expect(answers(group)).toEqual([
			['Offen', false],
			['Wie dieses Ticket: Wartet', false],
			['Backlog', false],
			['In Arbeit', false]
		]);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await tick();
		expect(fake.createRule).not.toHaveBeenCalled();
		expect(group.getAttribute('aria-invalid')).toBe('true');
		const error = within(group).getByText(REQUIRED);
		expect(group.getAttribute('aria-describedby')).toContain(error.parentElement?.id);
		expect(document.activeElement).toBe(group);

		await fireEvent.click(within(group).getByRole('radio', { name: 'Offen' }));
		expect(group.getAttribute('aria-invalid')).toBeNull();
		expect(within(group).queryByText(REQUIRED)).toBeNull();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(fake.createRule).toHaveBeenCalledTimes(1));
		expect(fake.createRule).toHaveBeenCalledWith(
			expect.objectContaining({ initial_status: 'open' }),
			'ticket000000001'
		);
	});

	it('names an open ticket at "Offen" and shows a refusal of the server at the question', async () => {
		const createRule = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					initial_status: {
						code: 'validation_recurrence_initial_status',
						message: 'Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.'
					}
				}
			});
		});
		await setup(ticket({ status: 'open' }), [], { ...statusReady, createRule });
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		const group = question(dialog);
		expect(answers(group).map(([label]) => label)).toEqual([
			'Offen (wie dieses Ticket)',
			'Backlog',
			'In Arbeit',
			'Wartet'
		]);
		await fireEvent.click(within(group).getByRole('radio', { name: 'Backlog' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(group.getAttribute('aria-invalid')).toBe('true'));
		expect(
			within(group).getByText('Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.')
		).toBeTruthy();
		expect(screen.getByRole('dialog', { name: 'Wiederholen…' })).toBeTruthy();
	});

	it('keeps the answer the user gave before a failed rule', async () => {
		await setup(ticket(), [], statusReady, (store) =>
			store.offerRepeat(
				'ticket000000001',
				defaultFormValues(null, TODAY),
				`${REPEAT_FAILED} Server nicht erreichbar.`,
				'backlog'
			)
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const group = question(screen.getByRole('dialog', { name: 'Wiederholen…' }));
		expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Backlog' }).checked).toBe(
			true
		);
	});

	it('asks nothing before the migration of "Status beim Anlegen"', async () => {
		const { fake } = await setup(ticket());
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen…' }));
		const dialog = screen.getByRole('dialog', { name: 'Wiederholen…' });
		expect(
			within(dialog).queryByRole('radiogroup', { name: 'Folgetickets starten mit' })
		).toBeNull();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(fake.createRule).toHaveBeenCalledTimes(1));
		expect(vi.mocked(fake.createRule).mock.calls[0]?.[0]).not.toHaveProperty('initial_status');
	});

	it('does not ask again in "Regel bearbeiten"', async () => {
		await setup(
			ticket({ recurring: true, recurrenceId: 'rule00000000001' }),
			[rule()],
			statusReady
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Regel bearbeiten' }));
		const dialog = screen.getByRole('dialog', { name: 'Regel bearbeiten' });
		expect(within(dialog).queryByRole('radiogroup')).toBeNull();
	});
});
