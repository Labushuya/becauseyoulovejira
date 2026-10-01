// Component tests for the rule panel (E5 plan, T-6 and package 5): "Neue Regel" with the template
// and the rhythm, checks before sending, a new rule with the whole draft; an existing rule with its
// state, open ticket and neutral hint, saving the template without the rhythm (the next ticket
// stays) and a new rhythm with it, field errors of the server at their field (also for
// "Fortsetzen" with an archived project), "Löschen …" with the confirmation and the question
// about unsaved input.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { RuleDraft } from '$lib/data/recurrence';
import { CATCH_UP_ASK_HINT, type RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { ProjectRef } from '$lib/domain/ticket';
import type { EditResult } from '$lib/stores/catalog-editor';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import RecurrencePanel from './RecurrencePanel.svelte';
import source from './RecurrencePanel.svelte?raw';

// A Friday: a new rule starts weekly on Fridays.
const TODAY = '2026-09-25';
const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };
const OLD: ProjectRef = { id: 'proj00000000002', name: 'Alt', code: 'ALT', archived: true };

useOverlayStubs();

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll rausbringen',
		description: 'Gelbe Tonne',
		projectId: null,
		tagIds: [],
		priority: 'high',
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

type SaveResult = EditResult<RecurrenceRule>;

function show(current: RecurrenceRule | null, overrides: Record<string, unknown> = {}) {
	const props = {
		rule: current,
		today: TODAY,
		projects: [HOUSE],
		tags: [{ id: 'tag000000000001', name: 'haushalt' }],
		projectById: (id: string) => [HOUSE, OLD].find((project) => project.id === id) ?? null,
		openTickets:
			current === null ? [] : [{ id: 'ticket000000001', key: 'TASK-7', title: 'Müll rausbringen' }],
		ticketHrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname,
		oncreatetag: vi.fn(async () => ({ ok: false as const, message: null })),
		onsave: vi.fn(async (draft: Partial<RuleDraft>): Promise<SaveResult> => ({
			ok: true,
			value: rule({ id: 'rule00000000009', title: draft.title ?? 'Neu' })
		})),
		onsaved: vi.fn(),
		onclose: vi.fn(),
		...(current === null
			? {}
			: {
					ontoggle: vi.fn(async (active: boolean): Promise<SaveResult> => ({
						ok: true,
						value: { ...current, active }
					})),
					ondelete: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
					ondeleted: vi.fn()
				}),
		...overrides
	};
	render(RecurrencePanel, { props });
	return props as typeof props & {
		ontoggle: ReturnType<typeof vi.fn>;
		ondelete: ReturnType<typeof vi.fn>;
		ondeleted: ReturnType<typeof vi.fn>;
	};
}

const panel = () => screen.getByRole('complementary');

describe('RecurrencePanel: "Neue Regel"', () => {
	it('focuses the title and checks it before sending', async () => {
		const props = show(null);
		await tick();
		expect(screen.getByRole('heading', { level: 2, name: 'Neue Regel' })).toBeTruthy();
		const title = screen.getByLabelText<HTMLInputElement>('Titel');
		expect(document.activeElement).toBe(title);

		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await tick();
		expect(props.onsave).not.toHaveBeenCalled();
		expect(title.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Bitte einen Titel eingeben.')).toBeTruthy();
		expect(document.activeElement).toBe(title);
	});

	it('creates a rule with template and rhythm and hands the rule on', async () => {
		const props = show(null);
		await fireEvent.input(screen.getByLabelText('Titel'), {
			target: { value: '  Blumen gießen ' }
		});
		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: HOUSE.id } });
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		await vi.waitFor(() => expect(props.onsaved).toHaveBeenCalledTimes(1));
		expect(props.onsave).toHaveBeenCalledWith({
			title: 'Blumen gießen',
			description: '',
			project: HOUSE.id,
			tags: [],
			priority: 'medium',
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['FR'],
			month_day: 0,
			anchor: TODAY,
			lead_days: 3,
			each_occurrence: false
		});
		expect(props.onsaved.mock.calls[0]?.[0]).toMatchObject({ id: 'rule00000000009' });
		expect(
			screen.getByText(/Das erste Ticket entsteht, sobald der Vorlauf erreicht ist/)
		).toBeTruthy();
	});

	it('checks the rhythm with the rules of the hook before sending', async () => {
		const props = show(null);
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Blumen' } });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Freitag' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await tick();
		expect(props.onsave).not.toHaveBeenCalled();
		expect(screen.getByText('Bitte mindestens einen Wochentag wählen.')).toBeTruthy();
	});

	it('closes without a question while nothing is typed, else asks first', async () => {
		const props = show(null);
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(props.onclose).toHaveBeenCalledTimes(1);

		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Blumen' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		const question = screen.getByRole('dialog', { name: 'Neue Regel verwerfen?' });
		expect(props.onclose).toHaveBeenCalledTimes(1);
		await fireEvent.click(within(question).getByRole('button', { name: 'Verwerfen' }));
		expect(props.onclose).toHaveBeenCalledTimes(2);
	});
});

describe('RecurrencePanel: a rule', () => {
	it('shows the rule with its state, next ticket and open ticket', async () => {
		show(rule({ projectId: HOUSE.id, tagIds: ['tag000000000001'] }));
		await tick();
		const heading = screen.getByRole('heading', { level: 2, name: 'Müll rausbringen' });
		expect(document.activeElement).toBe(heading);
		expect(within(panel()).getByText('Aktiv')).toBeTruthy();
		// Recommendation 2: due date, appearance and the open ticket it waits for.
		expect(
			screen.getByText('Nächstes Ticket fällig 28.09., erscheint, sobald TASK-7 erledigt ist')
		).toBeTruthy();
		expect(screen.getByRole('link', { name: 'TASK-7' }).getAttribute('href')).toBe(
			'/tickets/ticket000000001'
		);
		expect(screen.getByLabelText<HTMLInputElement>('Titel').value).toBe('Müll rausbringen');
		expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe(HOUSE.id);
		expect(screen.getByLabelText<HTMLSelectElement>('Priorität').value).toBe('high');
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Montag' }).checked).toBe(true);
		expect(screen.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-07');
	});

	it('saves a new template without the rhythm, so the next ticket stays', async () => {
		const props = show(rule());
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Müll (gelb)' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(props.onsave).toHaveBeenCalledTimes(1));
		expect(props.onsave).toHaveBeenCalledWith({
			title: 'Müll (gelb)',
			description: 'Gelbe Tonne',
			project: null,
			tags: [],
			priority: 'high'
		});
		// Before the migration of the status the field is not there and nothing is sent for it.
		expect(screen.queryByLabelText('Status beim Anlegen')).toBeNull();
	});

	// Plan WV (ADR-0022 addendum 8).
	it('offers "Status beim Anlegen" after its migration, every status but "Erledigt"', async () => {
		const props = show(rule({ initialStatus: 'waiting' }), { statusAvailable: true });
		const status = screen.getByLabelText<HTMLSelectElement>('Status beim Anlegen');
		expect(status.value).toBe('waiting');
		expect([...status.options].map((option) => option.value)).toEqual([
			'backlog',
			'open',
			'in_progress',
			'waiting'
		]);
		expect(status.getAttribute('aria-describedby')).toBeTruthy();
		await fireEvent.change(status, { target: { value: 'in_progress' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(props.onsave).toHaveBeenCalledTimes(1));
		expect(props.onsave.mock.calls[0]?.[0]).toMatchObject({
			priority: 'high',
			initial_status: 'in_progress'
		});
	});

	// ADR-0022 addendum 9: a new rule asks with which status its tickets start, without an answer
	// in advance; a saved rule shows its value in "Status beim Anlegen" (above).
	it('asks a new rule "Folgetickets starten mit" and shows a refusal of the status at the question', async () => {
		const onsave = vi.fn(async (): Promise<SaveResult> => ({
			ok: false,
			message: null,
			fields: { initial_status: 'Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.' }
		}));
		show(null, { statusAvailable: true, onsave });
		expect(screen.queryByLabelText('Status beim Anlegen')).toBeNull();
		const group = screen.getByRole('radiogroup', { name: 'Folgetickets starten mit' });
		const radios = within(group).getAllByRole<HTMLInputElement>('radio');
		expect(radios.map((radio) => [radio.labels?.[0]?.textContent?.trim(), radio.checked])).toEqual([
			['Offen', false],
			['Backlog', false],
			['In Arbeit', false],
			['Wartet', false]
		]);

		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Blumen' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await tick();
		expect(onsave).not.toHaveBeenCalled();
		expect(group.getAttribute('aria-invalid')).toBe('true');
		expect(
			within(group).getByText('Bitte wählen, mit welchem Status Folgetickets starten.')
		).toBeTruthy();
		expect(document.activeElement).toBe(group);

		await fireEvent.click(within(group).getByRole('radio', { name: 'Wartet' }));
		expect(group.getAttribute('aria-invalid')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() => expect(group.getAttribute('aria-invalid')).toBe('true'));
		expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ initial_status: 'waiting' }));
		expect(
			within(group).getByText('Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.')
		).toBeTruthy();
	});

	it('counts an answer to the question of a new rule as unsaved input', async () => {
		const props = show(null, { statusAvailable: true });
		await fireEvent.click(screen.getByRole('radio', { name: 'Offen' }));
		await fireEvent.click(within(panel()).getByRole('button', { name: 'Abbrechen' }));
		expect(props.onclose).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Neue Regel verwerfen?' })).toBeTruthy();
	});

	it('sends a changed rhythm with the template', async () => {
		const props = show(rule());
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Donnerstag' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(props.onsave).toHaveBeenCalledTimes(1));
		expect(props.onsave.mock.calls[0]?.[0]).toMatchObject({
			title: 'Müll rausbringen',
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['MO', 'TH'],
			anchor: '2026-09-07',
			lead_days: 3
		});
	});

	it('shows field errors of the server at their field and other refusals as message', async () => {
		const onsave = vi.fn(async (): Promise<SaveResult> => ({
			ok: false,
			message: null,
			fields: { project: 'Das Projekt ist archiviert.', anchor: 'Bitte ein gültiges Datum.' }
		}));
		show(rule(), { onsave });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Donnerstag' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(screen.getByLabelText('Projekt').getAttribute('aria-invalid')).toBe('true')
		);
		expect(screen.getByText('Das Projekt ist archiviert.')).toBeTruthy();
		expect(screen.getByLabelText('Beginnt am').getAttribute('aria-invalid')).toBe('true');
	});

	it('shows the hint of a paused rule neutrally and resumes it', async () => {
		const props = show(rule({ active: false, lastHint: 'Projekt archiviert – Regel pausiert.' }));
		expect(within(panel()).getByText('Pausiert')).toBeTruthy();
		const hint = screen.getByText('Projekt archiviert – Regel pausiert.');
		expect(hint.closest('.alert-error')).toBeNull();
		expect(hint.closest('[role="status"], [role="alert"]')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }));
		expect(props.ontoggle).toHaveBeenCalledWith(true);
	});

	// Plan "Wiederholungen verständlich machen", recommendation 5 (ADR-0022 addendum 5).
	it('asks about a large backlog instead of the raw hint and passes the choice on', async () => {
		const waiting = rule({
			freq: 'daily',
			weekdays: [],
			anchor: '2026-08-01',
			nextDue: '2026-09-01',
			eachOccurrence: true,
			lastHint: CATCH_UP_ASK_HINT
		});
		const ondecide = vi.fn(async (): Promise<SaveResult> => ({ ok: true, value: waiting }));
		show(waiting, { ondecide, openTickets: [] });
		expect(within(panel()).getByText('Wartet')).toBeTruthy();
		const question = screen.getByRole('heading', { name: /Wartet auf deine Entscheidung/ });
		const box = question.closest('.section-message') as HTMLElement;
		expect(box.getAttribute('data-tone')).toBe('warning');
		expect(
			within(box).getByText(/24 Termine \(01\.09\. bis 24\.09\.\) haben noch kein Ticket/)
		).toBeTruthy();
		expect(screen.queryByText(CATCH_UP_ASK_HINT)).toBeNull();

		await fireEvent.click(within(box).getByRole('button', { name: 'Alle 24 nachholen' }));
		expect(ondecide).toHaveBeenCalledWith('all');
		await fireEvent.click(within(box).getByRole('button', { name: 'Nur ab heute' }));
		await vi.waitFor(() => expect(ondecide).toHaveBeenLastCalledWith('today'));
	});

	// Recommendations 6 and 7.
	it('lists every open ticket and says the series waits for them without the switch', async () => {
		const open = [
			{ id: 'ticket000000001', key: 'TASK-7', title: 'Müll Montag' },
			{ id: 'ticket000000002', key: 'TASK-8', title: 'Müll Mittwoch' }
		];
		show(rule(), { openTickets: open });
		expect(screen.getByText('Offene Tickets (2):')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'TASK-8' }).getAttribute('href')).toBe(
			'/tickets/ticket000000002'
		);
		expect(
			screen.getByText(
				'Die Serie geht weiter, sobald alle 2 offenen Tickets erledigt sind (TASK-7, TASK-8).'
			)
		).toBeTruthy();
	});

	it('says so inline when the switch goes off while several tickets are open', async () => {
		const open = [
			{ id: 'ticket000000001', key: 'TASK-7', title: 'Müll Montag' },
			{ id: 'ticket000000002', key: 'TASK-8', title: 'Müll Mittwoch' }
		];
		show(rule({ eachOccurrence: true }), { openTickets: open, eachAvailable: true });
		const text =
			'Die Serie geht weiter, sobald alle 2 offenen Tickets erledigt sind (TASK-7, TASK-8).';
		expect(screen.queryByText(text)).toBeNull();
		await fireEvent.click(screen.getByRole('switch', { name: 'Jeden Termin einzeln anlegen' }));
		expect(screen.getByText(text)).toBeTruthy();
	});

	it('shows a refused "Fortsetzen" at the project field and at the button', async () => {
		const ontoggle = vi.fn(async (): Promise<SaveResult> => ({
			ok: false,
			message: null,
			fields: { project: 'Das Projekt ist archiviert.' }
		}));
		show(rule({ active: false, projectId: OLD.id }), { ontoggle });
		expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe(OLD.id);
		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Das Projekt ist archiviert.');
		expect(screen.getByLabelText('Projekt').getAttribute('aria-invalid')).toBe('true');
		// Choosing another project clears both.
		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: '' } });
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByLabelText('Projekt').hasAttribute('aria-invalid')).toBe(false);
	});

	it('deletes after the question and says that the tickets stay', async () => {
		const props = show(rule());
		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		const question = screen.getByRole('dialog', { name: 'Regel löschen?' });
		expect(question.textContent).toContain('Bestehende Tickets bleiben erhalten.');
		expect(question.textContent).toContain('TASK-7 bleibt als normales Ticket offen');
		expect(document.activeElement).toBe(
			within(question).getByRole('button', { name: 'Abbrechen' })
		);
		await fireEvent.click(within(question).getByRole('button', { name: 'Löschen' }));
		await vi.waitFor(() => expect(props.ondeleted).toHaveBeenCalledTimes(1));
		expect(props.ondelete).toHaveBeenCalledTimes(1);
	});

	it('asks before unsaved changes are lost on Escape', async () => {
		const props = show(rule());
		const title = screen.getByLabelText('Titel');
		await fireEvent.input(title, { target: { value: 'Anders' } });
		await fireEvent.keyDown(title, { key: 'Escape' });
		expect(screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('links to the help with the examples in a new tab', () => {
		show(rule());
		const link = screen.getByRole('link', { name: 'So funktionieren Wiederholungen (neuer Tab)' });
		expect(link.getAttribute('href')).toBe('/einstellungen/hilfe#wiederholungen');
		expect(link.getAttribute('target')).toBe('_blank');
	});

	it('is built on the side panel and uses no own hints or dialogs', () => {
		expect(source).toMatch(/import Drawer from '\.\/overlay\/Drawer\.svelte';/);
		expect(source).toMatch(/import ConfirmDialog from '\.\/overlay\/ConfirmDialog\.svelte';/);
		expect(source).toMatch(/import SectionMessage from '\.\/guidance\/SectionMessage\.svelte';/);
		expect(source).not.toMatch(/<dialog\b|window\.confirm|class="notice/);
	});
});

// Plan WV-3 (ADR-0022 addendum 10): the list "Unteraufgaben" of the template in the rule panel.
describe('RecurrencePanel: the sub-tasks of the template (plan WV-3)', () => {
	it('creates a new rule with its list, after checking every title', async () => {
		const props = show(null, { subtasksAvailable: true });
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Kaffeemaschine' } });
		const list = screen.getByRole('group', { name: 'Unteraufgaben' });
		// No ticket here: nothing to take over.
		expect(
			within(list).queryByRole('button', { name: 'Unteraufgaben dieses Tickets übernehmen' })
		).toBeNull();
		await fireEvent.click(within(list).getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.click(within(list).getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.input(within(list).getByLabelText('Titel der Unteraufgabe 1'), {
			target: { value: ' Entkalken ' }
		});
		await fireEvent.change(within(list).getByLabelText('Priorität der Unteraufgabe 1'), {
			target: { value: 'high' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await tick();
		// The second row has no title: nothing is sent, the row says why and has the focus.
		expect(props.onsave).not.toHaveBeenCalled();
		const empty = within(list).getByLabelText('Titel der Unteraufgabe 2');
		expect(empty.getAttribute('aria-invalid')).toBe('true');
		await vi.waitFor(() => expect(document.activeElement).toBe(empty));

		await fireEvent.input(empty, { target: { value: 'Filter wechseln' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() => expect(props.onsave).toHaveBeenCalledTimes(1));
		expect(props.onsave.mock.calls[0]?.[0]).toMatchObject({
			title: 'Kaffeemaschine',
			template_subtasks: [
				{ title: 'Entkalken', priority: 'high' },
				{ title: 'Filter wechseln', priority: 'medium' }
			]
		});
	});

	it('shows the list of a rule, counts a change as unsaved input and shows a refusal at the list', async () => {
		const onsave = vi.fn<(draft: Partial<RuleDraft>) => Promise<SaveResult>>(async () => ({
			ok: false,
			message: null,
			fields: { template_subtasks: 'Die Vorlage hat höchstens 20 Unteraufgaben.' }
		}));
		const props = show(rule({ templateSubtasks: [{ title: 'Entkalken', priority: 'high' }] }), {
			subtasksAvailable: true,
			onsave
		});
		const list = screen.getByRole('group', { name: 'Unteraufgaben' });
		expect(within(list).getByLabelText<HTMLInputElement>('Titel der Unteraufgabe 1').value).toBe(
			'Entkalken'
		);
		await fireEvent.click(within(list).getByRole('button', { name: '„Entkalken“ entfernen' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
		expect(onsave.mock.calls[0]?.[0]).toMatchObject({ template_subtasks: [] });
		await vi.waitFor(() =>
			expect(within(list).getByText('Die Vorlage hat höchstens 20 Unteraufgaben.')).toBeTruthy()
		);
		// Unsaved: Escape asks before the change is lost.
		await fireEvent.keyDown(screen.getByLabelText('Titel'), { key: 'Escape' });
		expect(screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('leaves the list out and sends none before the migration', async () => {
		const props = show(rule());
		expect(screen.queryByRole('group', { name: 'Unteraufgaben' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() => expect(props.onsave).toHaveBeenCalledTimes(1));
		expect(props.onsave.mock.calls[0]?.[0]).not.toHaveProperty('template_subtasks');
	});
});
