// Component tests for "Neues Ticket" (E2 plan, package 8; E3 plan, T-13 and T-14): required
// title, defaults, project with the filtered project chosen in advance, tags, Ctrl+Enter, lock
// during the request, switching to the new ID with replaceState, server errors, discarding after a question.
// The creation itself is covered against the harness (E2 plan, package 4). Since UI-3 the question
// is the confirmation of ADR-0025 section 4 instead of window.confirm. Since NT-1 (ADR-0069) the
// options beyond the main fields stand under "Weitere Optionen" (new-ticket-more.test.ts); the route
// tests here run as before the restart of the server after NT-1 (two steps for a series), those of
// one request in new-ticket-more.test.ts as well. Tests of color and series open the area first.
// Since MO-6c the question asks also before a navigation within the app leaves the form with input
// (beforeNavigate), on the PC and in the phone frame, the conversion of an entry included.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/inbox';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Project } from '$lib/domain/project';
import type { Ticket, TicketDraft } from '$lib/domain/ticket';
import { MORE_OPTIONS_KEY, NO_EXTRAS } from '$lib/domain/ticket-create';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { fixedAssignees } from '$lib/stores/assignees.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
import type { Editor } from '@tiptap/core';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import { hasUnsavedInput } from '$lib/unsaved-input';
import { WayBack } from '$lib/way-back';
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
	/** The guards of beforeNavigate, run by `navigate` like SvelteKit before a navigation (MO-6c). */
	guards: [] as ((navigation: unknown) => void)[],
	/** The way back of the (app) layout; null as outside of it (MO-6). */
	wayBack: null as unknown,
	page: { url: new URL('http://localhost:3000/tickets/neu?erledigte=1') },
	// The server of before the restart after NT-1: it knows no request with everything at once.
	detail: {
		create: vi.fn(),
		upsert: vi.fn(),
		createSupport: null,
		loadCreateSupport: vi.fn(async () => undefined)
	},
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

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: (guard: (navigation: unknown) => void) => mocks.guards.push(guard)
}));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/way-back', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findWayBack: () => mocks.wayBack
}));
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
	mocks.guards.length = 0;
	mocks.wayBack = null;
	mocks.page.url = new URL('http://localhost:3000/tickets/neu?erledigte=1');
	catalog().release();
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem(MORE_OPTIONS_KEY);
});

/** "Weitere Optionen" is open on this device (NT-1), so color and "Wiederholen" are in sight. */
function moreOpenOnThisDevice() {
	beforeEach(() => localStorage.setItem(MORE_OPTIONS_KEY, '1'));
}

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
			null,
			// Nothing under "Weitere Optionen" (NT-1).
			NO_EXTRAS
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

describe('new ticket: color (ADR-0052)', () => {
	moreOpenOnThisDevice();
	const BLUE_HOUSE: Project = { ...HOUSE, color: 'blau' };
	const group = () => screen.getByRole('radiogroup', { name: 'Farbe' });
	const radio = (name: string) => within(group()).getByRole<HTMLInputElement>('radio', { name });

	it('starts with "Wie Projekt", follows the chosen project and creates with an own color', async () => {
		const { oncreate } = renderForm(undefined, {
			projects: [BLUE_HOUSE, CAR],
			colorsAvailable: true
		});
		expect(radio('Wie Projekt (keine)').checked).toBe(true);
		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: HOUSE.id } });
		expect(radio('Wie Projekt (Blau)').checked).toBe(true);

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(radio('Indigo'));
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ project: HOUSE.id, color: 'indigo' });
	});

	it('sends no color for "Wie Projekt" and asks before a chosen color is lost', async () => {
		const { oncreate, oncancel } = renderForm(undefined, {
			projects: [HOUSE],
			colorsAvailable: true
		});
		await fireEvent.click(radio('Senf'));
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).not.toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
		await answer('Weiter bearbeiten');

		await fireEvent.click(radio('Wie Projekt (keine)'));
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).not.toHaveProperty('color');
	});

	it('offers no color while the server does not know it', () => {
		renderForm(undefined, { projects: [HOUSE] });
		expect(screen.queryByRole('radiogroup', { name: 'Farbe' })).toBeNull();
	});
});

describe('new ticket: charm (ADR-0062)', () => {
	const choose = async (key: string) => {
		await fireEvent.click(screen.getByRole('button', { name: /^Charm( wählen|: )/ }));
		await fireEvent.click(document.querySelector(`[data-charm-option="${key}"]`) as HTMLElement);
	};

	it('starts without a charm and creates with the chosen one', async () => {
		const { oncreate } = renderForm(undefined, { charmsAvailable: true });
		expect(screen.getByRole('button', { name: 'Charm wählen' })).toBeTruthy();
		await choose('geschenk');
		expect(screen.getByRole('button', { name: 'Charm: Geschenk' })).toBeTruthy();
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Neu', charm: 'geschenk' });
	});

	it('sends no charm after "Kein Charm" and asks before a chosen charm is lost', async () => {
		const { oncreate, oncancel } = renderForm(undefined, { charmsAvailable: true });
		await choose('sport');
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).not.toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
		await answer('Weiter bearbeiten');

		await choose('none');
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).not.toHaveProperty('charm');
	});

	it('offers no charm while the server does not know it', () => {
		renderForm();
		expect(screen.queryByRole('button', { name: 'Charm wählen' })).toBeNull();
	});
});

describe('new ticket: "Zuständig" in the household (ADR-0068, PL-2)', () => {
	const ME = 'user00000000001';
	const BERT = 'user00000000002';
	const MEMBERS = [
		{ id: ME, name: 'Anna Beispiel', self: true },
		{ id: BERT, name: 'Bert Beispiel', self: false }
	];
	const inHousehold = () => ({
		assignmentAvailable: true,
		assignees: fixedAssignees(MEMBERS, ME)
	});
	const field = () => screen.getByLabelText<HTMLSelectElement>('Zuständig');
	const mine = () => screen.getByRole('button', { name: 'Mir zuweisen' });

	it('offers "Niemand" and the members, "Niemand" chosen, and sends no assignee for it', async () => {
		const { oncreate } = renderForm(undefined, inHousehold());
		expect(field().value).toBe('');
		expect([...field().options].map((option) => option.textContent)).toEqual([
			'Niemand',
			'Anna Beispiel (ich)',
			'Bert Beispiel'
		]);
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).not.toHaveProperty('assignee');
	});

	it('creates with another member and asks before the choice is lost', async () => {
		const { oncreate, oncancel } = renderForm(undefined, inHousehold());
		await fireEvent.change(field(), { target: { value: BERT } });
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(await discardQuestion()).not.toBeNull();
		expect(oncancel).not.toHaveBeenCalled();
		await answer('Weiter bearbeiten');

		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Neu', assignee: BERT });
	});

	it('makes the own account the assignee with one click on "Mir"', async () => {
		const { oncreate } = renderForm(undefined, inHousehold());
		expect(mine().textContent).toBe('Mir zuweisen');
		expect(mine().getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(mine());
		expect(field().value).toBe(ME);
		// Already the own account: the button stays where the focus is, locked.
		expect(mine().getAttribute('aria-disabled')).toBe('true');
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ assignee: ME });
	});

	it('shows a refusal of the server at the field', async () => {
		const refusal = 'Zuständig sein kann nur ein Mitglied des Haushalts.';
		renderForm(
			async () => ({ ok: false, message: null, fields: { assignee: refusal } }),
			inHousehold()
		);
		await fireEvent.change(field(), { target: { value: BERT } });
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(field().getAttribute('aria-invalid')).toBe('true'));
		expect(
			document.getElementById(field().getAttribute('aria-describedby') ?? '')?.textContent
		).toBe(refusal);
	});

	it.each([
		[
			'in the private area',
			{ assignmentAvailable: true, assignees: fixedAssignees(MEMBERS, ME, false) }
		],
		['before the migration', { assignees: fixedAssignees(MEMBERS, ME) }],
		['without the directory of the layout', { assignmentAvailable: true }]
	])('is not offered %s', (_label, props) => {
		renderForm(undefined, props);
		expect(screen.queryByLabelText('Zuständig')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Mir zuweisen' })).toBeNull();
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
	moreOpenOnThisDevice();
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

	it('asks "Status beim Anlegen" before a series becomes a rule (ADR-0022 addenda 9 and 17)', async () => {
		openFor(event({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }), 'ready', true);
		await fireEvent.click(await takeOver());
		const section = screen.getByRole('region', { name: 'Wiederholen' });
		const status = within(section).getByLabelText<HTMLSelectElement>('Status beim Anlegen');
		expect(status.value).toBe('');
		expect(status.getAttribute('aria-required')).toBe('true');
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(status));
		expect(status.getAttribute('aria-invalid')).toBe('true');
		expect(
			within(section).getByText('Bitte wählen, mit welchem Status Folgetickets starten.')
		).toBeTruthy();
		expect(mocks.detail.create).not.toHaveBeenCalled();

		await fireEvent.change(status, { target: { value: 'backlog' } });
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
	moreOpenOnThisDevice();
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

	// RV-1 (ADR-0022 addendum 18): untouched defaults still follow the due date; once the values are
	// touched, a differing "Beginnt am" gets the hint with "Fälligkeit übernehmen" instead.
	it('offers "Fälligkeit übernehmen" once the values are touched, and follows while untouched', async () => {
		await openPlain();
		const due = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.input(due, { target: { value: '2026-09-28' } });
		await fireEvent.change(due);
		await fireEvent.click(disclosure());
		const form = within(section());
		const takeDue = () => form.queryByRole('button', { name: 'Fälligkeit übernehmen' });
		await fireEvent.input(due, { target: { value: '2026-09-30' } });
		await fireEvent.change(due);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-30');
		expect(takeDue()).toBeNull();

		await fireEvent.click(form.getByRole('checkbox', { name: 'Freitag' }));
		await fireEvent.input(due, { target: { value: '2026-10-05' } });
		await fireEvent.change(due);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-30');
		expect(
			form.getByText('„Beginnt am“ weicht von der Fälligkeit des Tickets ab (Mo 05.10.).')
		).toBeTruthy();
		await fireEvent.click(takeDue() as HTMLElement);
		expect(form.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-10-05');
		expect(takeDue()).toBeNull();
		// Wednesday and Friday stay chosen; the dates start from the new start.
		const dues = () =>
			[...section().querySelectorAll<HTMLElement>('.preview li')].map((row) => row.dataset.due);
		expect(dues()).toEqual(['2026-10-07', '2026-10-09', '2026-10-14']);
	});

	it('counts after completion from the due date of the form and hides "Beginnt am" (RV-1)', async () => {
		await openPlain();
		const due = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.input(due, { target: { value: '2026-10-03' } });
		await fireEvent.change(due);
		await fireEvent.click(disclosure());
		const form = within(section());
		await fireEvent.click(form.getByRole('radio', { name: 'Nach Erledigung' }));
		expect(form.queryByLabelText('Beginnt am')).toBeNull();
		const ticketLine = () => section().querySelector('.preview-ticket')?.textContent?.trim();
		expect(ticketLine()).toBe('Dieses Ticket: fällig Sa 03.10.');
		await fireEvent.input(due, { target: { value: '2026-10-08' } });
		await fireEvent.change(due);
		expect(ticketLine()).toBe('Dieses Ticket: fällig Do 08.10.');
		// Without a due date the preview counts from today.
		await fireEvent.input(due, { target: { value: '' } });
		await fireEvent.change(due);
		expect(ticketLine()).toBeUndefined();
		expect(
			(section().querySelector('.preview li')?.textContent ?? '').replace(/\s+/g, ' ').trim()
		).toBe('Heute erledigt → erscheint Di 29.09. → fällig Fr 02.10.');
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
		expect(within(section()).queryByLabelText('Status beim Anlegen')).toBeNull();
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

	// ADR-0022 addenda 9 and 17: the open section asks with which status the next tickets start, in
	// the select "Status beim Anlegen" of the template; "(wie dieses Ticket)" follows the status
	// chosen in the form.
	it('asks "Status beim Anlegen" without an answer in advance, following the status of the form', async () => {
		await openPlain('ready', true);
		await fireEvent.input(titleField(), { target: { value: 'Blumen gießen' } });
		await fireEvent.click(disclosure());
		expect(
			within(section()).getByText(
				/Künftige Tickets bekommen Titel, Beschreibung, Priorität, Projekt und Tags aus diesem Formular; den Status wählst du hier\./
			)
		).toBeTruthy();
		expect(within(section()).queryByRole('radiogroup')).toBeNull();
		const status = within(section()).getByLabelText<HTMLSelectElement>('Status beim Anlegen');
		const answers = () => [...status.options].map((option) => [option.value, option.textContent]);
		expect(status.value).toBe('');
		expect(answers()).toEqual([
			['', 'Bitte wählen'],
			['backlog', 'Backlog'],
			['open', 'Offen (wie dieses Ticket)'],
			['in_progress', 'In Arbeit'],
			['waiting', 'Wartet']
		]);
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } });
		expect(answers()).toEqual([
			['', 'Bitte wählen'],
			['backlog', 'Backlog'],
			['open', 'Offen'],
			['in_progress', 'In Arbeit (wie dieses Ticket)'],
			['waiting', 'Wartet']
		]);

		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(document.activeElement).toBe(status));
		expect(status.getAttribute('aria-invalid')).toBe('true');
		expect(mocks.detail.create).not.toHaveBeenCalled();

		await fireEvent.change(status, { target: { value: 'in_progress' } });
		expect(status.getAttribute('aria-invalid')).toBeNull();
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

// WH-2 (ADR-0022 addendum 14): "Neues Ticket" with "Wiederholen" and a due date in the past asks
// where the series begins, like "Wiederholen…": typed by hand, taken from an old entry of the inbox
// (Notion) or from a calendar series. Today is Friday 25.09.2026.
describe('new ticket: a due date in the past (WH-2)', () => {
	moreOpenOnThisDevice();
	const RULE = { id: 'rule00000000011' };
	const OVERDUE: Ticket = { ...CREATED, due: '2024-03-12' };

	function prepare(item: InboxItem | null) {
		mocks.page.url = new URL(
			item === null
				? 'http://localhost:3000/tickets/neu'
				: `http://localhost:3000/tickets/neu?aus=${item.id}`
		);
		mocks.inbox.fetch.mockReset();
		if (item !== null) mocks.inbox.fetch.mockResolvedValue(item);
		mocks.detail.create.mockReset();
		mocks.detail.create.mockResolvedValue({ ok: true, ticket: OVERDUE });
		mocks.detail.upsert.mockReset();
		mocks.tickets.upsert.mockReset();
		mocks.rules.state = 'ready';
		mocks.rules.statusReady = false;
		mocks.rules.repeatCreated.mockReset();
		mocks.rules.repeatCreated.mockResolvedValue(RULE);
		render(NewTicketPage);
	}

	/** An entry imported from Notion: an all-day date of Tuesday 12.03.2024 (Berlin midnight). */
	function notionEntry(sourceMeta: Record<string, unknown> = {}): InboxItem {
		return {
			id: 'item00000000003',
			channel: 'notion',
			kind: 'task',
			title: 'Fenster putzen',
			body: '- **Fällig:** 12.03.2024',
			sourceUrl: '',
			sourceRef: '00000000-0000-4000-8000-00000000c0de',
			sourceDate: '2024-03-11 23:00:00.000Z',
			sourceMeta: { all_day: true, ...sourceMeta },
			original: '',
			state: 'new',
			ticketId: null,
			handledAt: null,
			created: '2026-09-25 08:00:00.000Z',
			updated: '2026-09-25 08:00:00.000Z'
		};
	}

	const section = () => screen.getByRole('region', { name: 'Wiederholen' });
	const startQuestion = () =>
		within(section()).getByRole('group', {
			name: 'Die Fälligkeit liegt in der Vergangenheit (12.03.2024).'
		});
	const noteOf = (radio: HTMLElement) =>
		document.getElementById(radio.getAttribute('aria-describedby') ?? '')?.textContent;

	it('asks for a due date typed in the past and begins from today by default', async () => {
		prepare(null);
		await vi.waitFor(() => expect(screen.getByLabelText('Titel')).toBeTruthy());
		await fireEvent.input(titleField(), { target: { value: 'Fenster putzen' } });
		const due = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		await fireEvent.input(due, { target: { value: '2024-03-12' } });
		await fireEvent.change(due);
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }));
		const today = within(startQuestion()).getByRole<HTMLInputElement>('radio', {
			name: 'Serie ab heute beginnen'
		});
		expect(today.checked).toBe(true);
		expect(noteOf(today)).toBe('Erstes Vorkommen: Di 29.09.');
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		// The ticket is created with the typed date; the rule moves it (the hook, in one step).
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({ due: '2024-03-12' }),
			undefined
		);
		const joined = { ...OVERDUE, recurring: true, recurrenceId: RULE.id, due: '2026-09-29' };
		expect(mocks.detail.upsert).toHaveBeenCalledWith(joined);
		expect(mocks.tickets.upsert).toHaveBeenCalledWith(joined);
	});

	it('keeps the old date of an entry from Notion when the user chooses so', async () => {
		prepare(notionEntry());
		await fireEvent.click(await screen.findByRole('button', { name: 'Als Fälligkeit übernehmen' }));
		expect(screen.getByLabelText<HTMLInputElement>('Fälligkeit').value).toBe('2024-03-12');
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }));
		const keep = within(startQuestion()).getByRole<HTMLInputElement>('radio', {
			name: 'Ursprüngliches Datum behalten'
		});
		expect(noteOf(keep)).toBe('Das Ticket bleibt „überfällig seit 12.03.2024“.');
		await fireEvent.click(keep);
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.rules.repeatCreated).toHaveBeenCalledOnce());
		expect(mocks.detail.create).toHaveBeenCalledWith(
			expect.objectContaining({ due: '2024-03-12' }),
			{ sourceItem: 'item00000000003' }
		);
		expect(mocks.rules.repeatCreated).toHaveBeenCalledWith(OVERDUE, {
			values: expect.objectContaining({ start: 'keep', anchor: '2024-03-12' }),
			initialStatus: null
		});
		expect(mocks.detail.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ recurring: true, due: '2024-03-12' })
		);
	});

	it('asks the same for a calendar series taken over with its old date as due date', async () => {
		prepare({
			...notionEntry({ rrule: 'FREQ=WEEKLY;BYDAY=TU' }),
			channel: 'ics',
			kind: 'event'
		});
		await fireEvent.click(
			await screen.findByRole('button', { name: 'Als Wiederholung übernehmen' })
		);
		// The suggestion begins on the first date from today (ADR-0024); the due date stays empty.
		expect(within(section()).getByLabelText<HTMLInputElement>('Beginnt am').value).toBe(
			'2026-09-29'
		);
		expect(within(section()).queryByRole('group', { name: /Vergangenheit/ })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Als Fälligkeit übernehmen' }));
		expect(
			noteOf(within(startQuestion()).getByRole('radio', { name: 'Serie ab heute beginnen' }))
		).toBe('Erstes Vorkommen: Di 29.09.');
	});
});

/** A navigation as beforeNavigate gets it, from the page of the form to `path`; runs the guards. */
function navigate(
	path: string,
	route: string | null,
	overrides: Record<string, unknown> = {}
): { cancel: ReturnType<typeof vi.fn> } {
	const navigation = {
		type: 'link',
		from: { url: new URL(mocks.page.url) },
		to: { url: new URL(path, 'http://localhost:3000'), route: { id: route } },
		cancel: vi.fn(),
		...overrides
	};
	for (const guard of mocks.guards) guard(navigation);
	return navigation;
}

// MO-6c (ADR-0073 addendum MO-6c, on every device, user decision): "Neues Ticket" asks before a
// navigation within the app leaves the form with typed input, with the question of "Abbrechen", the
// way "Erfassen" does since MO-6b. Every way runs on a PC with the switch on, on a phone with the
// switch off and in the phone frame.
describe('new ticket: leaving with typed input (MO-6c)', () => {
	const WINDOWS = [
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false],
		['the phone frame', true, true]
	] as const;
	const ITEM_ID = 'item00000000001';
	/** Routes of the targets: the list, the form, a ticket, the inbox and the day plan. */
	const LIST = '/(app)/(tickets)';
	const FORM = '/(app)/(tickets)/tickets/neu';
	const TICKET = '/(app)/(tickets)/tickets/[id]';
	const INBOX = '/(app)/eingang';
	const DAY_PLAN = '/(app)/tagesplan';
	/** Browser back or the back gesture: one step back through the history. */
	const BACK = { type: 'popstate', delta: -1 };
	const CREATED_HREF = '/tickets/new000000000000?erledigte=1';
	const ENTRY: InboxItem = {
		id: ITEM_ID,
		channel: 'eml',
		kind: 'mail',
		title: 'Rechnung September',
		body: 'Bitte bis Monatsende zahlen.',
		sourceUrl: '',
		sourceRef: '<a@b>',
		sourceDate: null,
		sourceMeta: { from: 'Shop <shop@example.com>' },
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z'
	};
	let stop: (() => void) | null = null;

	/** The window of the test: narrow or not, and the switch "Handy-Ansicht (Vorschau)". */
	function inWindow(narrow: boolean, enabled: boolean) {
		vi.stubGlobal('matchMedia', (media: string) => ({
			matches: media === PHONE_QUERY ? narrow : false,
			media,
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		}));
		stop = getMobileLayoutStore().connect();
		getMobileLayoutStore().choose(enabled);
		expect(getMobileLayoutStore().active).toBe(narrow && enabled);
	}

	/** "Umwandeln" of a card of the inbox led to the form (a link of the app, MO-6). */
	function openConversion() {
		const wayBack = new WayBack();
		wayBack.arrived({ type: 'link', from: new URL('http://localhost:3000/eingang') });
		mocks.wayBack = wayBack;
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?aus=${ITEM_ID}`);
		mocks.inbox.fetch.mockReset();
		mocks.inbox.fetch.mockResolvedValue(ENTRY);
		mocks.detail.create.mockReset();
		render(NewTicketPage);
	}

	beforeEach(() => {
		mocks.detail.create.mockReset();
	});

	afterEach(() => {
		stop?.();
		stop = null;
		getMobileLayoutStore().choose(false);
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it.each(WINDOWS)(
		'asks on %s before a link, the bar, "Mehr" and the bar of the views, keeps the input with "Weiter bearbeiten" and goes on after "Verwerfen"',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			const { oncancel } = renderForm();
			await fireEvent.input(titleField(), { target: { value: 'Rasen mähen' } });

			for (const [path, route] of [
				['/eingang?quelle=mail', INBOX],
				['/tagesplan', DAY_PLAN],
				['/kalender', '/(app)/kalender'],
				['/projekte', '/(app)/projekte']
			] as const) {
				expect(navigate(path, route).cancel).toHaveBeenCalledOnce();
				// The question of "Abbrechen" with its words; the first focus on "Weiter bearbeiten".
				const question = await discardQuestion();
				expect(question?.open).toBe(true);
				expect(
					within(question as HTMLElement).getByText('Die Eingaben gehen verloren.')
				).toBeTruthy();
				await vi.waitFor(() =>
					expect(document.activeElement).toBe(
						within(question as HTMLElement).getByRole('button', { name: 'Weiter bearbeiten' })
					)
				);
				await answer('Weiter bearbeiten');
				expect(await discardQuestion()).toBeNull();
				expect(titleField().value).toBe('Rasen mähen');
			}
			expect(mocks.goto).not.toHaveBeenCalled();

			// SvelteKit runs the guards inside goto, before the navigation ends (since MO-7a the form
			// asks again once it ended and the form is still there).
			const again: { cancel: ReturnType<typeof vi.fn> }[] = [];
			mocks.goto.mockImplementationOnce(async (...args: unknown[]) => {
				again.push(navigate(String(args[0]), DAY_PLAN));
				return undefined;
			});
			expect(navigate('/tagesplan?tag=2031-05-15', DAY_PLAN).cancel).toHaveBeenCalledOnce();
			await answer('Verwerfen');
			expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/tagesplan?tag=2031-05-15');
			expect(oncancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
			// The navigation that "Verwerfen" starts again passes.
			expect(again).toHaveLength(1);
			expect(again[0]?.cancel).not.toHaveBeenCalled();
		}
	);

	it.each(WINDOWS)(
		'asks on %s before browser back and the back gesture, and goes the step after "Verwerfen"',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
			const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
			const { oncancel } = renderForm();
			await fireEvent.input(titleField(), { target: { value: 'Idee' } });

			expect(navigate('/?erledigte=1', LIST, BACK).cancel).toHaveBeenCalledOnce();
			await answer('Weiter bearbeiten');
			expect(go).not.toHaveBeenCalled();
			expect(titleField().value).toBe('Idee');

			expect(navigate('/?erledigte=1', LIST, BACK).cancel).toHaveBeenCalledOnce();
			await answer('Verwerfen');
			expect(go).toHaveBeenCalledExactlyOnceWith(-1);
			expect(back).not.toHaveBeenCalled();
			expect(mocks.goto).not.toHaveBeenCalled();
			expect(oncancel).not.toHaveBeenCalled();
			// The step that "Verwerfen" starts again passes; no second question.
			expect(navigate('/?erledigte=1', LIST, BACK).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);

	it.each(WINDOWS)(
		'lets a navigation pass on %s without input, for another query, out of the app and to the login page',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			renderForm();
			expect(navigate('/eingang', INBOX).cancel).not.toHaveBeenCalled();
			expect(navigate('/?erledigte=1', LIST, BACK).cancel).not.toHaveBeenCalled();

			await fireEvent.input(titleField(), { target: { value: 'A' } });
			// A filter of the list beside the form and "Neues Ticket" once more change only the query:
			// the form and its input stay.
			const filtered = `/tickets/neu?erledigte=1&projekt=${HOUSE.id}`;
			expect(navigate(filtered, FORM).cancel).not.toHaveBeenCalled();
			expect(navigate('/tickets/neu?erledigte=1', FORM).cancel).not.toHaveBeenCalled();
			// Leaving the app is the question of the browser; the login page and other sites pass.
			const leave = { type: 'leave', to: null };
			expect(navigate('/eingang', null, leave).cancel).not.toHaveBeenCalled();
			expect(navigate('/login', '/login').cancel).not.toHaveBeenCalled();
			expect(navigate('https://example.com/', null).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
			expect(titleField().value).toBe('A');
		}
	);

	it.each(WINDOWS)(
		'lets a navigation pass on %s while the ticket is created and after "Anlegen"',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			const request = deferred<CreateResult>();
			mocks.detail.create.mockReturnValueOnce(request.promise);
			render(NewTicketPage);
			await fireEvent.input(titleField(), { target: { value: 'Neu' } });
			await fireEvent.click(createButton());
			expect(createButton().textContent?.trim()).toBe('Wird angelegt …');

			// A request that runs keeps its input (as in "Erfassen").
			expect(navigate('/eingang', INBOX).cancel).not.toHaveBeenCalled();
			request.resolve({ ok: true, ticket: CREATED });
			await vi.waitFor(() =>
				expect(mocks.goto).toHaveBeenCalledWith(CREATED_HREF, { replaceState: true })
			);
			// Created: the switch to the new ticket and every other way pass.
			expect(navigate(CREATED_HREF, TICKET, { type: 'goto' }).cancel).not.toHaveBeenCalled();
			expect(navigate('/tagesplan', DAY_PLAN).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);

	it.each(WINDOWS)(
		'lets a navigation pass on %s after creating with Ctrl+Enter',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			mocks.detail.create.mockResolvedValueOnce({ ok: true, ticket: CREATED });
			render(NewTicketPage);
			await fireEvent.input(titleField(), { target: { value: 'Neu' } });
			await fireEvent.keyDown(titleField(), { key: 'Enter', ctrlKey: true });

			await vi.waitFor(() =>
				expect(mocks.goto).toHaveBeenCalledWith(CREATED_HREF, { replaceState: true })
			);
			expect(navigate(CREATED_HREF, TICKET, { type: 'goto' }).cancel).not.toHaveBeenCalled();
			expect(navigate('/?erledigte=1', LIST, BACK).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);

	it.each(WINDOWS)(
		'asks once on %s for "Abbrechen", the × or the arrow and Escape: after "Verwerfen" the navigation of closing passes',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			render(NewTicketPage);
			await fireEvent.input(titleField(), { target: { value: 'Entwurf' } });

			// The way of the head: the arrow in the phone frame, else the ×.
			const head = narrow && enabled ? 'Zurück' : 'Panel schließen';
			await fireEvent.click(screen.getByRole('button', { name: head }));
			expect((await discardQuestion())?.open).toBe(true);
			await answer('Weiter bearbeiten');
			await fireEvent.keyDown(titleField(), { key: 'Escape' });
			expect((await discardQuestion())?.open).toBe(true);
			await answer('Weiter bearbeiten');
			expect(mocks.goto).not.toHaveBeenCalled();

			await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
			await answer('Verwerfen');
			expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/?erledigte=1');
			// The navigation of closing passes without a second question.
			expect(navigate('/?erledigte=1', LIST, { type: 'goto' }).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);

	it.each(WINDOWS)(
		'cancels the conversion of an entry on %s with one question: after "Verwerfen" no second one and no loop',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			const framed = narrow && enabled;
			const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
			const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
			openConversion();
			await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
			await fireEvent.input(titleField(), { target: { value: 'Rechnung bezahlen' } });

			// The arrow in the phone frame, "Abbrechen" elsewhere (both cancel the same way).
			const cancel = framed ? 'Zurück' : 'Abbrechen';
			await fireEvent.click(screen.getByRole('button', { name: cancel }));
			await answer('Verwerfen');
			// In the phone frame back through the history to the card (backThroughHistory, MO-6), else
			// to the entry as before.
			expect(back).toHaveBeenCalledTimes(framed ? 1 : 0);
			expect(mocks.goto.mock.calls).toEqual(framed ? [] : [[`/eingang/${ITEM_ID}`]]);
			// The navigation of cancelling passes: no second question, no further step.
			const leaving = framed
				? navigate('/eingang', INBOX, BACK)
				: navigate(`/eingang/${ITEM_ID}`, '/(app)/eingang/[id]', { type: 'goto' });
			expect(leaving.cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
			expect(back).toHaveBeenCalledTimes(framed ? 1 : 0);
			expect(go).not.toHaveBeenCalled();
		}
	);

	it.each(WINDOWS)(
		'asks on %s before the back gesture leaves a conversion and goes one step after "Verwerfen"',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
			const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
			openConversion();
			await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
			await fireEvent.input(titleField(), { target: { value: 'Rechnung bezahlen' } });

			expect(navigate('/eingang', INBOX, BACK).cancel).toHaveBeenCalledOnce();
			await answer('Verwerfen');
			expect(go).toHaveBeenCalledExactlyOnceWith(-1);
			expect(back).not.toHaveBeenCalled();
			expect(mocks.goto).not.toHaveBeenCalled();
			expect(navigate('/eingang', INBOX, BACK).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);

	it.each(WINDOWS)(
		'asks on %s when the same path leaves the entry to convert (another form), not for a filter',
		async (_name, narrow, enabled) => {
			inWindow(narrow, enabled);
			openConversion();
			await vi.waitFor(() => expect(titleField().value).toBe('Rechnung September'));
			await fireEvent.input(titleField(), { target: { value: 'Rechnung bezahlen' } });

			// "Ticket anlegen" of "Erste Schritte" opens the form without the entry.
			expect(navigate('/tickets/neu', FORM).cancel).toHaveBeenCalledOnce();
			await answer('Weiter bearbeiten');
			expect(titleField().value).toBe('Rechnung bezahlen');
			// A filter of the list keeps `?aus=` and the form.
			const filtered = `/tickets/neu?aus=${ITEM_ID}&projekt=${HOUSE.id}`;
			expect(navigate(filtered, FORM).cancel).not.toHaveBeenCalled();
			expect(await discardQuestion()).toBeNull();
		}
	);
});

// MO-7a (ADR-0073 addendum MO-7a): the remaining safeguards of MO-6c, after the pattern of
// TicketRouteLayout. The question of the browser stays quiet while the navigation of "Verwerfen"
// runs (a new build loads the page anew there); the form asks again once that navigation ended and
// the form is still there; a failed request unlocks the form; "Weiter bearbeiten" before a
// navigation brings the focus back into the form instead of onto the link tapped.
describe('new ticket: safeguards of leaving (MO-7a)', () => {
	const INBOX = '/(app)/eingang';

	it('reports no unsaved input while the navigation of "Verwerfen" runs, nor after "Verwerfen" of "Abbrechen"', async () => {
		const navigation = deferred<undefined>();
		mocks.goto.mockReturnValueOnce(navigation.promise);
		const { oncancel } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Rasen mähen' } });
		expect(hasUnsavedInput()).toBe(true);

		expect(navigate('/eingang', INBOX).cancel).toHaveBeenCalledOnce();
		await answer('Verwerfen');
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/eingang');
		// A new build turns this navigation into a page load: the browser must not ask a second time.
		expect(hasUnsavedInput()).toBe(false);
		navigation.resolve(undefined);
		cleanup();

		renderForm(undefined, { oncancel });
		await fireEvent.input(titleField(), { target: { value: 'Idee' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		await answer('Verwerfen');
		expect(oncancel).toHaveBeenCalledOnce();
		expect(hasUnsavedInput()).toBe(false);
	});

	it('asks again once the navigation of "Verwerfen" ended and the form is still there', async () => {
		renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Rasen mähen' } });
		const other = '/tickets/neu?aus=item00000000002';
		expect(navigate(other, '/(app)/(tickets)/tickets/neu').cancel).toHaveBeenCalledOnce();
		await answer('Verwerfen');
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(other));
		await tick();

		// The form stayed (the navigation kept it) and still holds the input: leaving asks again.
		expect(titleField().value).toBe('Rasen mähen');
		await vi.waitFor(() => expect(hasUnsavedInput()).toBe(true));
		expect(navigate('/eingang', INBOX).cancel).toHaveBeenCalledOnce();
		expect((await discardQuestion())?.open).toBe(true);
	});

	it('unlocks the form when the request fails with an exception, and the error still reaches the log of the session', async () => {
		const failure = new Error('kaputt');
		const rejections: unknown[] = [];
		// The problem log of the app listens to unhandled rejections (ADR-0071); here this listener.
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on('unhandledRejection', onRejection);
		try {
			renderForm(async () => {
				throw failure;
			});
			await fireEvent.input(titleField(), { target: { value: 'Neu' } });
			await fireEvent.click(createButton());
			await vi.waitFor(() => expect(createButton().textContent?.trim()).toBe('Anlegen'));
			expect(createButton().getAttribute('aria-disabled')).toBeNull();
			await vi.waitFor(() => expect(rejections).toEqual([failure]));
			// Unlocked, the question before leaving works again.
			expect(navigate('/eingang', INBOX).cancel).toHaveBeenCalledOnce();
			expect((await discardQuestion())?.open).toBe(true);
		} finally {
			process.off('unhandledRejection', onRejection);
		}
	});

	it('brings the focus back to the field of the form after "Weiter bearbeiten" instead of the link tapped', async () => {
		renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Rasen mähen' } });
		const due = screen.getByLabelText<HTMLInputElement>('Fälligkeit');
		due.focus();
		const link = document.createElement('a');
		link.href = '/eingang';
		link.textContent = 'Eingang';
		document.body.append(link);
		try {
			link.focus();
			expect(document.activeElement).toBe(link);
			expect(navigate('/eingang', INBOX).cancel).toHaveBeenCalledOnce();
			await answer('Weiter bearbeiten');
			await vi.waitFor(() => expect(document.activeElement).toBe(due));
			expect(titleField().value).toBe('Rasen mähen');
		} finally {
			link.remove();
		}
	});

	it('keeps the focus on "Abbrechen" after "Weiter bearbeiten" of its own question', async () => {
		renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Idee' } });
		const cancel = screen.getByRole('button', { name: 'Abbrechen' });
		cancel.focus();
		await fireEvent.click(cancel);
		await answer('Weiter bearbeiten');
		await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
	});
});
