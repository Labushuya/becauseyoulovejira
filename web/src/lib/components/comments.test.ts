// Component tests for comments (E2 plan, package 9): sanitized Markdown, own and foreign
// comments, editing and cancelling, deleting with a question, `Strg+Enter`, the limit of
// 20 000 characters and the error display. The store runs for real on a fake data layer. Since
// UI-3 the question is the confirmation of ADR-0025 section 4 instead of window.confirm.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { CommentOrder } from '$lib/domain/comments';
import { NO_SERIES } from '$lib/domain/series-template';
import {
	COMMENT_MAX_LENGTH,
	type Comment,
	type Ticket,
	type TicketPatch
} from '$lib/domain/ticket';
import { CommentViewStore } from '$lib/stores/comment-view.svelte';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import type { Editor } from '@tiptap/core';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import CommentList from './CommentList.svelte';

useOverlayStubs();
useProseMirrorStubs();

/** The open question "Kommentar löschen?". */
async function deleteQuestion() {
	await tick();
	return screen.getByRole<HTMLDialogElement>('dialog', { name: 'Kommentar löschen?' });
}

const TICKET = 'ticket000000001';
const ME = 'user0000000001';
const OTHER = 'user0000000002';

function comment(overrides: Partial<Comment> = {}): Comment {
	return {
		id: 'comment00000001',
		ticket: TICKET,
		author: ME,
		body: 'Mein **fetter** Kommentar',
		created: '2026-09-24 10:00:00.000Z',
		updated: '2026-09-24 10:00:00.000Z',
		...overrides
	};
}

async function renderComments(initial: Comment[] = [comment()]) {
	let clock = 0;
	const data = {
		listComments: vi.fn(async () => initial),
		createComment: vi.fn(async (ticket: string, body: string): Promise<Comment> => {
			clock += 1;
			const created = `2026-09-24 12:00:0${clock}.000Z`;
			return comment({ id: `new${clock}`, ticket, body, created, updated: created });
		}),
		updateComment: vi.fn(async (id: string, body: string): Promise<Comment> => ({
			...(initial.find((entry) => entry.id === id) ?? comment({ id })),
			body,
			updated: '2026-09-24 13:00:00.000Z'
		})),
		deleteComment: vi.fn(async (): Promise<void> => undefined),
		listHistory: vi.fn(async () => [])
	} satisfies TicketActivityData;
	const store = new TicketActivityStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		() => ME
	);
	store.open(TICKET);
	const ondeleted = vi.fn();
	const result = render(CommentList, { props: { store, ondeleted } });
	await vi.waitFor(() => expect(store.commentsState).toBe('ready'));
	await tick();
	return { ...result, store, data, ondeleted };
}

/** Opens the editor of a new comment (RT-6: behind "Kommentar hinzufügen …") and returns it. */
async function openNewComment(): Promise<HTMLElement> {
	await fireEvent.click(screen.getByRole('button', { name: 'Kommentar hinzufügen …' }));
	return screen.findByRole('textbox', { name: 'Neuer Kommentar' }, { timeout: 5000 });
}

/** A comment editor in its source mode ("Markdown"), for typing with fireEvent.input. */
async function sourceOf(label: string): Promise<HTMLTextAreaElement> {
	await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
	return screen.findByLabelText<HTMLTextAreaElement>(`${label} (Markdown)`);
}

/** The new comment as Markdown. */
async function newCommentField(): Promise<HTMLTextAreaElement> {
	await openNewComment();
	return sourceOf('Neuer Kommentar');
}

/** The editor of a comment being edited, once it has loaded. */
function editEditor(): Promise<HTMLElement> {
	return screen.findByRole('textbox', { name: 'Kommentar bearbeiten' }, { timeout: 5000 });
}

const tiptap = (element: HTMLElement) => (element as HTMLElement & { editor: Editor }).editor;

function commentOf(name: RegExp) {
	return screen.getByRole('article', { name });
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('comment list', () => {
	it('renders comments as sanitized Markdown with author, time and "bearbeitet"', async () => {
		await renderComments([
			comment(),
			comment({
				id: 'c2',
				author: OTHER,
				body: '<img src=x onerror="alert(1)"> [Link](javascript:alert(1))',
				created: '2026-09-24 11:00:00.000Z',
				updated: '2026-09-24 11:30:00.000Z'
			})
		]);

		const own = commentOf(/^Kommentar von Du vom 24\.09\.2026 12:00$/);
		expect(own.querySelector('.markdown strong')?.textContent).toBe('fetter');
		expect(within(own).queryByText('bearbeitet')).toBeNull();

		const foreign = commentOf(/^Kommentar von Anderes Konto vom 24\.09\.2026 13:00$/);
		expect(within(foreign).getByText('bearbeitet')).toBeTruthy();
		expect(foreign.querySelector('img, [onerror]')).toBeNull();
		expect(foreign.querySelector('a[href^="javascript"]')).toBeNull();
	});

	it('shows "Bearbeiten" and "Löschen" only on own comments', async () => {
		await renderComments([comment(), comment({ id: 'c2', author: OTHER })]);

		const own = commentOf(/Kommentar von Du/);
		expect(within(own).getByRole('button', { name: /^Bearbeiten: Kommentar von Du/ })).toBeTruthy();
		expect(within(own).getByRole('button', { name: /^Löschen: Kommentar von Du/ })).toBeTruthy();
		const foreign = commentOf(/Kommentar von Anderes Konto/);
		expect(within(foreign).queryByRole('button')).toBeNull();
	});

	it('lets tasks be ticked only in own comments (ADR-0032 section 6)', async () => {
		const { data } = await renderComments([
			comment({ body: '- [ ] Anrufen' }),
			comment({ id: 'c2', author: OTHER, body: '- [ ] Fremd' })
		]);

		const foreign = within(commentOf(/Kommentar von Anderes Konto/)).getByRole<HTMLInputElement>(
			'checkbox',
			{ name: 'Fremd' }
		);
		expect(foreign.disabled).toBe(true);
		const own = within(commentOf(/Kommentar von Du/)).getByRole<HTMLInputElement>('checkbox', {
			name: 'Anrufen'
		});
		expect(own.disabled).toBe(false);

		await fireEvent.click(own);

		await vi.waitFor(() =>
			expect(data.updateComment).toHaveBeenCalledWith('comment00000001', '- [x] Anrufen')
		);
	});

	it('shows the empty state', async () => {
		await renderComments([]);

		expect(screen.getByText('Noch keine Kommentare')).toBeTruthy();
	});

	it('shows a loading error with "Erneut versuchen"', async () => {
		const data = {
			listComments: vi
				.fn<TicketActivityData['listComments']>()
				.mockRejectedValueOnce(new DataError('server', { status: 500 }))
				.mockResolvedValueOnce([comment()]),
			createComment: vi.fn(),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi.fn(async () => [])
		} satisfies TicketActivityData;
		const store = new TicketActivityStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			() => ME
		);
		store.open(TICKET);
		render(CommentList, { props: { store, ondeleted: vi.fn() } });
		await vi.waitFor(() => expect(store.commentsState).toBe('error'));
		await tick();

		const alert = screen.getByText(/Der Server hat mit einem Fehler geantwortet/);
		expect(alert.closest('.alert-error')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() => expect(screen.getByText('fetter')).toBeTruthy());
	});
});

describe('new comment', () => {
	it('opens the editor only on "Kommentar hinzufügen …" and puts the focus into it', async () => {
		await renderComments();
		expect(screen.queryByRole('button', { name: 'Kommentieren' })).toBeNull();
		expect(screen.queryByRole('textbox', { name: 'Neuer Kommentar' })).toBeNull();

		const field = await openNewComment();

		await vi.waitFor(() => expect(document.activeElement).toBe(field));
		expect(field.getAttribute('aria-multiline')).toBe('true');
		// Compact: no text style menu in comments.
		expect(screen.queryByRole('button', { name: /^Textstil/ })).toBeNull();
	});

	it('is locked without text and explains why', async () => {
		const { data } = await renderComments();
		const field = await openNewComment();
		const send = screen.getByRole('button', { name: 'Kommentieren' });

		expect(send.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(send.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Zum Kommentieren fehlt noch Text.'
		);
		await fireEvent.click(send);
		expect(data.createComment).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(document.activeElement).toBe(field));
	});

	it('sends with the button, closes the field and returns the focus', async () => {
		const { data } = await renderComments();
		await fireEvent.input(await newCommentField(), { target: { value: 'Neu hier' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		await vi.waitFor(() => expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Neu hier'));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Kommentar hinzufügen …' })
			)
		);
		expect(screen.queryByLabelText('Neuer Kommentar (Markdown)')).toBeNull();
		expect(screen.getByText('Neu hier')).toBeTruthy();
	});

	it('sends with Strg+Enter from the editor, formatted as Markdown', async () => {
		const { data } = await renderComments();
		const field = await openNewComment();
		const editor = tiptap(field);
		editor.commands.focus('end');
		typeText(editor.view, 'Per **Tastatur** gesendet');

		await fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

		await vi.waitFor(() =>
			expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Per **Tastatur** gesendet')
		);
	});

	it('sends with Strg+Enter from the source mode', async () => {
		const { data } = await renderComments();
		const field = await newCommentField();
		await fireEvent.input(field, { target: { value: 'Per Tastatur' } });

		await fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

		await vi.waitFor(() => expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Per Tastatur'));
	});

	it('keeps the text and shows a field error on failure', async () => {
		const { data } = await renderComments();
		data.createComment.mockRejectedValueOnce(new DataError('network'));
		const field = await newCommentField();
		await fireEvent.input(field, { target: { value: 'Bleibt stehen' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		const error = await screen.findByText(/Server nicht erreichbar/);
		expect(error.closest('.field-error')).not.toBeNull();
		const kept = screen.getByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)');
		expect(kept.value).toBe('Bleibt stehen');
		expect(kept.getAttribute('aria-invalid')).toBe('true');
		expect(kept.getAttribute('aria-describedby')).toContain(error.closest('.field-error')?.id);
	});

	it('limits the text to 20 000 characters', async () => {
		await renderComments();

		expect(COMMENT_MAX_LENGTH).toBe(20_000);
		expect((await newCommentField()).maxLength).toBe(20_000);
	});
});

describe('editing and deleting', () => {
	it('edits an own comment and returns the focus to "Bearbeiten"', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		const content = await editEditor();
		await vi.waitFor(() => expect(document.activeElement).toBe(content));
		expect(tiptap(content).getHTML()).toBe('<p>Mein <strong>fetter</strong> Kommentar</p>');
		const field = await sourceOf('Kommentar bearbeiten');
		expect(field.value).toBe('Mein **fetter** Kommentar');

		await fireEvent.input(field, { target: { value: 'Geändert' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		await vi.waitFor(() =>
			expect(data.updateComment).toHaveBeenCalledWith('comment00000001', 'Geändert')
		);
		await vi.waitFor(() => expect(screen.getByText('Geändert')).toBeTruthy());
		expect(screen.getByText('bearbeitet')).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Bearbeiten: / }));
	});

	it('saves an edit with Strg+Enter in the editor', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		const content = await editEditor();
		const editor = tiptap(content);
		editor.commands.focus('end');
		typeText(editor.view, ' neu');

		await fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

		await vi.waitFor(() =>
			expect(data.updateComment).toHaveBeenCalledWith(
				'comment00000001',
				'Mein **fetter** Kommentar neu'
			)
		);
	});

	it('cancels an edit without a request', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		await editEditor();
		await fireEvent.input(await sourceOf('Kommentar bearbeiten'), {
			target: { value: 'Verworfen' }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		expect(data.updateComment).not.toHaveBeenCalled();
		expect(screen.queryByLabelText('Kommentar bearbeiten (Markdown)')).toBeNull();
		expect(screen.getByText('fetter')).toBeTruthy();
		await tick();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Bearbeiten: / }));
	});

	it('asks before deleting and keeps the comment on "Abbrechen"', async () => {
		const { data } = await renderComments();

		await fireEvent.click(screen.getByRole('button', { name: /^Löschen: / }));
		const dialog = await deleteQuestion();

		expect(dialog.open).toBe(true);
		const text = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
		expect(text?.textContent?.trim()).toMatch(/^Der Kommentar von .+ wird endgültig gelöscht\.$/);
		const cancel = within(dialog).getByRole('button', { name: 'Abbrechen' });
		expect(document.activeElement).toBe(cancel);

		await fireEvent.click(cancel);

		expect(dialog.open).toBe(false);
		expect(data.deleteComment).not.toHaveBeenCalled();
		expect(screen.getByText('fetter')).toBeTruthy();
	});

	it('keeps the comment on Escape', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Löschen: / }));
		const dialog = await deleteQuestion();

		await fireEvent.keyDown(dialog, { key: 'Escape' });

		expect(dialog.open).toBe(false);
		expect(data.deleteComment).not.toHaveBeenCalled();
	});

	it('deletes after confirmation and hands the focus to the owner', async () => {
		const { data, ondeleted } = await renderComments();

		await fireEvent.click(screen.getByRole('button', { name: /^Löschen: / }));
		await fireEvent.click(within(await deleteQuestion()).getByRole('button', { name: 'Löschen' }));

		await vi.waitFor(() => expect(screen.getByText('Noch keine Kommentare')).toBeTruthy());
		expect(data.deleteComment).toHaveBeenCalledOnce();
		expect(ondeleted).toHaveBeenCalledOnce();
	});

	it('shows an error when deleting fails', async () => {
		const { data } = await renderComments();
		data.deleteComment.mockRejectedValueOnce(new DataError('forbidden', { status: 403 }));

		await fireEvent.click(screen.getByRole('button', { name: /^Löschen: / }));
		const dialog = await deleteQuestion();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));

		const error = await screen.findByText('Dafür fehlt die Berechtigung.');
		expect(error.closest('.field-error')).not.toBeNull();
		expect(dialog.open).toBe(false);
		expect(screen.getByText('fetter')).toBeTruthy();
	});
});

// ADR-0044: order, pinned comment and folding. Three comments (the middle one of another
// account); the pin runs through the real detail store of the ticket on a fake data layer.
const OLD = comment({
	id: 'comment00000001',
	body: 'Alt',
	created: '2026-09-24 09:00:00.000Z',
	updated: '2026-09-24 09:00:00.000Z'
});
const MIDDLE = comment({
	id: 'comment00000002',
	author: OTHER,
	body: 'Mitte',
	created: '2026-09-24 10:00:00.000Z',
	updated: '2026-09-24 10:00:00.000Z'
});
const NEW = comment({
	id: 'comment00000003',
	body: 'Neu',
	created: '2026-09-24 11:00:00.000Z',
	updated: '2026-09-24 11:00:00.000Z'
});

function ticketWith(pinnedComment: string | null | undefined): Ticket {
	return {
		id: TICKET,
		key: 'TASK-3',
		title: 'Steuererklärung',
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
		created: '2026-09-24 08:00:00.000Z',
		updated: '2026-09-24 08:00:00.000Z',
		// Left out before the restart, as the data layer does.
		...(pinnedComment === undefined ? {} : { pinnedComment })
	};
}

async function renderPinned({
	comments = [OLD, MIDDLE, NEW],
	pinned = null,
	order,
	beforeRestart = false
}: {
	comments?: Comment[];
	pinned?: string | null;
	order?: CommentOrder;
	/** The server does not know the field yet (before the restart after the migration). */
	beforeRestart?: boolean;
} = {}) {
	let current = ticketWith(beforeRestart ? undefined : pinned);
	let clock = 0;
	const ticketData = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			clock += 1;
			// The list only sends the pin.
			const pinnedComment = patch.pinnedComment ?? null;
			current = { ...current, pinnedComment, updated: `2026-09-24 12:00:0${clock}.000Z` };
			return current;
		}),
		create: vi.fn(),
		delete: vi.fn()
	} satisfies TicketDetailData;
	const list = {
		find: () => null,
		upsert: vi.fn(),
		completed: vi.fn(),
		remove: vi.fn(),
		announce: vi.fn()
	} satisfies TicketListSync;
	const flags: FlagInput[] = [];
	const sink: FlagSink = {
		show: (input) => {
			flags.push(input);
			return String(flags.length);
		},
		dismiss: vi.fn()
	};
	const session = { ensureValid: () => true, logout: vi.fn() };
	const detail = new TicketDetailStore(ticketData, session, list, null, NO_SERIES, sink);
	detail.open(TICKET);
	await vi.waitFor(() => expect(detail.state).toBe('ready'));
	const data = {
		listComments: vi.fn(async () => comments),
		createComment: vi.fn(async (ticket: string, body: string): Promise<Comment> =>
			comment({
				id: 'comment00000009',
				ticket,
				body,
				created: '2026-09-24 13:00:00.000Z',
				updated: '2026-09-24 13:00:00.000Z'
			})
		),
		updateComment: vi.fn(),
		deleteComment: vi.fn(async (): Promise<void> => undefined),
		listHistory: vi.fn(async () => [])
	} satisfies TicketActivityData;
	const store = new TicketActivityStore(data, session, () => ME);
	store.open(TICKET);
	const view = new CommentViewStore(null);
	if (order !== undefined) view.setOrder(order);
	render(CommentList, { props: { store, ondeleted: vi.fn(), pin: detail, view } });
	await vi.waitFor(() => expect(store.commentsState).toBe('ready'));
	await tick();
	return { store, data, detail, ticketData, flags, view };
}

/** Bodies of the comments in the order of the list. */
function shownBodies(): string[] {
	return [...document.querySelectorAll('article[data-comment-id] .markdown')].map(
		(element) => element.textContent?.trim() ?? ''
	);
}

describe('order of the comments (ADR-0044 section 1)', () => {
	it('shows the newest first, the switch and the input field above the list', async () => {
		await renderPinned();

		expect(shownBodies()).toEqual(['Neu', 'Mitte', 'Alt']);
		const group = screen.getByRole('group', { name: 'Reihenfolge der Kommentare' });
		expect(
			within(group).getByRole('button', { name: 'Neueste zuerst' }).getAttribute('aria-pressed')
		).toBe('true');
		expect(
			within(group).getByRole('button', { name: 'Älteste zuerst' }).getAttribute('aria-pressed')
		).toBe('false');
		const opener = screen.getByRole('button', { name: 'Kommentar hinzufügen …' });
		const first = document.querySelector('article[data-comment-id]') as HTMLElement;
		expect(group.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(opener.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('switches to "Älteste zuerst", says so and remembers it', async () => {
		const { view } = await renderPinned();

		await fireEvent.click(screen.getByRole('button', { name: 'Älteste zuerst' }));

		expect(shownBodies()).toEqual(['Alt', 'Mitte', 'Neu']);
		expect(
			screen.getByRole('button', { name: 'Älteste zuerst' }).getAttribute('aria-pressed')
		).toBe('true');
		expect(screen.getByText('Älteste Kommentare zuerst.').getAttribute('role')).toBe('status');
		expect(view.order).toBe('oldest');
	});

	it('shows no switch for a single comment', async () => {
		await renderPinned({ comments: [OLD] });
		expect(screen.queryByRole('group', { name: 'Reihenfolge der Kommentare' })).toBeNull();
	});

	it('puts a new comment at the end with "Älteste zuerst" and moves the focus to it', async () => {
		const { data } = await renderPinned({ order: 'oldest' });
		await fireEvent.input(await newCommentField(), { target: { value: 'Ganz neu' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		await vi.waitFor(() => expect(data.createComment).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(document.activeElement?.getAttribute('data-comment-id')).toBe('comment00000009')
		);
		expect(shownBodies().at(-1)).toBe('Ganz neu');
	});

	it('puts a new comment below the field with "Neueste zuerst", the focus back on the field', async () => {
		await renderPinned();
		await fireEvent.input(await newCommentField(), { target: { value: 'Ganz neu' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Kommentar hinzufügen …' })
			)
		);
		expect(shownBodies()[0]).toBe('Ganz neu');
	});
});

describe('pinned comment (ADR-0044 section 2)', () => {
	it('puts the pinned comment on top in either order, with "Angepinnt" and "Lösen"', async () => {
		await renderPinned({ pinned: OLD.id });

		expect(shownBodies()).toEqual(['Alt', 'Neu', 'Mitte']);
		const top = document.querySelector('article[data-comment-id]') as HTMLElement;
		expect(within(top).getByText('Angepinnt')).toBeTruthy();
		expect(within(top).getByRole('button', { name: /^Lösen: Kommentar von Du/ })).toBeTruthy();
		expect(screen.getAllByText('Angepinnt')).toHaveLength(1);

		await fireEvent.click(screen.getByRole('button', { name: 'Älteste zuerst' }));
		expect(shownBodies()).toEqual(['Alt', 'Mitte', 'Neu']);
	});

	it('offers "Anpinnen" on every comment, also on a foreign one', async () => {
		await renderPinned();
		expect(screen.getAllByRole('button', { name: /^Anpinnen: / })).toHaveLength(3);
		const foreign = commentOf(/Kommentar von Anderes Konto/);
		expect(within(foreign).getByRole('button', { name: /^Anpinnen: / })).toBeTruthy();
		expect(within(foreign).queryByRole('button', { name: /^Bearbeiten: / })).toBeNull();
	});

	it('pins, replaces the pinned one with "Rückgängig" in a flag, and releases it', async () => {
		const { ticketData, flags } = await renderPinned();

		await fireEvent.click(
			within(commentOf(/Anderes Konto/)).getByRole('button', { name: /^Anpinnen: / })
		);
		await vi.waitFor(() => expect(shownBodies()[0]).toBe('Mitte'));
		expect(ticketData.update).toHaveBeenLastCalledWith(TICKET, { pinnedComment: MIDDLE.id });
		expect(flags).toEqual([]);

		const older = screen
			.getAllByRole('button', { name: /^Anpinnen: / })
			.find((button) => button.closest('article')?.getAttribute('data-comment-id') === OLD.id);
		await fireEvent.click(older as HTMLElement);
		await vi.waitFor(() => expect(shownBodies()[0]).toBe('Alt'));
		expect(flags).toHaveLength(1);
		expect(flags[0]).toMatchObject({
			tone: 'info',
			title: 'Angepinnter Kommentar ersetzt.',
			action: { label: 'Rückgängig' }
		});

		flags[0]?.action?.run();
		await vi.waitFor(() => expect(shownBodies()[0]).toBe('Mitte'));
		expect(ticketData.update).toHaveBeenLastCalledWith(TICKET, { pinnedComment: MIDDLE.id });

		await fireEvent.click(screen.getByRole('button', { name: /^Lösen: / }));
		await vi.waitFor(() => expect(screen.queryByText('Angepinnt')).toBeNull());
		expect(ticketData.update).toHaveBeenLastCalledWith(TICKET, { pinnedComment: null });
		expect(shownBodies()).toEqual(['Neu', 'Mitte', 'Alt']);
	});

	it('waits while the pin is saved and shows a failure at the comment', async () => {
		const { ticketData } = await renderPinned();
		let fail!: (error: unknown) => void;
		ticketData.update.mockImplementationOnce(
			() => new Promise<Ticket>((_resolve, reject) => (fail = reject))
		);
		const button = within(commentOf(/Anderes Konto/)).getByRole('button', { name: /^Anpinnen: / });

		await fireEvent.click(button);

		expect(button.getAttribute('aria-busy')).toBe('true');
		for (const other of screen.getAllByRole('button', { name: /^Anpinnen: / })) {
			expect(other.getAttribute('aria-disabled')).toBe('true');
		}
		fail(
			new DataError('validation', {
				status: 400,
				fields: {
					pinned_comment: {
						code: 'validation_pinned_comment_missing',
						message: 'Der Kommentar wurde inzwischen gelöscht.'
					}
				}
			})
		);
		const error = await within(commentOf(/Anderes Konto/)).findByText(
			'Der Kommentar wurde inzwischen gelöscht.'
		);
		expect(error.closest('.field-error')?.id).toBe(button.getAttribute('aria-describedby'));
		expect(button.getAttribute('aria-busy')).toBeNull();
		expect(screen.queryByText('Angepinnt')).toBeNull();
	});

	it('offers no pinning before the restart (the server knows no pin yet)', async () => {
		await renderPinned({ beforeRestart: true });
		expect(screen.queryByRole('button', { name: /^Anpinnen: / })).toBeNull();
		expect(screen.getAllByRole('button', { name: /^Bearbeiten: / })).toHaveLength(2);
	});
});

describe('folding long comments (ADR-0044 section 3)', () => {
	useResizeObserverStub();

	/** Lets the text of a comment be `lines` lines of 20 px high and reports it. */
	async function measure(id: string, lines: number) {
		const article = document.querySelector(`article[data-comment-id="${id}"]`) as HTMLElement;
		const text = article.querySelector('.markdown') as HTMLElement;
		text.style.lineHeight = '20px';
		const inner = text.parentElement as HTMLElement;
		Object.defineProperty(inner, 'offsetHeight', { configurable: true, get: () => lines * 20 });
		resize(inner, 300);
		await tick();
		return article;
	}

	it('folds a comment higher than 14 lines to 12 and unfolds it for the tab', async () => {
		const { view } = await renderPinned();
		const article = await measure(NEW.id, 30);

		const more = within(article).getByRole('button', { name: /^Weiterlesen: Kommentar von Du/ });
		expect(more.getAttribute('aria-expanded')).toBe('false');
		const clip = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(clip.classList.contains('fade-end')).toBe(true);
		expect(clip.style.maxHeight).toBe('240px');
		// The whole text stays in the DOM for screen readers.
		expect(clip.textContent).toContain('Neu');

		await fireEvent.click(more);

		expect(more.getAttribute('aria-expanded')).toBe('true');
		expect(more.textContent).toMatch(/^Weniger anzeigen/);
		expect(clip.classList.contains('fade-end')).toBe(false);
		expect(clip.style.maxHeight).toBe('');
		expect(view.isExpanded(NEW.id)).toBe(true);

		await fireEvent.click(more);
		expect(view.isExpanded(NEW.id)).toBe(false);
		expect(clip.classList.contains('fade-end')).toBe(true);
	});

	it('keeps a comment of up to 14 lines whole', async () => {
		await renderPinned();
		const article = await measure(NEW.id, 14);
		expect(within(article).queryByRole('button', { name: /^Weiterlesen/ })).toBeNull();
	});

	it('folds the pinned comment as well and shows the whole text while editing', async () => {
		await renderPinned({ pinned: NEW.id });
		const article = await measure(NEW.id, 30);
		expect(within(article).getByText('Angepinnt')).toBeTruthy();
		expect(within(article).getByRole('button', { name: /^Weiterlesen/ })).toBeTruthy();

		await fireEvent.click(within(article).getByRole('button', { name: /^Bearbeiten: / }));

		await editEditor();
		expect(within(article).queryByRole('button', { name: /^Weiterlesen/ })).toBeNull();
		expect(article.querySelector('.fade-end')).toBeNull();
	});
});
