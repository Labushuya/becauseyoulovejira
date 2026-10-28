// Titles and comments in the phone frame (MO-7a, ADR-0073 addendum MO-7a): the keyboard starts a
// sentence with a capital letter (`autocapitalize="sentences"`), like the line of "＋" since MO-5 and
// "Erfassen" since MO-6. As there only in the frame: on a phone with the switch off the keyboard of
// the system stays as it was, and on a PC the attribute does nothing. The title of "Neues Ticket",
// the title of the ticket in panel and full view, the sub-tasks ("Unteraufgabe hinzufügen" and the
// list of "Neues Ticket"), the titles of "Ticket duplizieren" and "Folge-Ticket anlegen", the new
// comment and a comment being edited (the editor and its Markdown field).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Comment, Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { CommentViewStore } from '$lib/stores/comment-view.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
import type { TicketFollowUpStore } from '$lib/stores/ticket-follow-up.svelte';
import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import CommentForm from './CommentForm.svelte';
import CommentItem from './CommentItem.svelte';
import DuplicateDialog from './DuplicateDialog.svelte';
import EditableTitle from './EditableTitle.svelte';
import FollowUpDialog from './FollowUpDialog.svelte';
import NewTicketForm from './NewTicketForm.svelte';
import TemplateSubtaskList from './TemplateSubtaskList.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';

useOverlayStubs();
useProseMirrorStubs();

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => undefined), beforeNavigate: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost:3000/tickets/abc123def456ghi') }
}));

const ID = 'abc123def456ghi';

/** The window: the phone frame, a phone with the switch off, a PC with the switch on. */
const WINDOWS = [
	['in the phone frame', true, true, 'sentences'],
	['on a phone with the switch off', true, false, null],
	['on a PC with the switch on', false, true, null]
] as const;

let stop: (() => void) | null = null;

function useWindow(narrow: boolean, enabled: boolean): void {
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

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
});

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Steuererklärung',
		description: 'Belege sammeln',
		sourceItem: null,
		status: 'open',
		priority: 'high',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-02 12:30:00.000Z',
		...overrides
	};
}

/** The value of `autocapitalize` of a field, null without one. */
function capitalization(field: Element): string | null {
	return field.getAttribute('autocapitalize');
}

describe.each(WINDOWS)('titles and comments %s (MO-7a)', (_name, narrow, enabled, expected) => {
	it('the title of "Neues Ticket" and the titles of its sub-tasks', async () => {
		useWindow(narrow, enabled);
		render(NewTicketForm, {
			props: {
				oncreate: vi.fn(),
				oncreated: vi.fn(),
				oncancel: vi.fn(),
				extrasAvailable: true,
				storage: null
			}
		});
		expect(capitalization(screen.getByLabelText('Titel'))).toBe(expected);
		await fireEvent.click(screen.getByRole('button', { name: /^Weitere Optionen/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		expect(capitalization(screen.getByLabelText(/^Titel der Unteraufgabe 1/))).toBe(expected);
	});

	it('the list of sub-tasks of a template', () => {
		useWindow(narrow, enabled);
		render(TemplateSubtaskList, {
			props: { subtasks: [{ title: 'Belege sortieren', priority: 'medium' }] }
		});
		expect(capitalization(screen.getByLabelText(/^Titel der Unteraufgabe 1/))).toBe(expected);
	});

	it('the title of the ticket while it is edited', async () => {
		useWindow(narrow, enabled);
		const data = {
			get: vi.fn(async () => ticket()),
			update: vi.fn(
				async (_id: string, patch: TicketPatch) => ({ ...ticket(), ...patch }) as Ticket
			),
			create: vi.fn(),
			delete: vi.fn()
		} satisfies TicketDetailData;
		const list = {
			find: () => null,
			upsert: vi.fn(),
			completed: vi.fn(),
			remove: vi.fn(),
			announce: vi.fn(),
			subtasksOf: () => []
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		render(EditableTitle, { props: { store, headingId: 'heading' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Titel bearbeiten' }));
		await tick();
		expect(capitalization(screen.getByRole('textbox', { name: 'Titel' }))).toBe(expected);
	});

	it('the title of a new sub-task of a ticket', async () => {
		useWindow(narrow, enabled);
		const parent: TicketSummary = ticket({ id: 'parent000000001', key: 'HAUS-12' });
		const data = {
			listOpen: vi.fn(async () => [parent]),
			listSubtasks: vi.fn(async () => []),
			searchOpen: vi.fn(async () => []),
			setDone: vi.fn(),
			update: vi.fn(),
			create: vi.fn()
		} satisfies TicketListData;
		const list = new TicketListStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			{ flags: new FlagStore() }
		);
		list.activate(EMPTY_LIST_QUERY);
		await vi.waitFor(() => expect(list.openState).toBe('ready'));
		render(TicketSubtasks, {
			props: {
				ticket: parent,
				list,
				hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname
			}
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		expect(capitalization(screen.getByRole('textbox', { name: 'Titel der Unteraufgabe' }))).toBe(
			expected
		);
	});

	it('the titles of "Ticket duplizieren" and "Folge-Ticket anlegen"', () => {
		useWindow(narrow, enabled);
		const duplicates = {
			offersAreas: false,
			subtaskStatusSupport: 'unknown',
			subtaskStatusProblem: null,
			subtaskStatusLoading: false,
			loadSupport: vi.fn()
		} as unknown as TicketDuplicateStore;
		const { unmount } = render(DuplicateDialog, {
			props: {
				ticket: ticket(),
				projects: [],
				household: null,
				store: duplicates,
				onopen: vi.fn(),
				onclose: vi.fn()
			}
		});
		expect(capitalization(screen.getByLabelText('Titel'))).toBe(expected);
		unmount();

		render(FollowUpDialog, {
			props: {
				ticket: ticket(),
				store: {} as TicketFollowUpStore,
				onopen: vi.fn(),
				onclose: vi.fn()
			}
		});
		expect(capitalization(screen.getByLabelText('Titel'))).toBe(expected);
	});

	it('the new comment, in the editor and in its Markdown field', async () => {
		useWindow(narrow, enabled);
		let text = '';
		const activity = {
			get newComment() {
				return text;
			},
			setNewComment: (value: string) => (text = value),
			posting: false,
			postError: null,
			postProblem: null,
			postNote: null,
			post: vi.fn(async () => true)
		} as unknown as TicketActivityStore;
		render(CommentForm, { props: { store: activity } });
		await fireEvent.click(screen.getByRole('button', { name: 'Kommentar hinzufügen …' }));
		const editor = await screen.findByRole(
			'textbox',
			{ name: 'Neuer Kommentar' },
			{ timeout: 5000 }
		);
		expect(capitalization(editor)).toBe(expected);
		await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
		const source = await screen.findByLabelText('Neuer Kommentar (Markdown)');
		expect(capitalization(source)).toBe(expected);
	});

	it('a comment being edited', async () => {
		useWindow(narrow, enabled);
		const comment: Comment = {
			id: 'comment00000001',
			ticket: ID,
			author: 'user00000000001',
			body: 'Bitte bis Freitag',
			created: '2026-09-02 12:30:00.000Z',
			updated: '2026-09-02 12:30:00.000Z'
		};
		let edit = comment.body;
		const activity = {
			userId: 'user00000000001',
			isKept: () => false,
			isOwn: () => true,
			isEditing: () => true,
			isBusy: () => false,
			commentError: () => null,
			commentProblem: () => null,
			editValue: () => edit,
			setEdit: (_id: string, value: string) => (edit = value)
		} as unknown as TicketActivityStore;
		render(CommentItem, {
			props: { comment, store: activity, ondeleted: vi.fn(), view: new CommentViewStore(window) }
		});
		const editor = await screen.findByRole(
			'textbox',
			{ name: 'Kommentar bearbeiten' },
			{ timeout: 5000 }
		);
		expect(capitalization(editor)).toBe(expected);
	});
});
