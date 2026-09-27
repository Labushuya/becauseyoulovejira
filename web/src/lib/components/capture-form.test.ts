// Component tests of the capture by template (E4 plan, package 5; OF-E4-1 (a), OF-E4-3): radio
// group of the templates, required fields with field errors (ADR-0009), target ticket or inbox
// (switch, Alt+Enter, Ctrl+Enter), result with link, emptied form, and the route /eingang/neu
// with the template in the URL. Since UI-3 the question before discarding is the confirmation of
// ADR-0025 section 4 instead of window.confirm.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project } from '$lib/domain/project';
import type { Capture, CaptureTarget } from '$lib/domain/templates';
import type { Ticket } from '$lib/domain/ticket';
import type { CaptureSaveResult } from '$lib/stores/capture';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import CaptureForm from './CaptureForm.svelte';
import CapturePage from '../../routes/(app)/eingang/neu/+page.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/eingang/neu?vorlage=anruf') },
	detail: { create: vi.fn(), reset: vi.fn() },
	catalog: {
		activeProjects: [] as unknown[],
		tags: [] as unknown[],
		ensureTag: vi.fn()
	},
	inbox: {
		create: vi.fn(),
		savePage: vi.fn(async () => ({ ok: true as const, truncated: false }))
	},
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
			'Projektaufgabe',
			'Web-Link'
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
		const { onclose } = renderForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(document.querySelector('dialog[open]')).toBeNull();
		expect(onclose).toHaveBeenCalledOnce();

		await fireEvent.input(field(/^Was\?/), { target: { value: 'A' } });
		await fireEvent.keyDown(field(/^Was\?/), { key: 'Escape' });
		await tick();
		const question = screen.getByRole<HTMLDialogElement>('dialog', {
			name: 'Erfassung verwerfen?'
		});
		expect(document.activeElement).toBe(
			within(question).getByRole('button', { name: 'Weiter bearbeiten' })
		);
		await fireEvent.click(within(question).getByRole('button', { name: 'Weiter bearbeiten' }));
		expect(question.open).toBe(false);
		expect(onclose).toHaveBeenCalledOnce();
		expect(field(/^Was\?/).value).toBe('A');

		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		await tick();
		await fireEvent.click(
			within(screen.getByRole('dialog', { name: 'Erfassung verwerfen?' })).getByRole('button', {
				name: 'Verwerfen'
			})
		);
		expect(onclose).toHaveBeenCalledTimes(2);
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

describe('capture form: web link and bookmarklet (E4 plan, package 7)', () => {
	it('always puts a web link into the inbox and offers no switch', async () => {
		const { onsave } = renderForm({
			template: 'link',
			initial: { url: 'https://example.com/a', what: 'Artikel', excerpt: 'Zitat' }
		});
		expect(screen.queryByLabelText('In den Eingang statt direkt als Ticket')).toBeNull();
		expect(screen.getByText('Web-Links kommen immer in den Eingang.')).toBeTruthy();
		expect(field(/^Adresse/).value).toBe('https://example.com/a');
		expect(field(/^Adresse/).type).toBe('url');
		expect(field(/^Titel/).value).toBe('Artikel');
		expect(screen.getByLabelText<HTMLTextAreaElement>(/^Auszug/).value).toBe('Zitat');
		expect(submitButton().textContent?.trim()).toBe('In den Eingang');
		await fireEvent.keyDown(field(/^Titel/), { key: 'Enter', ctrlKey: true });
		expect(onsave.mock.calls[0]?.[1]).toBe('inbox');
		expect(onsave.mock.calls[0]?.[0]).toMatchObject({ sourceUrl: 'https://example.com/a' });
	});

	it('saves the page of a web link after the entry, on by default (ADR-0031 section 6)', async () => {
		const onsavepage = vi.fn(async () => ({ ok: true as const, truncated: true }));
		const { onsave } = renderForm({
			template: 'link',
			initial: { url: 'https://example.com/a', what: 'Artikel' },
			onsavepage
		});
		const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Seiteninhalt sichern' });
		expect(box.checked).toBe(true);
		expect(box.getAttribute('aria-describedby')).toBeTruthy();
		await fireEvent.click(submitButton());
		await vi.waitFor(() => expect(onsavepage).toHaveBeenCalledWith('item00000000001', 'Artikel'));
		expect(onsave).toHaveBeenCalledOnce();
		const live = (await screen.findByRole('link', { name: 'Eintrag ansehen' })).closest(
			'[aria-live="polite"]'
		);
		expect(live?.textContent).toMatch(
			/„X“ liegt im Eingang\. Seiteninhalt gesichert \(auf 2 MB gekürzt\)\./
		);
	});

	it('keeps the entry and names why the page was not saved, or skips it when unchecked', async () => {
		const onsavepage = vi.fn(async () => ({
			ok: false as const,
			message: 'Nur HTML-Seiten lassen sich sichern.'
		}));
		renderForm({
			template: 'link',
			initial: { url: 'https://example.com/a.pdf', what: 'PDF' },
			onsavepage
		});
		await fireEvent.click(submitButton());
		expect(
			await screen.findByText(/Seiteninhalt nicht gesichert: Nur HTML-Seiten lassen sich sichern\./)
		).toBeTruthy();
		cleanup();

		const skipped = vi.fn();
		renderForm({
			template: 'link',
			initial: { url: 'https://example.com/b', what: 'Ohne' },
			onsavepage: skipped
		});
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Seiteninhalt sichern' }));
		await fireEvent.click(submitButton());
		await screen.findByRole('link', { name: 'Eintrag ansehen' });
		expect(skipped).not.toHaveBeenCalled();
		cleanup();

		renderForm({ template: 'todo', onsavepage: skipped });
		expect(screen.queryByRole('checkbox', { name: 'Seiteninhalt sichern' })).toBeNull();
	});

	it('refuses an address that is not http(s) with a field error', async () => {
		const { onsave } = renderForm({ template: 'link', initial: { url: 'javascript:alert(1)' } });
		await fireEvent.input(field(/^Titel/), { target: { value: 'X' } });
		await fireEvent.click(submitButton());
		expect(onsave).not.toHaveBeenCalled();
		expect(field(/^Adresse/).getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Nur http- und https-Adressen.')).toBeTruthy();
	});

	it('names a duplicate neutrally with a link to the existing entry and keeps the input', async () => {
		const { onsave } = renderForm({
			template: 'link',
			initial: { url: 'https://example.com/a', what: 'Artikel' }
		});
		onsave.mockResolvedValueOnce({
			ok: false,
			message: 'Schon Ticket HAUS-12.',
			fields: {},
			duplicate: { itemId: 'item00000000007', ticketId: 'tick00000000012' }
		});
		await fireEvent.click(submitButton());
		const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(link.getAttribute('href')).toBe('/tickets/tick00000000012');
		expect(link.closest('[aria-live="polite"]')?.textContent).toMatch(/Schon Ticket HAUS-12./);
		expect(document.querySelector('.alert-error')).toBeNull();
		expect(field(/^Adresse/).value).toBe('https://example.com/a');
	});

	it('shows a neutral hint', () => {
		renderForm({ template: 'link', hint: 'Die Adresse wurde nicht übernommen.' });
		const note = screen.getByRole('note');
		expect(note.textContent).toBe('Die Adresse wurde nicht übernommen.');
		expect(note.closest('.alert-error')).toBeNull();
	});
});

describe('capture route with the parameters of the bookmarklet', () => {
	beforeEach(() => {
		mocks.inbox.create.mockReset();
		mocks.detail.create.mockReset();
	});

	it('fills a web link from url, titel and auswahl and saves nothing before the click', async () => {
		mocks.page.url = new URL(
			'http://localhost:3000/eingang/neu?url=https%3A%2F%2Fexample.com%2Fa&titel=Artikel&auswahl=Zitat'
		);
		mocks.inbox.create.mockResolvedValue({
			kind: 'created',
			item: { id: 'item00000000001', title: 'Artikel' }
		});
		render(CapturePage);
		await tick();
		expect(screen.getByLabelText<HTMLInputElement>('Web-Link').checked).toBe(true);
		expect(field(/^Adresse/).value).toBe('https://example.com/a');
		expect(mocks.inbox.create).not.toHaveBeenCalled();
		expect(mocks.detail.create).not.toHaveBeenCalled();

		await fireEvent.click(submitButton());
		await vi.waitFor(() =>
			expect(mocks.inbox.create).toHaveBeenCalledWith({
				channel: 'link',
				kind: 'link',
				title: 'Artikel',
				body: '> Zitat',
				sourceUrl: 'https://example.com/a',
				sourceDate: null,
				sourceMeta: { template: 'weblink' }
			})
		);
		expect(mocks.detail.create).not.toHaveBeenCalled();
		// "Seiteninhalt sichern" is on by default and goes to the inbox store (ADR-0031 section 6).
		await vi.waitFor(() =>
			expect(mocks.inbox.savePage).toHaveBeenCalledWith({ id: 'item00000000001', title: 'Artikel' })
		);
	});

	it('explains a refused address of the page', () => {
		mocks.page.url = new URL(
			'http://localhost:3000/eingang/neu?url=javascript%3Aalert(1)&titel=Böse'
		);
		render(CapturePage);
		expect(screen.getByRole('note').textContent).toBe(
			'Die Adresse der Seite ist kein http- oder https-Link und wurde nicht übernommen.'
		);
		expect(field(/^Adresse/).value).toBe('');
		expect(field(/^Titel/).value).toBe('Böse');
	});

	it('lets a template chosen later win over the bookmarklet', () => {
		mocks.page.url = new URL(
			'http://localhost:3000/eingang/neu?url=https%3A%2F%2Fa.de&vorlage=anruf'
		);
		render(CapturePage);
		expect(screen.getByLabelText<HTMLInputElement>('Anruf').checked).toBe(true);
	});
});
