// Component tests for the app layout (E2 plan, package 2; E3 plan, T-18 and package 5): header on
// every page of the (app) group with the counter of tickets that are not done and "Neues Ticket",
// keep-alive for the session while it is shown, logout. The auth module is replaced by a plain
// object; its behaviour is covered in src/lib/auth.test.ts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_LIST_QUERY, type ListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { NEW_TICKET_LINK_ID } from '$lib/ticket-links';
import Layout from './+layout.svelte';

const mocks = vi.hoisted(() => {
	const stopKeepAlive = vi.fn();
	const calls: string[] = [];
	/** Topics with an active fake subscription; a stop removes its entry. */
	const subscribed: string[] = [];
	/** Last callback per topic, to send fake events. */
	const handlers: Record<string, (change: unknown) => void> = {};
	const subscribe = (topic: string) => async (onChange: (change: unknown) => void) => {
		subscribed.push(topic);
		handlers[topic] = onChange;
		return async () => {
			subscribed.splice(subscribed.indexOf(topic), 1);
		};
	};
	return {
		calls,
		stopKeepAlive,
		subscribed,
		handlers,
		session: { valid: false },
		list: { store: null as null | { activate(query: ListQuery): void } },
		live: {
			tickets: vi.fn(subscribe('tickets')),
			ticket: vi.fn(subscribe('ticket')),
			comments: vi.fn(subscribe('comments')),
			history: vi.fn(subscribe('history')),
			projects: vi.fn(subscribe('projects')),
			tags: vi.fn(subscribe('tags')),
			inbox: vi.fn(subscribe('inbox')),
			reads: vi.fn(subscribe('reads')),
			reconnected: vi.fn(subscribe('PB_CONNECT'))
		},
		goto: vi.fn(async () => {
			calls.push('goto');
		}),
		page: { url: new URL('http://localhost:3000/') },
		auth: {
			email: 'anna@example.com',
			keepAlive: vi.fn(() => stopKeepAlive),
			// Without a valid session in the fake the stores load nothing (no server in these tests);
			// the counter tests switch it on together with fake data layers.
			ensureValid: vi.fn((): boolean => mocks.session.valid),
			logout: vi.fn(() => {
				calls.push('logout');
			})
		}
	};
});

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));
vi.mock('$lib/stores/realtime', async (importOriginal) => ({
	...(await importOriginal<object>()),
	liveSource: () => mocks.live
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/ticket-list.svelte')>();
	return {
		...original,
		ticketListData: () => ({
			listOpen: async () => [ticket('t00000000000001'), ticket('t00000000000002')],
			listDone: async (page: number) => ({ items: [], page, hasMore: false }),
			searchOpen: async (): Promise<string[]> => [],
			setDone: async () => ticket('t00000000000001'),
			update: async () => ticket('t00000000000001')
		}),
		setTicketListStore: (store: InstanceType<typeof original.TicketListStore>) => {
			mocks.list.store = store;
			return original.setTicketListStore(store);
		}
	};
});
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	inboxData: () => ({
		listNew: async () => [],
		listHandled: async (_state: string, page: number) => ({ items: [], page, hasMore: false }),
		get: async () => {
			throw new Error('not used');
		},
		create: async () => {
			throw new Error('not used');
		},
		discard: async () => {
			throw new Error('not used');
		},
		restore: async () => {
			throw new Error('not used');
		},
		assign: async () => {
			throw new Error('not used');
		}
	})
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	catalogData: () => ({
		listProjects: async () => [],
		listTags: async () => [],
		createTag: async () => {
			throw new Error('not used');
		}
	})
}));

function ticket(id: string, status: TicketSummary['status'] = 'open'): TicketSummary {
	return {
		id,
		key: `TASK-${id.slice(-1)}`,
		title: `Ticket ${id}`,
		status,
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z'
	};
}

const CONTENT = 'Seiteninhalt';

async function renderLayout(path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const children = createRawSnippet(() => ({ render: () => `<p>${CONTENT}</p>` }));
	const result = render(Layout, { props: { children } });
	await tick();
	return result;
}

beforeEach(() => {
	mocks.calls.length = 0;
	mocks.goto.mockClear();
	mocks.auth.keepAlive.mockClear();
	mocks.auth.logout.mockClear();
	mocks.auth.ensureValid.mockClear();
	mocks.stopKeepAlive.mockClear();
	mocks.session.valid = false;
	mocks.list.store = null;
	for (const subscribe of Object.values(mocks.live)) subscribe.mockClear();
});

describe('app layout', () => {
	it('shows the header with app name, area switch and the signed-in user above the page', async () => {
		await renderLayout();

		const header = screen.getByRole('banner');
		expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
			'becauseyoulovejira'
		);
		expect(within(header).getByRole('group', { name: 'Bereich' })).toBeTruthy();
		expect(within(header).getByText(/^Angemeldet als/).textContent).toBe(
			'Angemeldet als anna@example.com'
		);
		expect(within(header).getByRole('button', { name: 'Abmelden' })).toBeTruthy();
		expect(within(screen.getByRole('main')).getByText(CONTENT)).toBeTruthy();
	});

	it('keeps the session alive while shown and stops when it goes away', async () => {
		const { unmount } = await renderLayout();

		expect(mocks.auth.keepAlive).toHaveBeenCalledOnce();
		expect(mocks.stopKeepAlive).not.toHaveBeenCalled();

		unmount();

		expect(mocks.stopKeepAlive).toHaveBeenCalledOnce();
		expect(mocks.auth.keepAlive).toHaveBeenCalledOnce();
	});

	it('subscribes to tickets, the catalog, the inbox and reconnections while shown and ends them when it goes away', async () => {
		const { unmount } = await renderLayout();
		await vi.waitFor(() => expect(mocks.subscribed).toHaveLength(9));

		// The list follows all tickets, the catalog all projects and tags (E3 plan, T-16), the
		// inbox all entries (E4 plan, T-4); list, panel, activity, catalog and inbox each reconcile
		// after a reconnect.
		expect([...mocks.subscribed].sort()).toEqual([
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'inbox',
			'projects',
			'tags',
			'tickets'
		]);
		expect(mocks.live.tickets).toHaveBeenCalledOnce();
		expect(mocks.live.projects).toHaveBeenCalledOnce();
		expect(mocks.live.tags).toHaveBeenCalledOnce();
		expect(mocks.live.inbox).toHaveBeenCalledOnce();
		// The catalog tries to load once when the layout is shown.
		expect(mocks.auth.ensureValid).toHaveBeenCalled();

		unmount();

		await vi.waitFor(() => expect(mocks.subscribed).toEqual([]));
	});

	it('logs out and goes to the login page with the current page as redirect', async () => {
		await renderLayout('/tickets/abc123def456ghi?erledigte=1');

		await fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));

		expect(mocks.calls).toEqual(['logout', 'goto']);
		expect(mocks.goto).toHaveBeenCalledWith(
			'/login?redirect=%2Ftickets%2Fabc123def456ghi%3Ferledigte%3D1',
			{ replaceState: true }
		);
	});

	it('logs out from the start page to the plain login page', async () => {
		await renderLayout('/');

		await fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));

		expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true });
	});

	it('offers "Neues Ticket" in the header with the current query', async () => {
		await renderLayout('/tickets/abc123def456ghi?erledigte=1');

		const link = within(screen.getByRole('banner')).getByRole('link', { name: 'Neues Ticket' });
		expect(link.getAttribute('href')).toBe('/tickets/neu?erledigte=1');
		expect(link.id).toBe(NEW_TICKET_LINK_ID);
	});

	it('shows no counter while the list is not loaded', async () => {
		await renderLayout();

		expect(within(screen.getByRole('banner')).queryByText(/nicht erledigte/)).toBeNull();
	});

	it('counts the tickets that are not done in the header and follows the store', async () => {
		mocks.session.valid = true;
		await renderLayout();
		mocks.list.store?.activate(EMPTY_LIST_QUERY);
		const header = within(screen.getByRole('banner'));

		await vi.waitFor(() => expect(header.getByText('2 nicht erledigte Tickets')).toBeTruthy());
		expect(header.getByText('2', { selector: '[aria-hidden="true"]' })).toBeTruthy();

		// A realtime event: one ticket is done now.
		await vi.waitFor(() => expect(mocks.handlers.tickets).toBeDefined());
		mocks.handlers.tickets?.({
			action: 'update',
			record: { ...ticket('t00000000000002', 'done'), updated: '2026-09-24 10:00:00.000Z' }
		});
		await tick();

		expect(header.getByText('1 nicht erledigtes Ticket')).toBeTruthy();
	});

	it('keeps the login page outside the (app) group, so it has no header', () => {
		const routes = join(import.meta.dirname, '..');
		expect(existsSync(join(routes, 'login', '+page.svelte'))).toBe(true);
		expect(existsSync(join(import.meta.dirname, 'login'))).toBe(false);
		expect(existsSync(join(routes, '+page.svelte'))).toBe(false);
		// The route / exists only as the ticket list (E2 plan, package 5).
		expect(existsSync(join(import.meta.dirname, '+page.svelte'))).toBe(false);
		expect(existsSync(join(import.meta.dirname, '(tickets)', '+page.svelte'))).toBe(true);
	});
});

describe('app layout: quick entry keys (E4 plan, T-11 and package 6)', () => {
	const nativeShowModal = HTMLDialogElement.prototype.showModal;

	beforeEach(() => {
		if (typeof nativeShowModal !== 'function') {
			HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
				this.open = true;
			};
		}
	});

	afterEach(() => {
		HTMLDialogElement.prototype.showModal = nativeShowModal;
	});

	const quick = () => screen.queryByRole('dialog', { name: 'Schnellerfassung' });

	/** Sends a key to `target` and tells whether the default action was prevented. */
	function press(target: EventTarget, init: KeyboardEventInit): boolean {
		const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(event);
		return event.defaultPrevented;
	}

	it('opens with c on the page', async () => {
		await renderLayout();
		expect(quick()).toBeNull();
		expect(press(document.body, { key: 'c' })).toBe(true);
		await tick();
		expect(quick()).not.toBeNull();
	});

	it('opens with Ctrl+K and prevents the search of the browser only then', async () => {
		await renderLayout();
		expect(press(document.body, { key: 'k', ctrlKey: true })).toBe(true);
		await tick();
		expect(quick()).not.toBeNull();
		// Open already: the key belongs to the dialog, the browser keeps it.
		const input = screen.getByLabelText('Titel mit Kurzsyntax');
		expect(press(input, { key: 'k', ctrlKey: true })).toBe(false);
	});

	it('does not open in input fields, the tag picker, dialogs and open popovers', async () => {
		await renderLayout();
		const main = screen.getByRole('main');
		const field = document.createElement('input');
		const combobox = document.createElement('div');
		combobox.setAttribute('role', 'combobox');
		combobox.tabIndex = 0;
		main.append(field, combobox);
		expect(press(field, { key: 'c' })).toBe(false);
		expect(press(combobox, { key: 'k', ctrlKey: true })).toBe(false);

		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		main.append(dialog);
		expect(press(document.body, { key: 'c' })).toBe(false);
		dialog.remove();

		const popover = document.createElement('div');
		popover.setAttribute('popover', 'auto');
		Object.defineProperty(popover, 'matches', {
			value: (selector: string) => selector === ':popover-open'
		});
		main.append(popover);
		expect(press(document.body, { key: 'c' })).toBe(false);
		popover.remove();

		await tick();
		expect(quick()).toBeNull();
	});

	it('opens from the button in the header and closes with "Schließen"', async () => {
		await renderLayout();
		const button = within(screen.getByRole('banner')).getByRole('button', {
			name: /Schnellerfassung/
		});
		expect(button.getAttribute('aria-keyshortcuts')).toBe('C Control+K');
		await fireEvent.click(button);
		expect(quick()).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(quick()).toBeNull();
	});
});
