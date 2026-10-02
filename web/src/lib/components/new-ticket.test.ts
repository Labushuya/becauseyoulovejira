// Component tests for "Neues Ticket" (E2 plan, package 8; E3 plan, T-13 and T-14): required
// title, defaults, project with the filtered project chosen in advance, tags, Ctrl+Enter, lock
// during the request, switching to the new ID with replaceState, server errors, discarding after a question.
// The creation itself is covered against the harness (E2 plan, package 4). Since UI-3 the question
// is the confirmation of ADR-0025 section 4 instead of window.confirm.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/inbox';
import type { Project } from '$lib/domain/project';
import type { Ticket, TicketDraft } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
import type { Editor } from '@tiptap/core';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import NewTicketForm from './NewTicketForm.svelte';
import NewTicketPage from '../../routes/(app)/(tickets)/tickets/neu/+page.svelte';

useOverlayStubs();
useProseMirrorStubs();

/** The open question "Neues Ticket verwerfen?", or null. */
async function discardQuestion(): Promise<HTMLDialogElement | null> {
	await tick();
	return screen.queryByRole<HTMLDialogElement>('dialog', { name: 'Neues Ticket verwerfen?' });
}

/** Answers the open question with "Weiter bearbeiten" or "Verwerfen". */
async function answer(choice: 'Weiter bearbeiten' | 'Verwerfen') {
	const dialog = await discardQuestion();
	if (dialog === null) throw new Error('No question open');
	await fireEvent.click(within(dialog).getByRole('button', { name: choice }));
}

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/tickets/neu?erledigte=1') },
	detail: { create: vi.fn(), upsert: vi.fn() },
	catalog: null as unknown,
	inbox: { fetch: vi.fn(), markConverted: vi.fn() },
	tickets: {
		today: '2026-09-25',
		announce: vi.fn(),
		markRead: vi.fn(async () => undefined),
		upsert: vi.fn()
	},
	rules: { state: 'ready', statusReady: false, subtasksReady: false, repeatCreated: vi.fn() }
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
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRecurrenceStore: () => mocks.rules
}));

const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const CAR: Project = { ...HOUSE, id: 'proj00000000002', name: 'Auto', code: 'AUTO' };
const OLD: Project = {
	...HOUSE,
	id: 'proj00000000003',
	name: 'Altbau',
	code: 'ALT',
	archived: true
};

/** Catalog of the route tests; `load` resolves when the test says so. */
function catalog(projects: Project[] = [HOUSE, CAR, OLD]) {
	let release!: () => void;
	const ready = new Promise<void>((resolve) => (release = resolve));
	const store = new CatalogStore(
		{
			listProjects: vi.fn(async () => {
				await ready;
				return projects;
			}),
			listTags: vi.fn(async () => []),
			createTag: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	void store.load();
	mocks.catalog = store;
	return { store, release };
}

const CREATED: Ticket = {
	id: 'new000000000000',
	key: 'TASK-9',
	title: 'Neu',
	description: '',
	sourceItem: null,
	status: 'open',
	priority: 'medium',
	due: null,
	projectId: null,
	tagIds: [],
	project: null,
	tags: [],
	recurring: false,
	source: null,
	completedAt: null,
	created: '2026-09-24 10:00:00.000Z',
	updated: '2026-09-24 10:00:00.000Z'
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function renderForm(
	create: (draft: TicketDraft) => Promise<CreateResult> = async () => ({
		ok: true,
		ticket: CREATED
	}),
	props: Record<string, unknown> = {}
) {
	const oncreate = vi.fn(create);
	const oncreated = vi.fn();
	const oncancel = vi.fn();
	render(NewTicketForm, { props: { oncreate, oncreated, oncancel, ...props } });
	return { oncreate, oncreated, oncancel };
}

function titleField() {
	return screen.getByLabelText<HTMLInputElement>('Titel');
}

function createButton() {
	return screen.getByRole('button', { name: /^(Anlegen|Wird angelegt …)$/ });
}

/** The editor of the description (RT-6) once it has loaded. */
function descriptionEditor(): Promise<HTMLElement> {
	return screen.findByRole('textbox', { name: 'Beschreibung' }, { timeout: 5000 });
}

/** The description as Markdown: the editor loads, then "Markdown" switches to the textarea. */
async function descriptionSource(): Promise<HTMLTextAreaElement> {
	await descriptionEditor();
	await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
	return screen.findByLabelText<HTMLTextAreaElement>('Beschreibung (Markdown)');
}

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.page.url = new URL('http://localhost:3000/tickets/neu?erledigte=1');
	catalog().release();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('new ticket form', () => {
	it('focuses the required title and starts with the defaults', async () => {
		renderForm();
		await tick();

		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Neues Ticket');
		expect(document.activeElement).toBe(titleField());
		expect(titleField().required).toBe(true);
		expect(titleField().maxLength).toBe(200);
		expect(screen.getByLabelText<HTMLSelectElement>('Status').value).toBe('open');
		expect(screen.getByLabelText<HTMLSelectElement>('Priorität').value).toBe('medium');
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('');
		const description = await descriptionEditor();
		expect(description.textContent).toBe('');
		expect(description.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')).toBe(
			'Beschreibung eingeben …'
		);
		expect(document.activeElement).toBe(titleField());
	});

	it('locks "Anlegen" without a title and explains why', async () => {
		const { oncreate } = renderForm();

		expect(createButton().getAttribute('aria-disabled')).toBe('true');
		const hint = document.getElementById(createButton().getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe('Zum Anlegen fehlt noch ein Titel.');
		await fireEvent.click(createButton());
		await fireEvent.input(titleField(), { target: { value: '   ' } });
		await fireEvent.click(createButton());

		expect(oncreate).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(titleField());
	});

	it('creates with all fields and switches to the new ticket', async () => {
		const { oncreate, oncreated } = renderForm();

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		expect(createButton().getAttribute('aria-disabled')).toBeNull();
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } });
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'urgent' } });
		await fireEvent.input(screen.getByLabelText('Fälligkeit'), { target: { value: '2026-10-01' } });
		await fireEvent.input(await descriptionSource(), { target: { value: '*Text*' } });
		await fireEvent.click(createButton());

		expect(oncreate).toHaveBeenCalledExactlyOnceWith(
			{
				title: 'Neu',
				description: '*Text*',
				status: 'in_progress',
				priority: 'urgent',
				due: '2026-10-01',
				project: null,
				tags: []
			},
			// No calendar series, so no section "Wiederholung" (package 6).
			null
		);
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledWith('new000000000000'));
	});

	it('creates with Ctrl+Enter from any field', async () => {
		const { oncreate } = renderForm();

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		const description = await descriptionEditor();
		const editor = (description as HTMLElement & { editor: Editor }).editor;
		editor.commands.focus('end');
		typeText(editor.view, '**Wichtig**');
		// In the editor Ctrl+Enter writes the text and goes on to the form (no line break).
		await fireEvent.keyDown(description, { key: 'Enter', ctrlKey: true });

		expect(oncreate).toHaveBeenCalledOnce();
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({
			title: 'Neu',
			status: 'open',
			due: null,
			description: '**Wichtig**'
		});
	});

	it('creates only once during a running request', async () => {
		const answer = deferred<CreateResult>();
		const { oncreate, oncreated } = renderForm(() => answer.promise);

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		await fireEvent.click(createButton());
		await fireEvent.keyDown(titleField(), { key: 'Enter', ctrlKey: true });

		expect(oncreate).toHaveBeenCalledOnce();
		expect(createButton().textContent?.trim()).toBe('Wird angelegt …');
		expect(createButton().getAttribute('aria-disabled')).toBe('true');
		answer.resolve({ ok: true, ticket: CREATED });
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledOnce());
	});

	it('shows a server error as an error message and unlocks again', async () => {
		renderForm(async () => ({
			ok: false,
			message: 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.',
			fields: {}
		}));

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());

		const message = await screen.findByText(/Der Server hat mit einem Fehler geantwortet/);
		const alert = message.closest('.alert-error');
		expect(alert?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(createButton().getAttribute('aria-disabled')).toBeNull();
	});

	it('shows field errors of the server at the field', async () => {
		renderForm(async () => ({ ok: false, message: null, fields: { title: 'Zu lang.' } }));

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(titleField().getAttribute('aria-invalid')).toBe('true'));
		const error = document.getElementById(titleField().getAttribute('aria-describedby') ?? '');
		expect(error?.textContent).toBe('Zu lang.');
	});

	it('cancels at once when nothing was entered', async () => {
		const { oncancel } = renderForm();

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(await discardQuestion()).toBeNull();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('asks before discarding entered data, with "Abbrechen" and with Escape', async () => {
		const { oncancel } = renderForm();

		await fireEvent.input(titleField(), { target: { value: 'Entwurf' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		const question = await discardQuestion();
		const text = document.getElementById(question?.getAttribute('aria-describedby') ?? '');
		expect(text?.textContent?.trim()).toBe('Die Eingaben gehen verloren.');
		expect(document.activeElement?.textContent?.trim()).toBe('Weiter bearbeiten');
		await answer('Weiter bearbeiten');
		expect(oncancel).not.toHaveBeenCalled();
		expect(titleField().value).toBe('Entwurf');

		await fireEvent.keyDown(titleField(), { key: 'Escape' });
		await answer('Verwerfen');
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('does not create with Ctrl+Enter while the question is open', async () => {
		const { oncancel, oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Entwurf' } });
		await fireEvent.keyDown(titleField(), { key: 'Escape' });
		const question = await discardQuestion();

		await fireEvent.keyDown(titleField(), { key: 'Enter', ctrlKey: true });

		expect(oncreate).not.toHaveBeenCalled();
		expect(question?.open).toBe(true);
		expect(oncancel).not.toHaveBeenCalled();
	});
});

describe('new ticket route', () => {
	it('switches to the new ticket with replaceState and keeps the query', async () => {
		mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
		render(NewTicketPage);

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000?erledigte=1', {
				replaceState: true
			})
		);
		expect(mocks.detail.create).toHaveBeenCalledOnce();
		// A ticket created one by one is read at once (E4 plan, package 4).
		expect(mocks.tickets.markRead).toHaveBeenCalledWith(CREATED);
	});

	it('goes back to the list on "Abbrechen"', async () => {
		render(NewTicketPage);

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(mocks.goto).toHaveBeenCalledWith('/?erledigte=1');
	});
});

describe('new ticket: project (E3 plan, T-13)', () => {
	function projectField() {
		return screen.getByLabelText<HTMLSelectElement>('Projekt');
	}

	it('offers the active projects only and creates with the chosen one', async () => {
		const { oncreate } = renderForm(undefined, { projects: [CAR, HOUSE] });

		expect([...projectField().options].map((option) => option.textContent?.trim())).toEqual([
			'Kein Projekt',
			'Auto (AUTO)',
			'Haushalt (HAUS)'
		]);
		expect(projectField().value).toBe('');
		expect(screen.getByText('Beim Wechsel bekommt das Ticket einen neuen Key.')).toBeTruthy();
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.change(projectField(), { target: { value: HOUSE.id } });
		await fireEvent.click(createButton());

		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Neu', project: HOUSE.id });
	});

	it('shows a server error at the project field', async () => {
		renderForm(
			async () => ({
				ok: false,
				message: null,
				fields: { project: 'Das Projekt ist archiviert.' }
			}),
			{ projects: [HOUSE] }
		);

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.change(projectField(), { target: { value: HOUSE.id } });
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(projectField().getAttribute('aria-invalid')).toBe('true'));
		const describedBy = projectField().getAttribute('aria-describedby') ?? '';
		const texts = describedBy.split(' ').map((id) => document.getElementById(id)?.textContent);
		expect(texts).toContain('Das Projekt ist archiviert.');
	});

	it('asks before discarding a chosen project', async () => {
		const { oncancel } = renderForm(undefined, { projects: [HOUSE] });

		await fireEvent.change(projectField(), { target: { value: HOUSE.id } });
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(await discardQuestion()).not.toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('chooses the filtered active project in advance, also when the catalog arrives later', async () => {
		const { release } = catalog();
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?projekt=${HOUSE.id}`);
		mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
		render(NewTicketPage);
		expect(projectField().value).toBe('');

		release();
		await vi.waitFor(() => expect(projectField().value).toBe(HOUSE.id));
		expect([...projectField().options].map((option) => option.value)).not.toContain(OLD.id);
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());

		expect(mocks.detail.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ project: HOUSE.id }),
			undefined
		);
	});

	it.each([
		['an archived project', `?projekt=${OLD.id}`],
		['"ohne"', '?projekt=ohne'],
		['no filter', '']
	])('chooses no project in advance for %s', async (_name, query) => {
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu${query}`);
		render(NewTicketPage);
		await vi.waitFor(() => expect(projectField().options.length).toBe(3));

		expect(projectField().value).toBe('');
	});

	it('does not ask before leaving when only the project filled in advance is set', async () => {
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?projekt=${HOUSE.id}`);
		render(NewTicketPage);
		await vi.waitFor(() => expect(projectField().value).toBe(HOUSE.id));

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(await discardQuestion()).toBeNull();
		expect(mocks.goto).toHaveBeenCalledWith(`/?projekt=${HOUSE.id}`);
	});
});

describe('new ticket: tags (E3 plan, T-14)', () => {
	const GARDEN = { id: 'tag000000000001', name: 'Garten' };
	const CALL = { id: 'tag000000000002', name: 'anrufen' };

	function tagInput() {
		return screen.getByRole<HTMLInputElement>('combobox', { name: 'Tags' });
	}

	function chips() {
		const list = screen.queryByRole('list', { name: 'Gewählte Tags' });
		return list
			? within(list)
					.getAllByRole('listitem')
					.map((chip) => chip.textContent?.trim())
			: [];
	}

	it('creates with existing and new tags; Enter in the tag input does not submit', async () => {
		const created = { id: 'tag000000000009', name: 'Steuer', updated: '2026-09-24 10:00:00.000Z' };
		const tags = [CALL, GARDEN];
		const oncreatetag = vi.fn(async () => ({ ok: true as const, tag: created }));
		const { oncreate, rerender } = renderFormWithTags({ tags, oncreatetag });

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.input(tagInput(), { target: { value: 'gar' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });
		await tick();
		await fireEvent.input(tagInput(), { target: { value: 'Steuer' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });
		await vi.waitFor(() => expect(oncreatetag).toHaveBeenCalledExactlyOnceWith('Steuer'));
		// The catalog now has the new tag.
		await rerender({ tags: [...tags, created] });

		expect(oncreate).not.toHaveBeenCalled();
		expect(chips()).toEqual(['Garten', 'Steuer']);
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ tags: [GARDEN.id, created.id] });
	});

	it('shows a failure to create a tag at the field', async () => {
		const oncreatetag = vi.fn(async () => ({ ok: false as const, message: 'Schon vergeben.' }));
		renderFormWithTags({ tags: [], oncreatetag });

		await fireEvent.input(tagInput(), { target: { value: 'Steuer' } });
		await fireEvent.keyDown(tagInput(), { key: 'Enter' });

		await vi.waitFor(() => expect(tagInput().getAttribute('aria-invalid')).toBe('true'));
		// After the keys of the field (comma, Enter, Backspace) the error is named last.
		const ids = tagInput().getAttribute('aria-describedby')?.split(' ') ?? [];
		const error = document.getElementById(ids.at(-1) ?? '');
		expect(error?.textContent).toBe('Schon vergeben.');
		expect(tagInput().value).toBe('Steuer');
	});

	it('takes a pasted list of tags and a comma-separated name in the form', async () => {
		const created = { id: 'tag000000000009', name: 'Steuer', updated: '2026-09-24 10:00:00.000Z' };
		const oncreatetag = vi.fn(async () => ({ ok: true as const, tag: created }));
		const { rerender } = renderFormWithTags({ tags: [CALL, GARDEN], oncreatetag });

		await fireEvent.paste(tagInput(), { clipboardData: { getData: () => 'GARTEN, Steuer' } });
		await vi.waitFor(() => expect(oncreatetag).toHaveBeenCalledExactlyOnceWith('Steuer'));
		await rerender({ tags: [CALL, GARDEN, created] });
		// The picker takes no action while it saves (aria-busy).
		await vi.waitFor(() => expect(tagInput().hasAttribute('aria-busy')).toBe(false));
		await fireEvent.input(tagInput(), { target: { value: 'anrufen' } });
		await fireEvent.keyDown(tagInput(), { key: ',' });

		await vi.waitFor(() => expect(chips()).toEqual(['Garten', 'Steuer', 'anrufen']));
		expect(tagInput().value).toBe('');
	});

	it.each([
		['a chosen tag', async () => fireEvent.keyDown(tagInput(), { key: 'Enter' })],
		['a typed name', async () => undefined]
	])('asks before discarding %s', async (_name, finish) => {
		const { oncancel } = renderFormWithTags({ tags: [GARDEN] });

		await fireEvent.input(tagInput(), { target: { value: 'gar' } });
		await finish();
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(await discardQuestion()).not.toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
	});

	function renderFormWithTags(props: Record<string, unknown>) {
		const oncreate = vi.fn<(draft: TicketDraft) => Promise<CreateResult>>(async () => ({
			ok: true,
			ticket: CREATED
		}));
		const oncancel = vi.fn();
		const result = render(NewTicketForm, {
			props: { oncreate, oncreated: vi.fn(), oncancel, ...props }
		});
		return { ...result, oncreate, oncancel };
	}
});

describe('new ticket from the inbox (E4 plan, package 3)', () => {
	const ITEM_ID = 'item00000000001';

	function entry(overrides: Partial<InboxItem> = {}): InboxItem {
		return {
			id: ITEM_ID,
			channel: 'eml',
			kind: 'mail',
			title: 'Rechnung September',
			body: 'Bitte bis Monatsende zahlen.',
			sourceUrl: '',
			sourceRef: '<a@b>',
			// 23:30 UTC is already the next day in Berlin.
			sourceDate: '2026-09-24 23:30:00.000Z',
			sourceMeta: { from: 'Shop <shop@example.com>' },
			original: '',
			state: 'new',
			ticketId: null,
			handledAt: null,
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 08:00:00.000Z',
			...overrides
		};
	}

	function openFor(item: InboxItem) {
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?aus=${ITEM_ID}`);
		mocks.inbox.fetch.mockReset();
		mocks.inbox.fetch.mockResolvedValue(item);
		mocks.inbox.markConverted.mockReset();
		mocks.tickets.announce.mockReset();
		mocks.detail.create.mockReset();
		render(NewTicketPage);
	}

	it('fills title and description from the entry, with the header of the mail', async () => {
		openFor(entry());
		await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
		// The prefill opens in the editor; its Markdown stays as the template wrote it.
		const editor = await descriptionEditor();
		expect(editor.querySelector('strong')?.textContent).toBe('Von:');
		const description = await descriptionSource();
		expect(description.value).toBe(
			'- **Von:** Shop \\<shop@example\\.com\\>\n- **Datum:** 25.09.2026 01:30\n\nBitte bis Monatsende zahlen.'
		);
		expect(screen.getByText('Aus dem Eingang (Mail-Datei)')).toBeTruthy();
		expect(screen.getByLabelText<HTMLInputElement>('Priorität')).toBeTruthy();
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('');
		expect(screen.getByText(/Quelldatum: 25\.09\.2026 01:30/)).toBeTruthy();
	});

	it('takes project, tags, priority and due date chosen when the entry was typed in', async () => {
		const { store, release } = catalog();
		release();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		store.upsertTag({ id: 'tagcall00000001', name: 'Anruf', updated: '2026-09-01 10:00:00.000Z' });
		openFor(
			entry({
				channel: 'manual',
				kind: 'task',
				title: 'Anrufen: Anna',
				body: '',
				sourceDate: null,
				sourceMeta: {
					template: 'anruf',
					preset: {
						project: HOUSE.id,
						tags: ['tagcall00000001', 'gonetag00000001'],
						priority: 'high',
						due: '2026-10-02'
					}
				}
			})
		);
		mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
		await vi.waitFor(() => expect(titleField().value).toBe('Anrufen: Anna'));
		expect(screen.getByLabelText<HTMLSelectElement>('Priorität').value).toBe('high');
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('2026-10-02');
		expect(screen.getByText('Aus dem Eingang (Formular)')).toBeTruthy();
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.detail.create).toHaveBeenCalledOnce());
		// A tag deleted since is left out; the project must be active.
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				priority: 'high',
				due: '2026-10-02',
				project: HOUSE.id,
				tags: ['tagcall00000001']
			}),
			{ sourceItem: ITEM_ID }
		);
	});

	it('never takes the date at the sender as due date by itself (P-5)', async () => {
		openFor(entry());
		mocks.detail.create.mockResolvedValueOnce({
			ok: true,
			ticket: { ...CREATED, key: 'HAUS-4', source: 'eml', sourceItem: ITEM_ID }
		});
		await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.detail.create).toHaveBeenCalledOnce());
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Rechnung September',
				due: null,
				status: 'open',
				priority: 'medium'
			}),
			{ sourceItem: ITEM_ID }
		);
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
		expect(mocks.inbox.markConverted).toHaveBeenCalledWith(ITEM_ID, CREATED.id, CREATED.created);
		expect(mocks.tickets.announce).toHaveBeenCalledWith('Ticket HAUS-4 angelegt.');
	});

	it('chooses the target project of the entry in advance, and the user can change it (ADR-0049)', async () => {
		const { store, release } = catalog();
		release();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		openFor(entry({ targetProjectId: HOUSE.id }));
		mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
		await vi.waitFor(() =>
			expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe(HOUSE.id)
		);
		expect(
			screen.getByText(
				'Vorbelegt mit dem Zielprojekt „Haushalt (HAUS)“ des Eingangswegs; du kannst es ändern.'
			)
		).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: CAR.id } });
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(mocks.detail.create).toHaveBeenCalledWith(
				expect.objectContaining({ project: CAR.id }),
				{ sourceItem: ITEM_ID }
			)
		);
	});

	it('chooses no archived or deleted target project and says why (ADR-0049)', async () => {
		const { store, release } = catalog();
		release();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		openFor(entry({ targetProjectId: OLD.id }));
		await vi.waitFor(() =>
			expect(
				screen.getByText('Das Zielprojekt „Altbau (ALT)“ ist archiviert und wird nicht vorbelegt.')
			).toBeTruthy()
		);
		expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe('');
		cleanup();

		openFor(entry({ targetProjectId: null, sourceMeta: { target_gone: true } }));
		await vi.waitFor(() =>
			expect(
				screen.getByText('Das Zielprojekt dieses Eintrags wurde gelöscht und wird nicht vorbelegt.')
			).toBeTruthy()
		);
		expect(screen.getByLabelText<HTMLSelectElement>('Projekt').value).toBe('');
	});

	it('takes the Berlin date of the source as due date on "Als Fälligkeit übernehmen"', async () => {
		openFor(entry());
		mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
		const take = await screen.findByRole('button', { name: 'Als Fälligkeit übernehmen' });
		await fireEvent.click(take);
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('2026-09-25');
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(mocks.detail.create).toHaveBeenCalledWith(
				expect.objectContaining({ due: '2026-09-25' }),
				{ sourceItem: ITEM_ID }
			)
		);
	});

	it('shows no source date hint without a date and fills other kinds by their header', async () => {
		openFor(
			entry({
				kind: 'link',
				channel: 'link',
				sourceUrl: 'https://example.com/artikel',
				sourceDate: null,
				sourceMeta: {},
				body: ''
			})
		);
		await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
		expect((await descriptionSource()).value).toBe('- **Link:** <https://example.com/artikel>');
		expect(screen.queryByRole('button', { name: 'Als Fälligkeit übernehmen' })).toBeNull();
	});

	it('returns to the entry on "Abbrechen" without asking for the untouched prefill', async () => {
		openFor(entry());
		await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).toBeNull();
		expect(mocks.goto).toHaveBeenCalledWith(`/eingang/${ITEM_ID}`);
	});

	it('refuses an entry that was handled already', async () => {
		openFor(entry({ state: 'converted', ticketId: 'tick00000000001' }));
		expect(await screen.findByText('Dieser Eintrag wurde schon bearbeitet.')).toBeTruthy();
		expect(screen.queryByLabelText('Titel')).toBeNull();
		expect(screen.getByRole('link', { name: 'Zum Eintrag im Eingang' }).getAttribute('href')).toBe(
			`/eingang/${ITEM_ID}`
		);
	});
});

describe('new ticket from a calendar series (E5 plan, package 6; ADR-0024 section 1)', () => {
	const ITEM_ID = 'item00000000002';
	const RULE = { id: 'rule00000000009' };

	/** An event of Monday, 5 October 2026, 18:30 in Berlin. */
	function event(sourceMeta: Record<string, unknown>): InboxItem {
		return {
			id: ITEM_ID,
			channel: 'ics',
			kind: 'event',
			title: 'Chorprobe',
			body: '',
			sourceUrl: '',
			sourceRef: 'uid-1@example.com',
			sourceDate: '2026-10-05 16:30:00.000Z',
			sourceMeta,
			original: '',
			state: 'new',
			ticketId: null,
			handledAt: null,
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 08:00:00.000Z'
		};
	}

	function openFor(item: InboxItem, state = 'ready', statusReady = false) {
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?aus=${ITEM_ID}`);
		mocks.inbox.fetch.mockReset();
		mocks.inbox.fetch.mockResolvedValue(item);
		mocks.detail.create.mockReset();
		mocks.detail.create.mockResolvedValue({ ok: true, ticket: CREATED });
		mocks.detail.upsert.mockReset();
		mocks.tickets.upsert.mockReset();
		mocks.rules.state = state;
		mocks.rules.statusReady = statusReady;
		mocks.rules.repeatCreated.mockReset();
		mocks.rules.repeatCreated.mockResolvedValue(RULE);
		render(NewTicketPage);
	}

	const takeOver = () => screen.findByRole('button', { name: 'Als Wiederholung übernehmen' });
	const disclosure = () => screen.getByRole('button', { name: 'Wiederholen' });

	it('shows the rhythm and creates no rule and no due date without the click (P-5)', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }));
		expect(await takeOver()).toBeTruthy();
		expect(screen.getByText(/Dieser Termin wiederholt sich: jeden Montag\./)).toBeTruthy();
		expect(disclosure().getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByLabelText('Beginnt am')).toBeNull();
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalled());
		expect(mocks.detail.create).toHaveBeenCalledWith(expect.objectContaining({ due: null }), {
			sourceItem: ITEM_ID
		});
		expect(mocks.rules.repeatCreated).not.toHaveBeenCalled();
	});

	it('opens the section with the suggested values, folds it again and creates both', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }));
		await fireEvent.click(await takeOver());
		const section = screen.getByRole('region', { name: 'Wiederholen' });
		await vi.waitFor(() => expect(document.activeElement).toBe(disclosure()));
		expect(disclosure().getAttribute('aria-expanded')).toBe('true');
		expect(
			within(section).getByRole<HTMLInputElement>('checkbox', { name: 'Montag' }).checked
		).toBe(true);
		expect(within(section).getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-10-05');
		// No due date yet: the section names the first date the ticket gets.
		expect(within(section).getByText(/bekommt den ersten Termin: 05\.10\.2026/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Als Wiederholung übernehmen' })).toBeNull();

		// Folding creates no rule; the button of the suggestion comes back.
		await fireEvent.click(disclosure());
		expect(disclosure().getAttribute('aria-expanded')).toBe('false');
		expect(within(section).queryByLabelText('Beginnt am')).toBeNull();
		expect(await takeOver()).toBeTruthy();

		await fireEvent.click(await takeOver());
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		expect(mocks.detail.create).toHaveBeenCalledOnce();
		// Before the migration of "Status beim Anlegen" nothing is asked (ADR-0022 addendum 9).
		expect(mocks.rules.repeatCreated).toHaveBeenCalledWith(CREATED, {
			values: expect.objectContaining({
				mode: 'calendar',
				freq: 'weekly',
				weekdays: ['MO'],
				anchor: '2026-10-05'
			}),
			initialStatus: null
		});
		// Panel and list show the ticket in its series at once, with the first date as due date.
		const joined = { ...CREATED, recurring: true, recurrenceId: RULE.id, due: '2026-10-05' };
		expect(mocks.detail.upsert).toHaveBeenCalledWith(joined);
		expect(mocks.tickets.upsert).toHaveBeenCalledWith(joined);
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
	});

	it('keeps the ticket when the rule fails and still opens it', async () => {
		openFor(event({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31' }));
		mocks.rules.repeatCreated.mockResolvedValueOnce(null);
		expect(await screen.findByText(/In kürzeren Monaten am letzten Tag\./)).toBeTruthy();
		await fireEvent.click(await takeOver());
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
		expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce();
		expect(mocks.detail.upsert).not.toHaveBeenCalled();
	});

	it('checks the section before creating anything', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }));
		await fireEvent.click(await takeOver());
		const section = screen.getByRole('region', { name: 'Wiederholen' });
		await fireEvent.click(within(section).getByRole('checkbox', { name: 'Montag' }));
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(section).getByRole('checkbox', { name: 'Montag' }))
		);
		expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
		expect(within(section).getByText('Bitte mindestens einen Wochentag wählen.')).toBeTruthy();
		expect(mocks.detail.create).not.toHaveBeenCalled();
	});

	it('asks "Folgetickets starten mit" before a series becomes a rule (ADR-0022 addendum 9)', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }), 'ready', true);
		await fireEvent.click(await takeOver());
		const section = screen.getByRole('region', { name: 'Wiederholen' });
		const group = within(section).getByRole('radiogroup', { name: 'Folgetickets starten mit' });
		expect(
			within(group)
				.getAllByRole<HTMLInputElement>('radio')
				.some((radio) => radio.checked)
		).toBe(false);
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(group));
		expect(
			within(group).getByText('Bitte wählen, mit welchem Status Folgetickets starten.')
		).toBeTruthy();
		expect(mocks.detail.create).not.toHaveBeenCalled();

		await fireEvent.click(within(group).getByRole('radio', { name: 'Backlog' }));
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		expect(mocks.rules.repeatCreated).toHaveBeenCalledWith(CREATED, {
			values: expect.objectContaining({ weekdays: ['MO'] }),
			initialStatus: 'backlog'
		});
	});

	it('explains neutrally why a series cannot become a rule, without a button', async () => {
		openFor(event({ rrule: 'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20271231T000000Z' }));
		const hint = await screen.findByText(/Diese Serie lässt sich nicht als Regel übernehmen/);
		expect(hint.textContent).toContain('die Serie hat ein Ende');
		expect(hint.textContent).toContain('„jeden 2. Montag“');
		expect(hint.closest('[data-tone]')?.getAttribute('data-tone')).toBe('info');
		expect(screen.queryByRole('button', { name: 'Als Wiederholung übernehmen' })).toBeNull();
	});

	it('shows nothing for a single changed occurrence or before the E5 migration', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO', recurrence_id: '20261005T183000' }));
		await vi.waitFor(() => expect(titleField().value).toBe('Chorprobe'));
		expect(screen.queryByText(/wiederholt sich/)).toBeNull();
		cleanup();

		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }), 'unavailable');
		await vi.waitFor(() => expect(titleField().value).toBe('Chorprobe'));
		expect(screen.queryByText(/wiederholt sich/)).toBeNull();
		// Before the migration there is no section "Wiederholen" either.
		expect(screen.queryByRole('button', { name: 'Wiederholen' })).toBeNull();
	});
});

// "Neues Ticket" with the section "Wiederholen" (plan OR-4): folded by default, opened with the
// defaults of the due date or of today and the preview; only an open section creates the rule,
// after the ticket (the two steps of ADR-0024); a failed rule keeps the ticket.
describe('new ticket: repeat right away (plan OR-4)', () => {
	const RULE = { id: 'rule00000000010' };

	async function openPlain(state = 'ready', statusReady = false, subtasksReady = false) {
		mocks.page.url = new URL('http://localhost:3000/tickets/neu');
		mocks.detail.create.mockReset();
		mocks.detail.create.mockResolvedValue({ ok: true, ticket: CREATED });
		mocks.detail.upsert.mockReset();
		mocks.tickets.upsert.mockReset();
		mocks.goto.mockClear();
		mocks.rules.state = state;
		mocks.rules.statusReady = statusReady;
		mocks.rules.subtasksReady = subtasksReady;
		mocks.rules.repeatCreated.mockReset();
		mocks.rules.repeatCreated.mockResolvedValue(RULE);
		const { release } = catalog();
		release();
		render(NewTicketPage);
		await vi.waitFor(() => expect(screen.getByLabelText('Titel')).toBeTruthy());
	}

	const disclosure = () => screen.getByRole('button', { name: 'Wiederholen' });
	const section = () => screen.getByRole('region', { name: 'Wiederholen' });

	it('offers the folded section and creates no rule without opening it', async () => {
		await openPlain();
		expect(disclosure().getAttribute('aria-expanded')).toBe('false');
		const controlled = document.getElementById(String(disclosure().getAttribute('aria-controls')));
		expect(controlled?.hidden).toBe(true);
		await fireEvent.input(titleField(), { target: { value: 'Blumen gießen' } });
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.detail.create).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalled());
		expect(mocks.rules.repeatCreated).not.toHaveBeenCalled();
	});

	it('opens with the weekday of the due date, follows a new due date and shows the preview', async () => {
		await openPlain();
		const due = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.input(due, { target: { value: '2026-09-28' } });
		await fireEvent.change(due);
		await fireEvent.click(disclosure());
		expect(disclosure().getAttribute('aria-expanded')).toBe('true');
		const form = within(section());
		expect(form.getByRole<HTMLInputElement>('checkbox', { name: 'Montag' }).checked).toBe(true);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-28');
		const dues = () =>
			[...section().querySelectorAll<HTMLElement>('.preview li')].map((row) => row.dataset.due);
		expect(dues()).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);

		// Untouched defaults move with the due date (Wednesday), chosen values stay.
		await fireEvent.input(due, { target: { value: '2026-09-30' } });
		await fireEvent.change(due);
		expect(form.getByRole<HTMLInputElement>('checkbox', { name: 'Mittwoch' }).checked).toBe(true);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-30');
		await fireEvent.click(form.getByRole('checkbox', { name: 'Freitag' }));
		await fireEvent.input(due, { target: { value: '2026-10-05' } });
		await fireEvent.change(due);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-30');
		expect(dues()).toEqual(['2026-09-30', '2026-10-02', '2026-10-07']);
	});

	it('creates the ticket, then the rule with it, and shows it in its series at once', async () => {
		await openPlain();
		await fireEvent.input(titleField(), { target: { value: 'Müll rausbringen' } });
		await fireEvent.click(disclosure());
		// Without a due date: today (Friday 25.09.) and the first date the ticket gets.
		expect(within(section()).getByText(/bekommt den ersten Termin: 25\.09\.2026/)).toBeTruthy();
		// Plan WV: the next tickets take the values of this form; before the migration of "Status
		// beim Anlegen" nothing is asked about the status (ADR-0022 addendum 9).
		expect(
			within(section()).getByText(
				/Künftige Tickets bekommen Titel, Beschreibung, Priorität, Projekt und Tags aus diesem Formular\./
			)
		).toBeTruthy();
		expect(within(section()).queryByRole('radiogroup')).toBeNull();
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		expect(mocks.detail.create.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.rules.repeatCreated.mock.invocationCallOrder[0] ?? 0
		);
		expect(mocks.rules.repeatCreated).toHaveBeenCalledWith(CREATED, {
			values: expect.objectContaining({
				mode: 'calendar',
				freq: 'weekly',
				weekdays: ['FR'],
				anchor: '2026-09-25'
			}),
			initialStatus: null
		});
		const joined = { ...CREATED, recurring: true, recurrenceId: RULE.id, due: '2026-09-25' };
		expect(mocks.detail.upsert).toHaveBeenCalledWith(joined);
		expect(mocks.tickets.upsert).toHaveBeenCalledWith(joined);
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
	});

	it('keeps the ticket and opens it when the rule fails (the panel offers "Wiederholen…")', async () => {
		await openPlain();
		mocks.rules.repeatCreated.mockResolvedValueOnce(null);
		await fireEvent.input(titleField(), { target: { value: 'Blumen' } });
		await fireEvent.click(disclosure());
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
		expect(mocks.detail.create).toHaveBeenCalledOnce();
		expect(mocks.detail.upsert).not.toHaveBeenCalled();
	});

	it('creates no rule once the section is folded again, and asks before discarding it', async () => {
		await openPlain();
		await fireEvent.click(disclosure());
		// Only the open section counts as an entry.
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).not.toBeNull();
		await answer('Weiter bearbeiten');
		await fireEvent.click(disclosure());
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).toBeNull();
	});

	it('checks an open section before creating anything', async () => {
		await openPlain();
		await fireEvent.input(titleField(), { target: { value: 'Blumen' } });
		await fireEvent.click(disclosure());
		await fireEvent.input(within(section()).getByLabelText('Vorlauf (Tage)'), {
			target: { value: '31' }
		});
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(section()).getByLabelText('Vorlauf (Tage)'))
		);
		expect(mocks.detail.create).not.toHaveBeenCalled();
	});

	it('offers no section before the migration of E5', async () => {
		await openPlain('unavailable');
		expect(screen.queryByRole('button', { name: 'Wiederholen' })).toBeNull();
	});

	// Plan WV-3: sub-tasks for every next ticket are set later at the ticket ("Wiederholt sich").
	it('names where the sub-tasks of the next tickets are set, after their migration', async () => {
		await openPlain('ready', true, true);
		await fireEvent.click(disclosure());
		expect(
			within(section()).getByText(
				/Ändern kannst du das danach am Ticket unter „Wiederholt sich“, dort auch Unteraufgaben, die jedes künftige Ticket bekommt\./
			)
		).toBeTruthy();
	});

	// ADR-0022 addendum 9: the open section asks with which status the next tickets start; "Wie
	// dieses Ticket" follows the status chosen in the form.
	it('asks "Folgetickets starten mit" without an answer in advance, following the status of the form', async () => {
		await openPlain('ready', true);
		await fireEvent.input(titleField(), { target: { value: 'Blumen gießen' } });
		await fireEvent.click(disclosure());
		expect(
			within(section()).getByText(
				/Künftige Tickets bekommen Titel, Beschreibung, Priorität, Projekt und Tags aus diesem Formular; den Status wählst du hier\./
			)
		).toBeTruthy();
		const group = within(section()).getByRole('radiogroup', { name: 'Folgetickets starten mit' });
		const answers = () =>
			within(group)
				.getAllByRole<HTMLInputElement>('radio')
				.map((radio) => [radio.labels?.[0]?.textContent?.trim(), radio.checked]);
		expect(answers()).toEqual([
			['Offen (wie dieses Ticket)', false],
			['Backlog', false],
			['In Arbeit', false],
			['Wartet', false]
		]);
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } });
		expect(answers()).toEqual([
			['Offen', false],
			['Wie dieses Ticket: In Arbeit', false],
			['Backlog', false],
			['Wartet', false]
		]);

		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(group));
		expect(group.getAttribute('aria-invalid')).toBe('true');
		expect(mocks.detail.create).not.toHaveBeenCalled();

		await fireEvent.click(
			within(group).getByRole('radio', { name: 'Wie dieses Ticket: In Arbeit' })
		);
		expect(group.getAttribute('aria-invalid')).toBeNull();
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'in_progress' }),
			undefined
		);
		expect(mocks.rules.repeatCreated).toHaveBeenCalledWith(CREATED, {
			values: expect.objectContaining({ weekdays: ['FR'] }),
			initialStatus: 'in_progress'
		});
	});

	it('asks nothing while the section is folded', async () => {
		await openPlain('ready', true);
		await fireEvent.input(titleField(), { target: { value: 'Blumen gießen' } });
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.detail.create).toHaveBeenCalledOnce());
		expect(mocks.rules.repeatCreated).not.toHaveBeenCalled();
	});
});
