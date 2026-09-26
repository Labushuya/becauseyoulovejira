// Component tests for comments (E2 plan, package 9): sanitized Markdown, own and foreign
// comments, editing and cancelling, deleting with a question, `Strg+Enter`, the limit of
// 20 000 characters and the error display. The store runs for real on a fake data layer. Since
// UI-3 the question is the confirmation of ADR-0025 section 4 instead of window.confirm.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { COMMENT_MAX_LENGTH, type Comment } from '$lib/domain/ticket';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import CommentList from './CommentList.svelte';

useOverlayStubs();

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

function newCommentField() {
	return screen.getByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)');
}

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
	it('is locked without text and explains why', async () => {
		const { data } = await renderComments();
		const send = screen.getByRole('button', { name: 'Kommentieren' });

		expect(send.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(send.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Zum Kommentieren fehlt noch Text.'
		);
		await fireEvent.click(send);
		expect(data.createComment).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(newCommentField());
	});

	it('sends with the button and empties the field', async () => {
		const { data } = await renderComments();
		await fireEvent.input(newCommentField(), { target: { value: 'Neu hier' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		await vi.waitFor(() => expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Neu hier'));
		await vi.waitFor(() => expect(newCommentField().value).toBe(''));
		expect(screen.getByText('Neu hier')).toBeTruthy();
	});

	it('sends with Strg+Enter', async () => {
		const { data } = await renderComments();
		await fireEvent.input(newCommentField(), { target: { value: 'Per Tastatur' } });

		await fireEvent.keyDown(newCommentField(), { key: 'Enter', ctrlKey: true });

		await vi.waitFor(() => expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Per Tastatur'));
	});

	it('keeps the text and shows a field error on failure', async () => {
		const { data } = await renderComments();
		data.createComment.mockRejectedValueOnce(new DataError('network'));
		await fireEvent.input(newCommentField(), { target: { value: 'Bleibt stehen' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));

		const error = await screen.findByText(/Server nicht erreichbar/);
		expect(error.closest('.field-error')).not.toBeNull();
		expect(newCommentField().value).toBe('Bleibt stehen');
		expect(newCommentField().getAttribute('aria-invalid')).toBe('true');
		expect(newCommentField().getAttribute('aria-describedby')).toContain(
			error.closest('.field-error')?.id
		);
	});

	it('limits the text to 20 000 characters', async () => {
		await renderComments();

		expect(COMMENT_MAX_LENGTH).toBe(20_000);
		expect(newCommentField().maxLength).toBe(20_000);
	});
});

describe('editing and deleting', () => {
	it('edits an own comment and returns the focus to "Bearbeiten"', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		const field = screen.getByLabelText<HTMLTextAreaElement>('Kommentar bearbeiten (Markdown)');
		expect(document.activeElement).toBe(field);
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

	it('saves an edit with Strg+Enter', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		const field = screen.getByLabelText<HTMLTextAreaElement>('Kommentar bearbeiten (Markdown)');
		await fireEvent.input(field, { target: { value: 'Tastatur' } });

		await fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });

		await vi.waitFor(() =>
			expect(data.updateComment).toHaveBeenCalledWith('comment00000001', 'Tastatur')
		);
	});

	it('cancels an edit without a request', async () => {
		const { data } = await renderComments();
		await fireEvent.click(screen.getByRole('button', { name: /^Bearbeiten: / }));
		await fireEvent.input(screen.getByLabelText('Kommentar bearbeiten (Markdown)'), {
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
