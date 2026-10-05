// Tickets as sources (QT-1, ADR-0067) in the ticket: the section "Quellen" with entries of the inbox
// and source tickets mixed (a link to each ticket, "(im Papierkorb)" without one, removing as a named
// icon button), "Quelle hinzufügen" as a menu with both ways, the ticket picker of "Ticket …" without
// the ticket itself, its sources and every ticket that would close a circle (done tickets included),
// the refusal of a circle with its chain at the field, the section "Folge-Tickets", the question
// "Folge-Ticket anlegen …" and the state before the migration. Real stores with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { RecordChange, Unsubscribe } from '$lib/data/realtime';
import type { TicketSourceLink } from '$lib/data/ticket-origins';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { ProjectRef, Ticket, TicketSummary } from '$lib/domain/ticket';
import type {
	FollowUpOutcome,
	FollowUpRequest,
	TicketOrigin,
	TicketOrigins
} from '$lib/domain/ticket-origins';
import { FlagStore } from '$lib/stores/flags.svelte';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import { TicketFollowUpStore } from '$lib/stores/ticket-follow-up.svelte';
import { TicketOriginsStore, type TicketOriginsData } from '$lib/stores/ticket-origins.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import FollowUpDialog from './FollowUpDialog.svelte';
import TicketFollowUps from './TicketFollowUps.svelte';
import TicketSources from './TicketSources.svelte';

useOverlayStubs();

const SCOPE = 'u:owner0000000001';
const TICKET = { id: 'ticket000000004', key: 'TASK-4', sourceItem: null, scope: SCOPE };
const SESSION = { ensureValid: () => true, logout: vi.fn() };
const hrefOf = (id: string) => `/tickets/${id}` as ResolvedPathname;

function origin(id: string, key: string, overrides: Partial<TicketOrigin> = {}): TicketOrigin {
	return {
		link: `link${id.slice(4)}`,
		id,
		key,
		title: `Ticket ${key}`,
		status: 'open',
		trashed: false,
		created: '2026-10-01 08:00:00.000Z',
		createdBy: 'owner0000000001',
		...overrides
	};
}

function origins(overrides: Partial<TicketOrigins> = {}): TicketOrigins {
	return {
		ticketId: TICKET.id,
		sources: [],
		followUps: [],
		descendants: [],
		already: false,
		...overrides
	};
}

const MAIL: InboxItemSummary = {
	id: 'item00000000001',
	channel: 'mail',
	kind: 'mail',
	title: 'Rechnung März',
	sourceUrl: '',
	sourceRef: 'x@example.com',
	sourceDate: null,
	sourceMeta: {},
	original: '',
	state: 'converted',
	ticketId: TICKET.id,
	handledAt: '2026-09-25 09:00:00.000Z',
	created: '2026-09-25 08:00:00.000Z',
	updated: '2026-09-25 09:00:00.000Z'
};

/** The data layer of the origins as spies. */
type FakeOrigins = { [K in keyof TicketOriginsData]: Mock<TicketOriginsData[K]> };

/** A fake data layer of the origins with spies; `links` lets a test send realtime events. */
function originsData(start: TicketOrigins | Error, answers: Partial<FakeOrigins> = {}) {
	const handlers: ((change: RecordChange<TicketSourceLink>) => void)[] = [];
	const unsubscribe: Unsubscribe = async () => undefined;
	const data: FakeOrigins = {
		load: vi.fn<TicketOriginsData['load']>(async () => {
			if (start instanceof Error) throw start;
			return start;
		}),
		add: vi.fn<TicketOriginsData['add']>(async () => origins()),
		remove: vi.fn<TicketOriginsData['remove']>(async () => origins()),
		links: vi.fn<TicketOriginsData['links']>(async (_id, onChange) => {
			handlers.push(onChange);
			return unsubscribe;
		}),
		tickets: vi.fn<TicketOriginsData['tickets']>(async () => unsubscribe),
		reconnected: vi.fn<TicketOriginsData['reconnected']>(async () => unsubscribe),
		...answers
	};
	return { data, handlers };
}

async function setup(
	start: TicketOrigins | Error,
	options: {
		items?: InboxItemSummary[];
		answers?: Partial<FakeOrigins>;
		open?: TicketSummary[];
		done?: TicketSummary[];
		inModal?: boolean;
	} = {}
) {
	const sourcesData = {
		list: vi.fn<TicketSourcesData['list']>(async () => options.items ?? []),
		link: vi.fn<TicketSourcesData['link']>(),
		release: vi.fn<TicketSourcesData['release']>(),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
	} satisfies TicketSourcesData;
	const flags = new FlagStore();
	const sources = new TicketSourcesStore(sourcesData, SESSION, flags);
	sources.open(TICKET.id, TICKET.sourceItem);
	const { data, handlers } = originsData(start, options.answers);
	const store = new TicketOriginsStore(data, SESSION, flags, { health: new LiveHealth() });
	store.open(TICKET.id);
	const picker = fakePickerSource({ open: options.open ?? [], done: options.done ?? [] });
	const props = {
		ticket: TICKET,
		store: sources,
		candidates: [],
		picker: picker.source,
		origins: store,
		hrefOf
	};
	if (options.inModal) render(InModalHarness, { props: { component: TicketSources, props } });
	else render(TicketSources, { props });
	await vi.waitFor(() => expect(sources.state).toBe('ready'));
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	return { store, data, handlers, flags, picker };
}

/**
 * Opens the menu "Quelle hinzufügen" and chooses `name`. jsdom renders a popover as display: none
 * and computes no name for it; hence `hidden`.
 */
async function chooseAdd(name: string): Promise<HTMLElement> {
	const trigger = screen.getByRole('button', { name: 'Quelle hinzufügen' });
	await fireEvent.click(trigger);
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement;
	await fireEvent.click(within(menu).getByRole('menuitem', { name, hidden: true }));
	return menu;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('section "Quellen" with source tickets', () => {
	it('lists entries of the inbox and source tickets together, the one in the trash without a link', async () => {
		await setup(
			origins({
				sources: [
					origin('tick00000000001', 'HAUS-3', { title: 'Heizung prüfen', status: 'done' }),
					origin('tick00000000002', 'HAUS-7', { title: 'Alte Notiz', trashed: true })
				]
			}),
			{ items: [MAIL] }
		);
		const section = screen.getByRole('region', { name: 'Quellen' });
		const rows = within(section).getAllByRole('listitem');
		expect(rows).toHaveLength(3);
		expect(rows[0]?.textContent).toContain('Rechnung März');

		const ticket = rows[1] as HTMLElement;
		expect(ticket.textContent).toContain('Ticket');
		expect(ticket.textContent).toContain('Heizung prüfen');
		expect(ticket.textContent).toContain('Erledigt');
		expect(within(ticket).getByRole('link', { name: 'HAUS-3' }).getAttribute('href')).toBe(
			'/tickets/tick00000000001'
		);

		const trashed = rows[2] as HTMLElement;
		expect(trashed.textContent).toContain('HAUS-7');
		expect(trashed.textContent).toContain('(im Papierkorb)');
		expect(within(trashed).queryByRole('link')).toBeNull();
		expect(
			within(trashed).getByRole('button', { name: 'HAUS-7 als Quelle entfernen' }).className
		).toContain('button-icon');
	});

	it('removes a source ticket with a flag, the section follows the answer', async () => {
		const { data, flags } = await setup(
			origins({ sources: [origin('tick00000000001', 'HAUS-3')] })
		);
		await fireEvent.click(screen.getByRole('button', { name: 'HAUS-3 als Quelle entfernen' }));
		expect(data.remove).toHaveBeenCalledWith(TICKET.id, 'tick00000000001');
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Noch keine Quellen' })).toBeTruthy()
		);
		expect(flags.flags.at(-1)?.title).toBe('HAUS-3 ist keine Quelle von TASK-4 mehr.');
	});

	it('loads again when a link of the ticket changes elsewhere', async () => {
		const { data, handlers } = await setup(origins());
		expect(data.load).toHaveBeenCalledTimes(1);
		data.load.mockResolvedValueOnce(origins({ sources: [origin('tick00000000001', 'HAUS-3')] }));
		handlers[0]?.({
			action: 'create',
			record: { id: 'link00000000001', ticket: TICKET.id, source: 'tick00000000001' }
		});
		await vi.waitFor(() => expect(screen.getByRole('link', { name: 'HAUS-3' })).toBeTruthy());
		expect(data.load).toHaveBeenCalledTimes(2);
	});
});

describe('"Quelle hinzufügen → Ticket"', () => {
	const self = pickerTicket({ id: TICKET.id, key: 'TASK-4', title: 'Dieses' });
	const linked = pickerTicket({ id: 'tick00000000001', key: 'HAUS-3', title: 'Schon Quelle' });
	const below = pickerTicket({ id: 'tick00000000005', key: 'HAUS-5', title: 'Folge davon' });
	const further = pickerTicket({ id: 'tick00000000006', key: 'HAUS-6', title: 'Folge der Folge' });
	const free = pickerTicket({ id: 'tick00000000008', key: 'HAUS-8', title: 'Frei' });
	const done = pickerTicket({
		id: 'tick00000000009',
		key: 'HAUS-9',
		title: 'Erledigt',
		status: 'done'
	});

	it('offers both ways in a menu; the picker leaves the ticket, its sources and every circle out, done tickets in', async () => {
		const { data, flags, picker } = await setup(
			origins({
				sources: [origin(linked.id, 'HAUS-3')],
				followUps: [origin(below.id, 'HAUS-5')],
				descendants: [below.id, further.id]
			}),
			{ open: [self, linked, below, further, free], done: [done] }
		);
		const menu = await chooseAdd('Ticket …');
		expect(menu.getAttribute('aria-label')).toBe('Quelle hinzufügen');
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Eintrag aus dem Eingang …', 'Ticket …']);

		const dialog = screen.getByRole('dialog', { name: 'Quelle für TASK-4 hinzufügen' });
		const input = within(dialog).getByRole('combobox', {
			name: 'Ticket als Quelle'
		}) as HTMLInputElement;
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		// Done tickets come without switching "Nur offene" off.
		await vi.waitFor(() => expect(picker.listDone).toHaveBeenCalled());
		const listbox = document.getElementById(
			input.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		const keys = () =>
			within(listbox)
				.getAllByRole('option', { hidden: true })
				.map((option) => /HAUS-\d+/.exec(option.textContent ?? '')?.[0])
				.sort();
		await vi.waitFor(() => expect(keys()).toEqual(['HAUS-8', 'HAUS-9']));

		await fireEvent.input(input, { target: { value: 'Frei' } });
		await vi.waitFor(() => expect(keys()).toEqual(['HAUS-8']));
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('HAUS-8 Frei');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Als Quelle hinzufügen' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(data.add).toHaveBeenCalledWith(TICKET.id, free.id);
		expect(flags.flags.at(-1)?.title).toBe('TASK-4 stammt jetzt aus HAUS-8.');
	});

	it('names the chain of a circle the server refuses at the field', async () => {
		const refusal = {
			status: 400,
			response: {
				data: {
					source: {
						code: 'validation_ticket_source_cycle',
						message: 'HAUS-8 stammt bereits (über HAUS-12) von TASK-4 ab.',
						params: { path: ['HAUS-8', 'HAUS-12', 'TASK-4'] }
					}
				}
			}
		};
		const { data } = await setup(origins(), {
			open: [free],
			answers: {
				add: vi.fn<TicketOriginsData['add']>(async () => {
					throw refusal;
				})
			}
		});
		await chooseAdd('Ticket …');
		const dialog = screen.getByRole('dialog', { name: 'Quelle für TASK-4 hinzufügen' });
		const input = within(dialog).getByRole('combobox', {
			name: 'Ticket als Quelle'
		}) as HTMLInputElement;
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Als Quelle hinzufügen' }));
		await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
		expect(data.add).toHaveBeenCalledOnce();
		expect(
			within(dialog).getByText('HAUS-8 stammt bereits (über HAUS-12) von TASK-4 ab.')
		).toBeTruthy();
		expect(screen.getByRole('dialog', { name: 'Quelle für TASK-4 hinzufügen' })).toBe(dialog);
	});

	it('asks for a ticket before it sends anything', async () => {
		const { data } = await setup(origins(), { open: [free] });
		await chooseAdd('Ticket …');
		const dialog = screen.getByRole('dialog', { name: 'Quelle für TASK-4 hinzufügen' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Als Quelle hinzufügen' }));
		expect(within(dialog).getByText('Bitte ein Ticket wählen.')).toBeTruthy();
		expect(data.add).not.toHaveBeenCalled();
	});

	it('unfolds the picker inline in the full view', async () => {
		await setup(origins(), { open: [free], inModal: true });
		await chooseAdd('Ticket …');
		const section = screen.getByRole('region', { name: 'Quellen' });
		expect(
			within(section).getByRole('region', { name: 'Quelle für TASK-4 hinzufügen' })
		).toBeTruthy();
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
	});

	it('keeps the single button for the inbox before the migration (503)', async () => {
		const unavailable = Object.assign(new Error('503'), { status: 503 });
		const { store } = await setup(unavailable);
		expect(store.available).toBe(false);
		expect(screen.getByRole('button', { name: 'Quelle hinzufügen …' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Quelle hinzufügen' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Noch keine Quellen' })).toBeTruthy();
	});
});

describe('section "Folge-Tickets"', () => {
	async function followUps(start: TicketOrigins) {
		const { data } = originsData(start);
		const store = new TicketOriginsStore(data, SESSION, new FlagStore(), {
			health: new LiveHealth()
		});
		store.open(TICKET.id);
		render(TicketFollowUps, { props: { ticket: TICKET, store, hrefOf } });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		return store;
	}

	it('lists the direct follow-ups with a link each, the one in the trash without', async () => {
		await followUps(
			origins({
				followUps: [
					origin('tick00000000020', 'HAUS-20', { title: 'Reparatur', status: 'in_progress' }),
					origin('tick00000000021', 'HAUS-21', { title: 'Weg damit', trashed: true })
				],
				descendants: ['tick00000000020', 'tick00000000021', 'tick00000000030']
			})
		);
		const section = screen.getByRole('region', { name: 'Folge-Tickets' });
		const rows = within(section).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(
			within(rows[0] as HTMLElement)
				.getByRole('link', { name: 'HAUS-20' })
				.getAttribute('href')
		).toBe('/tickets/tick00000000020');
		expect(rows[0]?.textContent).toContain('Reparatur');
		expect(rows[0]?.textContent).toContain('In Arbeit');
		expect(within(rows[1] as HTMLElement).queryByRole('link')).toBeNull();
		expect(rows[1]?.textContent).toContain('(im Papierkorb)');
	});

	it('is not there without follow-ups', async () => {
		await followUps(origins({ sources: [origin('tick00000000001', 'HAUS-3')] }));
		expect(screen.queryByRole('region', { name: 'Folge-Tickets' })).toBeNull();
	});
});

describe('"Folge-Ticket anlegen …"', () => {
	const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };

	function source(overrides: Partial<Ticket> = {}): Ticket {
		return {
			id: 'ticket000000012',
			key: 'HAUS-12',
			title: 'Heizung prüfen',
			description: 'Thermostat tauschen',
			sourceItem: null,
			status: 'done',
			priority: 'high',
			due: null,
			projectId: HOUSE.id,
			tagIds: ['tag000000000001'],
			project: HOUSE,
			tags: [{ id: 'tag000000000001', name: 'Wohnung' }],
			recurring: false,
			source: null,
			completedAt: '2026-10-01 10:00:00.000Z',
			created: '2026-09-01 10:00:00.000Z',
			updated: '2026-10-01 10:00:00.000Z',
			charm: 'werkzeug',
			...overrides
		};
	}

	function dialog(
		project: ProjectRef | null,
		create: (id: string, request: FollowUpRequest) => Promise<FollowUpOutcome>
	) {
		const flags = new FlagStore();
		const store = new TicketFollowUpStore({ create: vi.fn(create) }, SESSION, flags);
		const onopen = vi.fn();
		const onclose = vi.fn();
		render(FollowUpDialog, { props: { ticket: source(), project, store, onopen, onclose } });
		return { flags, onopen, onclose };
	}

	it('suggests "Folge: ‹Titel›", tags and charm on, the description off, and opens the new ticket', async () => {
		const create = vi.fn(
			async (_id: string, request: FollowUpRequest): Promise<FollowUpOutcome> => ({
				id: 'ticket000000021',
				key: 'HAUS-21',
				title: request.title,
				project: HOUSE.id,
				source: { id: 'ticket000000012', key: 'HAUS-12' }
			})
		);
		const { flags, onopen, onclose } = dialog(HOUSE, create);
		const modal = screen.getByRole('dialog', { name: 'Folge-Ticket aus HAUS-12' });
		expect((within(modal).getByRole('textbox', { name: 'Titel' }) as HTMLInputElement).value).toBe(
			'Folge: Heizung prüfen'
		);
		expect(
			(within(modal).getByRole('checkbox', { name: 'Tags: Wohnung' }) as HTMLInputElement).checked
		).toBe(true);
		expect(
			(within(modal).getByRole('checkbox', { name: /^Charm:/ }) as HTMLInputElement).checked
		).toBe(true);
		expect(
			(within(modal).getByRole('checkbox', { name: 'Beschreibung' }) as HTMLInputElement).checked
		).toBe(false);
		expect(modal.textContent).toContain('in das Projekt „Haus“ im selben Bereich');
		expect(modal.textContent).toContain('Aufgabe');

		await fireEvent.click(within(modal).getByRole('checkbox', { name: 'Beschreibung' }));
		await fireEvent.click(within(modal).getByRole('button', { name: 'Folge-Ticket anlegen' }));
		await vi.waitFor(() => expect(onopen).toHaveBeenCalledWith('ticket000000021'));
		expect(onclose).toHaveBeenCalledOnce();
		expect(create).toHaveBeenCalledWith('ticket000000012', {
			title: 'Folge: Heizung prüfen',
			take: { tags: true, charm: true, description: true }
		});
		expect(flags.flags.at(-1)).toMatchObject({
			title: 'Folge-Ticket HAUS-21 angelegt.',
			description: 'Es stammt aus HAUS-12.'
		});
	});

	it('says that an archived project stays behind', () => {
		dialog({ ...HOUSE, archived: true }, async () => {
			throw new Error('not sent');
		});
		expect(screen.getByRole('dialog').textContent).toContain(
			'„Haus“ ist archiviert; das Folge-Ticket kommt ohne Projekt in denselben Bereich.'
		);
	});

	it('refuses an empty title at the field without sending', async () => {
		const create = vi.fn(async (): Promise<FollowUpOutcome> => {
			throw new Error('not sent');
		});
		const { onopen } = dialog(HOUSE, create);
		const title = screen.getByRole('textbox', { name: 'Titel' });
		await fireEvent.input(title, { target: { value: '   ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Folge-Ticket anlegen' }));
		await vi.waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'));
		expect(screen.getByText('Bitte einen Titel mit höchstens 200 Zeichen angeben.')).toBeTruthy();
		expect(create).not.toHaveBeenCalled();
		expect(onopen).not.toHaveBeenCalled();
	});

	it('names a source that is gone meanwhile in the dialog', async () => {
		const { onclose } = dialog(HOUSE, async () => {
			throw { status: 404, response: {} };
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Folge-Ticket anlegen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('alert').textContent).toContain('gibt es nicht mehr')
		);
		expect(onclose).not.toHaveBeenCalled();
	});
});
