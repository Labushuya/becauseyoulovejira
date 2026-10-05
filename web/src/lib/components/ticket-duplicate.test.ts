// "Duplizieren …" (ADR-0045): the question as a modal M in the side panel and inline inside a
// modal (the full view), the required status, what is taken over, the source, the series hint,
// refusals at their field and opening the duplicate. The store runs for real on a fake data layer.
// The entry in the menu "•••" of the header is covered in ticket-actions.test.ts and
// ticket-panel.test.ts (plan aktionsmenues).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DuplicateOutcome, DuplicateRequest } from '$lib/domain/duplicate';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { ProjectRef, Ticket } from '$lib/domain/ticket';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import DuplicateDialog from './DuplicateDialog.svelte';

useOverlayStubs();

const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARDEN: ProjectRef = { id: 'proj00000000002', name: 'Garten', code: 'GART', archived: false };
const OLD: ProjectRef = { id: 'proj00000000003', name: 'Altbau', code: 'ALT', archived: true };

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: 'ticket000000012',
		key: 'HAUS-12',
		title: 'Rasen mähen',
		description: 'Mit Fangkorb',
		sourceItem: null,
		status: 'in_progress',
		priority: 'high',
		due: '2026-10-05',
		projectId: HOUSE.id,
		tagIds: ['tag000000000001'],
		project: HOUSE,
		tags: [{ id: 'tag000000000001', name: 'Garten' }],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-02 12:30:00.000Z',
		...overrides
	};
}

function mailSource(overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id: 'item00000000001',
		channel: 'mail',
		kind: 'mail',
		title: 'Rechnung März',
		sourceUrl: '',
		sourceRef: 'x@example.com',
		sourceDate: null,
		sourceMeta: {},
		original: 'mail.eml',
		state: 'converted',
		ticketId: 'ticket000000012',
		handledAt: '2026-09-01 10:00:00.000Z',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const OUTCOME: DuplicateOutcome = {
	id: 'dupl00000000013',
	key: 'HAUS-13',
	title: 'Rasen mähen (Kopie)',
	original: { id: 'ticket000000012', key: 'HAUS-12' },
	subtasks: [],
	comments: 0,
	source: null
};

function storeOf(
	answer: (request: DuplicateRequest) => Promise<DuplicateOutcome> = async () => OUTCOME
) {
	const flags: FlagInput[] = [];
	const data = { duplicate: vi.fn((_id: string, request: DuplicateRequest) => answer(request)) };
	const store = new TicketDuplicateStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		{
			show: (input) => {
				flags.push(input);
				return 'flag';
			},
			dismiss: vi.fn()
		}
	);
	return { store, data, flags };
}

interface Setup {
	ticket?: Ticket;
	sources?: InboxItemSummary[];
	commentCount?: number;
	subtaskCount?: number;
	parentKey?: string | null;
	answer?: (request: DuplicateRequest) => Promise<DuplicateOutcome>;
	inModal?: boolean;
}

/** The dialog alone: in the side panel a modal, inside a modal (the full view) inline. */
function renderDialog(setup: Setup = {}) {
	const { store, data, flags } = storeOf(setup.answer);
	const onopen = vi.fn();
	const onclose = vi.fn();
	const props = {
		ticket: setup.ticket ?? ticket(),
		projects: [HOUSE, GARDEN],
		sources: setup.sources ?? [],
		commentCount: setup.commentCount ?? 0,
		subtaskCount: setup.subtaskCount ?? 0,
		parentKey: setup.parentKey ?? null,
		store,
		onopen,
		onclose
	};
	if (setup.inModal) render(InModalHarness, { props: { component: DuplicateDialog, props } });
	else render(DuplicateDialog, { props });
	return { data, flags, onopen, onclose };
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Duplizieren' }));
const statusGroup = () => screen.getByRole('radiogroup', { name: 'Status des Duplikats' });

describe('the question "Wie soll das Duplikat entstehen?"', () => {
	it('starts with "(Kopie)", every field of the ticket checked, the project chosen and no status', () => {
		renderDialog();
		expect(screen.getByLabelText<HTMLInputElement>('Titel').value).toBe('Rasen mähen (Kopie)');
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		const checked = (name: string) =>
			within(take).getByRole<HTMLInputElement>('checkbox', { name }).checked;
		expect(checked('Beschreibung')).toBe(true);
		expect(checked('Priorität: Hoch')).toBe(true);
		expect(checked('Projekt')).toBe(true);
		expect(checked('Tags: Garten')).toBe(true);
		expect(checked('Fälligkeit: 05.10.2026')).toBe(true);
		expect(
			within(take).getByRole<HTMLSelectElement>('combobox', { name: 'Projekt des Duplikats' }).value
		).toBe(HOUSE.id);
		// Only for sub-tasks, parents and tickets with comments; no sources, no section.
		expect(within(take).queryByRole('checkbox', { name: /Unteraufgaben/ })).toBeNull();
		expect(within(take).queryByRole('checkbox', { name: /Kommentare/ })).toBeNull();
		expect(within(take).queryByRole('checkbox', { name: /einordnen/ })).toBeNull();
		expect(screen.queryByRole('radiogroup', { name: 'Quelle' })).toBeNull();

		const radios = within(statusGroup()).getAllByRole<HTMLInputElement>('radio');
		expect(radios.map((radio) => radio.labels?.[0]?.textContent?.trim())).toEqual([
			'Offen',
			'Wie das Original: In Arbeit',
			'Backlog',
			'Wartet'
		]);
		expect(radios.some((radio) => radio.checked)).toBe(false);
		expect(statusGroup().getAttribute('aria-required')).toBe('true');
	});

	it('takes the own color over unless unchecked, and offers it only when the server knows it (ADR-0052)', async () => {
		const { data } = renderDialog({ ticket: ticket({ color: 'blau' }) });
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		const color = within(take).getByRole<HTMLInputElement>('checkbox', { name: 'Farbe: Blau' });
		expect(color.checked).toBe(true);
		await fireEvent.click(color);
		await fireEvent.click(within(statusGroup()).getByRole('radio', { name: 'Offen' }));
		await submit();
		await vi.waitFor(() => expect(data.duplicate).toHaveBeenCalledOnce());
		expect(data.duplicate.mock.calls[0]?.[1].take.color).toBe(false);
	});

	it('names "wie Projekt" without an own color', () => {
		renderDialog({ ticket: ticket({ color: null }) });
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		expect(
			within(take).getByRole<HTMLInputElement>('checkbox', { name: 'Farbe: wie Projekt' }).checked
		).toBe(true);
	});

	it('has no color to take over while the server does not know it', () => {
		renderDialog();
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		expect(within(take).queryByRole('checkbox', { name: /Farbe/ })).toBeNull();
	});

	it('sends nothing without a status, marks the group and moves the focus to it', async () => {
		const { data } = renderDialog();
		await submit();
		await tick();
		expect(data.duplicate).not.toHaveBeenCalled();
		const group = statusGroup();
		expect(group.getAttribute('aria-invalid')).toBe('true');
		expect(group.textContent).toContain('Bitte wählen, mit welchem Status das Duplikat startet.');
		await vi.waitFor(() => expect(document.activeElement).toBe(group));

		await fireEvent.click(within(group).getByRole('radio', { name: 'Offen' }));
		expect(group.getAttribute('aria-invalid')).toBeNull();
	});

	it('sends the answers, closes and opens the duplicate; the flag leads back to the original', async () => {
		const { data, flags, onopen, onclose } = renderDialog({ subtaskCount: 2, commentCount: 3 });
		await fireEvent.input(screen.getByLabelText('Titel'), { target: { value: 'Rasen vorne' } });
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		await fireEvent.click(within(take).getByRole('checkbox', { name: 'Tags: Garten' }));
		await fireEvent.click(within(take).getByRole('checkbox', { name: 'Unteraufgaben (2)' }));
		await fireEvent.click(within(take).getByRole('checkbox', { name: 'Kommentare (3)' }));
		await fireEvent.change(within(take).getByRole('combobox', { name: 'Projekt des Duplikats' }), {
			target: { value: GARDEN.id }
		});
		await fireEvent.click(within(statusGroup()).getByRole('radio', { name: 'Backlog' }));
		await submit();

		await vi.waitFor(() => expect(onopen).toHaveBeenCalledWith(OUTCOME.id));
		expect(data.duplicate).toHaveBeenCalledWith('ticket000000012', {
			title: 'Rasen vorne',
			status: 'backlog',
			project: GARDEN.id,
			take: {
				description: true,
				priority: true,
				tags: false,
				due: true,
				parent: true,
				subtasks: true,
				comments: true,
				color: true
			},
			source: 'none'
		});
		expect(onclose).toHaveBeenCalledOnce();
		expect(flags[0]).toMatchObject({
			title: 'HAUS-12 dupliziert.',
			description: 'Das Duplikat ist HAUS-13.'
		});
		flags[0]?.action?.run();
		expect(onopen).toHaveBeenLastCalledWith('ticket000000012');
	});

	it('sends no project when "Projekt" is unchecked, and offers none for an archived one', async () => {
		const { data } = renderDialog({ ticket: ticket({ projectId: OLD.id, project: OLD }) });
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		const select = within(take).getByRole<HTMLSelectElement>('combobox', {
			name: 'Projekt des Duplikats'
		});
		expect(select.value).toBe('');
		expect(screen.getByText(/„Altbau“ ist archiviert und nimmt keine Tickets auf/)).toBeTruthy();
		await fireEvent.click(within(take).getByRole('checkbox', { name: 'Projekt' }));
		expect(within(take).queryByRole('combobox')).toBeNull();
		await fireEvent.click(within(statusGroup()).getByRole('radio', { name: 'Offen' }));
		await submit();
		await vi.waitFor(() => expect(data.duplicate).toHaveBeenCalled());
		expect(data.duplicate.mock.calls[0]?.[1].project).toBeNull();
	});

	it('shows a refusal of the server at its field and keeps the dialog open', async () => {
		const { onclose } = renderDialog({
			answer: async () => {
				throw new DataError('validation', {
					status: 400,
					fields: {
						title: {
							code: 'validation_duplicate_title',
							message: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.'
						}
					}
				});
			}
		});
		await fireEvent.click(within(statusGroup()).getByRole('radio', { name: 'Offen' }));
		await submit();
		const title = screen.getByLabelText('Titel');
		await vi.waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'));
		const describedBy = title.getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(describedBy)?.textContent).toContain('höchstens 200 Zeichen');
		expect(onclose).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(document.activeElement).toBe(title));
	});

	it('offers the parent of a sub-task, checked', () => {
		renderDialog({ ticket: ticket({ parentId: 'parent000000001' }), parentKey: 'HAUS-7' });
		const take = screen.getByRole('group', { name: 'Übernehmen' });
		expect(
			within(take).getByRole<HTMLInputElement>('checkbox', { name: 'Unter HAUS-7 einordnen' })
				.checked
		).toBe(true);
	});

	it('asks for the source only with sources: none by default, the copy with what it holds', async () => {
		const { data } = renderDialog({
			ticket: ticket({ sourceItem: 'item00000000001' }),
			sources: [mailSource()]
		});
		const group = screen.getByRole('radiogroup', { name: 'Quelle' });
		expect(
			within(group).getByRole<HTMLInputElement>('radio', { name: 'Keine Quelle' }).checked
		).toBe(true);
		const copy = within(group).getByRole<HTMLInputElement>('radio', {
			name: 'Kopie der Herkunft übernehmen'
		});
		expect(copy.disabled).toBe(false);
		expect(
			document.getElementById(copy.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('Kopie von „Rechnung März“ (Postfach)');
		await fireEvent.click(copy);
		await fireEvent.click(within(statusGroup()).getByRole('radio', { name: 'Offen' }));
		await submit();
		await vi.waitFor(() => expect(data.duplicate).toHaveBeenCalled());
		expect(data.duplicate.mock.calls[0]?.[1].source).toBe('copy');
	});

	it('locks the copy without a main source and says why', () => {
		renderDialog({ sources: [mailSource({ id: 'item00000000002' })] });
		const copy = screen.getByRole<HTMLInputElement>('radio', {
			name: 'Kopie der Herkunft übernehmen'
		});
		expect(copy.disabled).toBe(true);
		expect(document.getElementById(copy.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Das Original hat keine Hauptquelle, die sich kopieren ließe.'
		);
	});

	it('takes the source tickets over with the copy, also without a main source (ADR-0067)', async () => {
		const ticketSources = [
			{ id: 'ticket000000003', key: 'HAUS-3', trashed: false },
			{ id: 'ticket000000005', key: 'HAUS-5', trashed: false },
			{ id: 'ticket000000007', key: 'HAUS-7', trashed: true }
		];
		const { store } = storeOf();
		render(DuplicateDialog, {
			props: {
				ticket: ticket(),
				projects: [HOUSE],
				ticketSources,
				store,
				onopen: vi.fn(),
				onclose: vi.fn()
			}
		});
		const copy = screen.getByRole<HTMLInputElement>('radio', {
			name: 'Kopie der Herkunft übernehmen'
		});
		expect(copy.disabled).toBe(false);
		expect(
			document.getElementById(copy.getAttribute('aria-describedby') ?? '')?.textContent?.trim()
		).toBe('Das Duplikat stammt wie das Original aus HAUS-3 und HAUS-5.');
	});

	it('names the source tickets after the copy of the main source', () => {
		const { store } = storeOf();
		render(DuplicateDialog, {
			props: {
				ticket: ticket({ sourceItem: 'item00000000001' }),
				projects: [HOUSE],
				sources: [mailSource()],
				ticketSources: [{ id: 'ticket000000003', key: 'HAUS-3', trashed: false }],
				store,
				onopen: vi.fn(),
				onclose: vi.fn()
			}
		});
		const copy = screen.getByRole<HTMLInputElement>('radio', {
			name: 'Kopie der Herkunft übernehmen'
		});
		expect(
			document.getElementById(copy.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('Außerdem stammt es wie das Original aus HAUS-3.');
	});

	it('says that a series never comes along', () => {
		renderDialog({ ticket: ticket({ recurring: true, recurrenceId: 'rule00000000001' }) });
		expect(
			screen.getByText(
				'HAUS-12 gehört zu einer Serie. Das Duplikat wird ein normales Ticket ohne Wiederholung.'
			)
		).toBeTruthy();
	});

	it('stands inline inside a modal (the full view): one dialog, Escape closes only the area', async () => {
		const { onclose } = renderDialog({ inModal: true });
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		const area = screen.getByRole('region', { name: 'HAUS-12 duplizieren' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(area).getByLabelText('Titel'))
		);
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.activeElement?.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(true);
		expect(onclose).toHaveBeenCalledOnce();
	});
});
