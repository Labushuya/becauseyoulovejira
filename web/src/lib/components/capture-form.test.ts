// Component tests of the capture by template (E4 plan, package 5; OF-E4-1 (a), OF-E4-3): radio
// group of the templates, required fields with field errors (ADR-0009), target ticket or inbox
// (switch, Alt+Enter, Ctrl+Enter), result with link, emptied form, and the route /eingang/neu
// with the template in the URL.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project } from '$lib/domain/project';
import type { Capture, CaptureTarget } from '$lib/domain/templates';
import type { Ticket } from '$lib/domain/ticket';
import type { CaptureSaveResult } from '$lib/stores/capture';
import CaptureForm from './CaptureForm.svelte';
import CapturePage from '../../routes/(app)/eingang/neu/+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/eingang/neu?vorlage=anruf') },
	detail: { create: vi.fn(), reset: vi.fn() },
	catalog: {
		activeProjects: [] as unknown[],
		tags: [] as unknown[],
		ensureTag: vi.fn()
	},
	inbox: { create: vi.fn() },
	tickets: { markRead: vi.fn(async () => undefined) }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/ticket-detail.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketDetailStore: () => mocks.detail
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => mocks.inbox
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));

const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};

const SAVED: CaptureSaveResult = {
	ok: true,
	target: 'ticket',
	id: 'tick00000000001',
	message: 'Ticket TASK-3 angelegt.'
};

function renderForm(props: Record<string, unknown> = {}) {
	const onsave = vi.fn(
		async (_capture: Capture, target: CaptureTarget): Promise<CaptureSaveResult> =>
			target === 'ticket'
				? SAVED
				: { ok: true, target, id: 'item00000000001', message: '„X“ liegt im Eingang.' }
	);
	const ontemplate = vi.fn();
	const onclose = vi.fn();
	const resultHref = (target: CaptureTarget, id: string) =>
		`/${target === 'ticket' ? 'tickets' : 'eingang'}/${id}` as ResolvedPathname;
	const result = render(CaptureForm, {
		props: { template: 'todo', onsave, ontemplate, onclose, resultHref, ...props }
	});
	return { onsave, ontemplate, onclose, ...result };
}

const field = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);
const submitButton = () =>
	screen.getByRole('button', { name: /^(Ticket anlegen|In den Eingang|Wird gespeichert …)$/ });

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/eingang/neu?vorlage=anruf');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('capture form', () => {
	it('offers the templates as radio group and reports a new choice', async () => {
		const { ontemplate } = renderForm();
		const group = screen.getByRole('group', { name: 'Vorlage' });
		const radios = within(group).getAllByRole<HTMLInputElement>('radio');
		expect(radios.map((radio) => radio.labels?.[0]?.textContent?.trim())).toEqual([
			'To-do',
			'Anruf',
			'Einkauf',
			'Termin',
			'Projektaufgabe'
		]);
		expect(radios[0]?.checked).toBe(true);
		await fireEvent.click(within(group).getByLabelText('Einkauf'));
		expect(ontemplate).toHaveBeenCalledWith('shopping');
	});

	it('shows the fields of a template, marks required ones and focuses the first', async () => {
		renderForm({ template: 'call' });
		await tick();
		const who = field(/^Wen\?/);
		expect(who.getAttribute('aria-required')).toBe('true');
		expect(who.labels?.[0]?.textContent).toMatch(/Pflichtfeld/);
		expect(document.activeElement).toBe(who);
		expect(field(/^Nummer/).type).toBe('tel');
		expect(field(/^Nummer/).getAttribute('aria-required')).toBeNull();
		expect(field(/^Anlass/)).toBeTruthy();
		expect(field(/^Fällig/).type).toBe('date');
		expect(screen.queryByLabelText(/^Was\?/)).toBeNull();
		expect(screen.getByText('Bekommt den Tag „Anruf“.')).toBeTruthy();
	});

	it('says that the date of an event does not become the due date (P-5)', () => {
		renderForm({ template: 'event' });
		const date = field(/^Datum/);
		const hint = document.getElementById(date.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent?.trim()).toBe('Der Termin wird nicht zur Fälligkeit des Tickets.');
		expect(field(/^Uhrzeit/).type).toBe('time');
		expect(screen.queryByLabelText(/^Fällig/)).toBeNull();
	});

	it('offers the active projects and the tag picker for a project task', () => {
		renderForm({ template: 'project_task', projects: [HOUSE] });
		const select = screen.getByLabelText<HTMLSelectElement>(/^Projekt\s*\(Pflichtfeld\)/);
		expect([...select.options].map((option) => option.text)).toEqual([
			'Projekt wählen',
			'Haushalt (HAUS)'
		]);
		expect(screen.getByRole('combobox', { name: 'Tags' })).toBeTruthy();
		expect(screen.getByLabelText(/^Priorität/)).toBeTruthy();
	});

	it('refuses missing required fields with field errors and focuses the first', async () => {
		const { onsave } = renderForm({ template: 'event' });
		await fireEvent.input(field(/^Uhrzeit/), { target: { value: '10:00' } });
		await fireEvent.click(submitButton());

		expect(onsave).not.toHaveBeenCalled();
		const what = field(/^Was\?/);
		expect(what.getAttribute('aria-invalid')).toBe('true');
		const error = document.getElementById(what.getAttribute('aria-describedby') ?? '');
		expect(error?.textContent).toBe('Pflichtfeld.');
		expect(error?.querySelector('svg')).not.toBeNull();
		expect(field(/^Datum/).getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(what);
	});

	it('creates a ticket by default, announces it with a link and empties the form', async () => {
		const { onsave } = renderForm();
		await fireEvent.input(field(/^Was\?/), { target: { value: 'Milch kaufen' } });
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'high' } });
		expect(submitButton().textContent?.trim()).toBe('Ticket anlegen');
		await fireEvent.click(submitButton());

		expect(onsave).toHaveBeenCalledOnce();
		const [capture, target] = onsave.mock.calls[0] ?? [];
		expect(target).toBe('ticket');
		expect(capture).toMatchObject({ title: 'Milch kaufen', priority: 'high', kind: 'todo' });
		const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(link.getAttribute('href')).toBe('/tickets/tick00000000001');
		expect(link.closest('[aria-live="polite"]')?.textContent).toMatch(/Ticket TASK-3 angelegt\./);
		expect(field(/^Was\?/).value).toBe('');
		expect(screen.getByLabelText<HTMLSelectElement>('Priorität').value).toBe('medium');
		expect(document.activeElement).toBe(field(/^Was\?/));
	});

	it('puts the entry into the inbox with the switch', async () => {
		const { onsave } = renderForm();
		await fireEvent.click(screen.getByLabelText('In den Eingang statt direkt als Ticket'));
		expect(submitButton().textContent?.trim()).toBe('In den Eingang');
		await fireEvent.input(field(/^Was\?/), { target: { value: 'Idee' } });
		await fireEvent.keyDown(field(/^Was\?/), { key: 'Enter', ctrlKey: true });

		expect(onsave.mock.calls[0]?.[1]).toBe('inbox');
		const link = await screen.findByRole('link', { name: 'Eintrag ansehen' });
		expect(link.getAttribute('href')).toBe('/eingang/item00000000001');
	});

	it('puts the entry into the inbox with Alt+Enter although the target is ticket', async () => {
		const { onsave } = renderForm();
		await fireEvent.input(field(/^Was\?/), { target: { value: 'Idee' } });
		await fireEvent.keyDown(field(/^Was\?/), { key: 'Enter', altKey: true });
		expect(onsave.mock.calls[0]?.[1]).toBe('inbox');
		expect(submitButton().textContent?.trim()).toBe('Ticket anlegen');
	});

	it('shows failures of the server per field and as message and keeps the input', async () => {
		const { onsave } = renderForm();
		onsave.mockResolvedValueOnce({
			ok: false,
			message: 'Der Server hat mit einem Fehler geantwortet.',
			fields: { due: 'Ungültiges Datum.' }
		});
		await fireEvent.input(field(/^Was\?/), { target: { value: 'A' } });
		await fireEvent.click(submitButton());

		const alert = await screen.findByText('Der Server hat mit einem Fehler geantwortet.');
		expect(alert.closest('.alert-error')).not.toBeNull();
		expect(field(/^Fällig/).getAttribute('aria-invalid')).toBe('true');
		expect(field(/^Was\?/).value).toBe('A');
	});

	it('locks saving while the request runs', async () => {
		let release!: (value: CaptureSaveResult) => void;
		const { onsave } = renderForm();
		onsave.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		await fireEvent.input(field(/^Was\?/), { target: { value: 'A' } });
		await fireEvent.click(submitButton());
		await fireEvent.click(submitButton());
		expect(onsave).toHaveBeenCalledOnce();
		expect(submitButton().getAttribute('aria-disabled')).toBe('true');
		release(SAVED);
		await vi.waitFor(() => expect(submitButton().getAttribute('aria-disabled')).toBeNull());
	});

	it('asks before closing with input and closes at once without', async () => {
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { onclose } = renderForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(confirm).not.toHaveBeenCalled();
		expect(onclose).toHaveBeenCalledOnce();

		await fireEvent.input(field(/^Was\?/), { target: { value: 'A' } });
		await fireEvent.keyDown(field(/^Was\?/), { key: 'Escape' });
		expect(confirm).toHaveBeenCalledOnce();
		expect(onclose).toHaveBeenCalledOnce();
	});
});

describe('capture route /eingang/neu', () => {
	const TICKET = { id: 'tick00000000002', key: 'TASK-4', created: '', status: 'open' } as Ticket;

	beforeEach(() => {
		mocks.detail.create.mockReset();
		mocks.detail.reset.mockReset();
		mocks.tickets.markRead.mockClear();
		mocks.catalog.ensureTag.mockReset();
		mocks.catalog.ensureTag.mockImplementation(async (name: string) => ({
			ok: true,
			tag: { id: 'tagcall00000001', name, updated: '' }
		}));
	});

	it('reads the template of the URL and keeps a new choice in it', async () => {
		render(CapturePage);
		expect(screen.getByLabelText<HTMLInputElement>('Anruf').checked).toBe(true);
		await fireEvent.click(screen.getByLabelText('Termin'));
		expect(mocks.goto).toHaveBeenCalledWith('/eingang/neu?vorlage=termin', {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	it('creates a manual ticket, marks it read and lets the panel store go', async () => {
		mocks.detail.create.mockResolvedValue({ ok: true, ticket: TICKET });
		render(CapturePage);
		await fireEvent.input(field(/^Wen\?/), { target: { value: 'Anna' } });
		await fireEvent.click(submitButton());

		await vi.waitFor(() => expect(mocks.tickets.markRead).toHaveBeenCalledWith(TICKET));
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Anrufen: Anna', tags: ['tagcall00000001'] }),
			{ source: 'manual' }
		);
		expect(mocks.detail.reset).toHaveBeenCalledOnce();
		const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(link.getAttribute('href')).toBe('/tickets/tick00000000002');
	});
});
