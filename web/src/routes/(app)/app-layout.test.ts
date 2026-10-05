// Component tests for the app layout (E2 plan, package 2; E3 plan, T-18 and package 5): header on
// every page of the (app) group with the counter of tickets that are not done and "Neues Ticket",
// keep-alive for the session while it is shown, logout. The auth module is replaced by a plain
// object; its behaviour is covered in src/lib/auth.test.ts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppHeader from '$lib/components/AppHeader.svelte';
import { EMPTY_LIST_QUERY, type ListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { pb } from '$lib/pocketbase';
import { appContext } from '$lib/stores/context.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
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
			reconnected: vi.fn(subscribe('PB_CONNECT')),
			// Recurrence rules have their own small live source (E5 plan, package 4).
			rules: vi.fn(subscribe('rules')),
			// Messages of start.bat, the landing page and stop.bat (ADR-0035 section 5).
			attention: vi.fn(subscribe('byl/attention')),
			// Changes of the trash (ADR-0037).
			trash: vi.fn(subscribe('byl/trash')),
			// Names of the connections for inbox and sources (ADR-0026, addendum KK-3).
			connections: vi.fn(subscribe('connections')),
			// Names of the visible accounts for comments, history and trash (ADR-0056 §4).
			people: vi.fn(subscribe('users')),
			// Changes of the household and of the memberships (ADR-0058).
			household: vi.fn(subscribe('byl/household')),
			// The own pinned tickets (ADR-0064).
			pins: vi.fn(subscribe('ticket_pins'))
		},
		goto: vi.fn(async () => {
			calls.push('goto');
		}),
		// Callbacks of afterNavigate (the way back of the settings, EH-1), called by the tests.
		afterNavigate: [] as ((navigation: { to: { url: URL } | null }) => void)[],
		page: {
			url: new URL('http://localhost:3000/'),
			route: { id: '/(app)/(tickets)' as string | null },
			params: {} as Record<string, string>
		},
		auth: {
			email: 'anna@example.com',
			// Without an account ID the area store has no area (ADR-0059): every request as before.
			userId: undefined as string | undefined,
			// The administrator of the app (ADR-0056): it asks for the notices of backups and sign-ins.
			isAdmin: true,
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

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	afterNavigate: (callback: (navigation: { to: { url: URL } | null }) => void) => {
		mocks.afterNavigate.push(callback);
	},
	// The hint after a new build (ADR-0040) is covered in app-update-notice.test.ts.
	onNavigate: () => undefined
}));
vi.mock('$app/state', () => ({ page: mocks.page, updated: { current: false } }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));
// The tour itself is covered in lib/tour/tour.test.ts; here only how the layout starts it (EH-13).
const tourMocks = vi.hoisted(() => ({
	startTour: vi.fn<(deps: unknown) => Promise<null>>(async () => null)
}));
vi.mock('$lib/tour/tour', () => ({ startTour: tourMocks.startTour }));
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
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	recurrenceData: () => ({
		listRules: async () => [],
		createRule: async () => {
			throw new Error('not used');
		},
		updateRule: async () => {
			throw new Error('not used');
		},
		setActive: async () => {
			throw new Error('not used');
		},
		deleteRule: async () => {
			throw new Error('not used');
		},
		detachTicket: async () => {
			throw new Error('not used');
		}
	}),
	recurrenceLive: () => ({ rules: mocks.live.rules, reconnected: mocks.live.reconnected })
}));
vi.mock('$lib/stores/trash.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	trashData: () => ({
		list: async () => ({ items: [], retention: '30' }),
		preview: async () => {
			throw new Error('not used');
		},
		restore: async () => {
			throw new Error('not used');
		},
		purge: async () => {
			throw new Error('not used');
		},
		purgeAll: async () => {
			throw new Error('not used');
		},
		saveRetention: async () => {
			throw new Error('not used');
		}
	}),
	trashLive: () => ({ changes: mocks.live.trash, reconnected: mocks.live.reconnected })
}));
vi.mock('$lib/stores/attention.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	attentionSource: () => ({
		attention: mocks.live.attention,
		reconnected: mocks.live.reconnected
	})
}));
const attentionMocks = vi.hoisted(() => ({
	ack: vi.fn<(pb: unknown, nonce: string) => Promise<void>>(async () => undefined)
}));
vi.mock('$lib/data/attention', async (importOriginal) => ({
	...(await importOriginal<object>()),
	ackAttention: attentionMocks.ack
}));
// Context of the tab (KOB-1, ADR-0057) and the notices of the administrator when the app opens.
const contextMocks = vi.hoisted(() => ({
	who: 'pc' as 'pc' | 'remote' | 'member',
	fetchContext: vi.fn(),
	// Nothing to say: no flag, only the question.
	backup: vi.fn(async () => false),
	security: vi.fn(async () => null)
}));
vi.mock('$lib/data/context', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchContext: contextMocks.fetchContext.mockImplementation(async () => {
		const admin = contextMocks.who !== 'member';
		const local = contextMocks.who !== 'remote';
		return {
			kind: 'ready',
			context: {
				admin,
				local,
				platform: 'windows',
				scripts: admin && local,
				localUrl: admin ? 'http://127.0.0.1:8090' : null
			}
		};
	})
}));
vi.mock('$lib/data/backup', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchBackupAttention: contextMocks.backup
}));
vi.mock('$lib/data/security', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchSecurityNotice: contextMocks.security
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
// Names of the connections for inbox and sources (ADR-0026, addendum KK-3): none in these tests.
vi.mock('$lib/stores/connection-names.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	connectionNamesData: () => ({
		list: async () => [],
		subscribe: mocks.live.connections,
		reconnected: mocks.live.reconnected
	})
}));
// Names of the visible accounts (ADR-0056 §4): none in these tests.
vi.mock('$lib/stores/people.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	peopleData: () => ({
		list: async () => [],
		subscribe: mocks.live.people,
		reconnected: mocks.live.reconnected
	})
}));
// The own pinned tickets (ADR-0064): none in these tests.
vi.mock('$lib/stores/pins.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	pinData: () => ({
		list: async () => [],
		pin: async () => null,
		unpin: async () => undefined,
		subscribe: mocks.live.pins,
		reconnected: mocks.live.reconnected
	})
}));
// The household of the account (ADR-0058): none unless a test gives one; a reload is only counted.
const householdMocks = vi.hoisted(() => ({
	answers: [] as unknown[],
	fetch: vi.fn(),
	reload: vi.fn()
}));
vi.mock('$lib/page-reload', async (importOriginal) => ({
	...(await importOriginal<object>()),
	reloadPage: householdMocks.reload
}));
vi.mock('$lib/stores/household.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	householdData: () => ({
		fetch: householdMocks.fetch.mockImplementation(async () => ({
			kind: 'ok',
			value:
				householdMocks.answers.length > 1
					? householdMocks.answers.shift()
					: (householdMocks.answers[0] ?? null)
		}))
	}),
	householdLive: () => ({ changes: mocks.live.household, reconnected: mocks.live.reconnected })
}));
// The area of a record a link opens (E7-3, ADR-0059 §7): what the server would answer.
const areaMocks = vi.hoisted(() => ({
	recordScope: vi.fn<(pb: unknown, kind: string, id: string) => Promise<string | null>>(
		async () => null
	)
}));
vi.mock('$lib/data/area', async (importOriginal) => ({
	...(await importOriginal<object>()),
	recordScope: areaMocks.recordScope
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
	mocks.afterNavigate.length = 0;
	mocks.goto.mockClear();
	mocks.auth.keepAlive.mockClear();
	mocks.auth.logout.mockClear();
	mocks.auth.ensureValid.mockClear();
	mocks.stopKeepAlive.mockClear();
	mocks.session.valid = false;
	mocks.list.store = null;
	for (const subscribe of Object.values(mocks.live)) subscribe.mockClear();
	householdMocks.answers = [];
	householdMocks.fetch.mockClear();
	householdMocks.reload.mockClear();
	areaMocks.recordScope.mockClear();
	mocks.auth.userId = undefined;
	mocks.page.route.id = '/(app)/(tickets)';
	mocks.page.params = {};
});

describe('app layout', () => {
	it('shows the header with app name and the signed-in user above the page, and only "Privat" while the household is not known', async () => {
		await renderLayout();

		const header = screen.getByRole('banner');
		expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
			'becauseyoulovejira'
		);
		// No household known yet (E7-3, ADR-0059 §1 and addendum "+"): no choice, only "Privat" as the
		// current area, and no "+" while the household store has not answered.
		const area = within(header).getByRole('group', { name: 'Bereich' });
		expect(area.querySelector('[aria-current="true"]')?.textContent?.trim()).toBe('Privat');
		expect(within(area).queryByRole('button')).toBeNull();
		expect(
			within(header).queryByRole('link', { name: 'Haushalt gründen oder beitreten' })
		).toBeNull();
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

	it('subscribes to tickets, the catalog, the inbox, the rules, the attention messages and reconnections while shown and ends them when it goes away', async () => {
		const { unmount } = await renderLayout();
		await vi.waitFor(() => expect(mocks.subscribed).toHaveLength(26));

		// The list follows all tickets, the catalog all projects and tags (E3 plan, T-16), the
		// inbox all entries (E4 plan, T-4) and so do the sources of the open ticket (ADR-0031), the
		// rules all rules (E5 plan, T-7); list, panel, activity, catalog, inbox, sources and rules
		// each reconcile after a reconnect. The hint of start.bat listens on byl/attention and drops
		// the flag "beendet" after a reconnect (ADR-0035 section 5). The trash reads its list again
		// on byl/trash and after a reconnect (ADR-0037). The names of the connections follow their
		// renames and load again after a reconnect (ADR-0026, addendum KK-3), and so do the names of
		// the visible accounts (ADR-0056 §4) and the household (byl/household, ADR-0058). The context
		// of the tab asks again after a reconnect (KOB-1, ADR-0057). The own pins follow their changes
		// and load again after a reconnect (ADR-0064).
		expect([...mocks.subscribed].sort()).toEqual([
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'PB_CONNECT',
			'byl/attention',
			'byl/household',
			'byl/trash',
			'connections',
			'inbox',
			'inbox',
			'projects',
			'rules',
			'tags',
			'ticket_pins',
			'tickets',
			'users'
		]);
		expect(mocks.live.tickets).toHaveBeenCalledOnce();
		expect(mocks.live.projects).toHaveBeenCalledOnce();
		expect(mocks.live.tags).toHaveBeenCalledOnce();
		expect(mocks.live.inbox).toHaveBeenCalledTimes(2);
		expect(mocks.live.rules).toHaveBeenCalledOnce();
		expect(mocks.live.trash).toHaveBeenCalledOnce();
		expect(mocks.live.connections).toHaveBeenCalledOnce();
		expect(mocks.live.people).toHaveBeenCalledOnce();
		expect(mocks.live.household).toHaveBeenCalledOnce();
		expect(mocks.live.pins).toHaveBeenCalledOnce();
		// The catalog tries to load once when the layout is shown.
		expect(mocks.auth.ensureValid).toHaveBeenCalled();

		unmount();

		await vi.waitFor(() => expect(mocks.subscribed).toEqual([]));
	});

	it('keeps the page when the membership ends, lands in "Privat" and says why (ADR-0059 §8)', async () => {
		mocks.session.valid = true;
		mocks.auth.userId = 'user00000000001';
		// This device remembered the household as the area of the account.
		localStorage.setItem('byl-area:user00000000001', 'household:house0000000001');
		const state = {
			household: {
				id: 'house0000000001',
				name: 'Haus Beispiel',
				created: '',
				trashRetention: '30'
			},
			me: { member: 'member00000001', role: 'member', rights: [] },
			members: [],
			invites: null
		};
		householdMocks.answers = [state, null];
		await renderLayout('/einstellungen/haushalt');
		const header = screen.getByRole('banner');
		await vi.waitFor(() =>
			expect(within(header).getByRole('button', { name: 'Haus Beispiel' })).toBeTruthy()
		);
		expect(
			within(header).getByRole('button', { name: 'Haus Beispiel' }).getAttribute('aria-pressed')
		).toBe('true');
		await vi.waitFor(() => expect(mocks.subscribed).toContain('byl/household'));

		// Another member removes this account: the server reports it on byl/household.
		mocks.handlers['byl/household']?.({});
		await vi.waitFor(() =>
			expect(
				screen.getAllByText('Du bist nicht mehr Mitglied im Haushalt „Haus Beispiel“.').length
			).toBeGreaterThan(0)
		);
		expect(screen.getAllByText('Du bist jetzt im Bereich Privat.').length).toBeGreaterThan(0);
		// No page reload: what was typed stays; the switch goes with the household, and the "+" to a
		// household is back (addendum "+" of ADR-0059).
		expect(householdMocks.reload).not.toHaveBeenCalled();
		expect(within(header).queryByRole('button', { name: 'Haus Beispiel' })).toBeNull();
		expect(
			within(header)
				.getByRole('link', { name: 'Haushalt gründen oder beitreten' })
				.getAttribute('href')
		).toBe('/einstellungen/haushalt');
		expect(localStorage.getItem('byl-area:user00000000001')).toBe('private');
		localStorage.removeItem('byl-area:user00000000001');
	});

	it('offers the "+" to a household without one and drops it when the account joins, without a reload', async () => {
		mocks.session.valid = true;
		mocks.auth.userId = 'user00000000001';
		const state = {
			household: {
				id: 'house0000000001',
				name: 'Haus Beispiel',
				created: '',
				trashRetention: '30'
			},
			me: { member: 'member00000001', role: 'member', rights: [] },
			members: [],
			invites: null
		};
		// First no household, then the account joined in another tab.
		householdMocks.answers = [null, state];
		await renderLayout('/einstellungen/haushalt');
		const header = screen.getByRole('banner');
		const add = await vi.waitFor(() =>
			within(header).getByRole('link', { name: 'Haushalt gründen oder beitreten' })
		);
		expect(add.getAttribute('href')).toBe('/einstellungen/haushalt');
		expect(add.getAttribute('title')).toBe('Haushalt gründen oder beitreten');
		expect(
			within(header)
				.getByRole('group', { name: 'Bereich' })
				.querySelector('[aria-current="true"]')
				?.textContent?.trim()
		).toBe('Privat');
		await vi.waitFor(() => expect(mocks.subscribed).toContain('byl/household'));

		mocks.handlers['byl/household']?.({});
		await vi.waitFor(() =>
			expect(within(header).getByRole('button', { name: 'Haus Beispiel' })).toBeTruthy()
		);
		expect(
			within(header).queryByRole('link', { name: 'Haushalt gründen oder beitreten' })
		).toBeNull();
		expect(
			within(header).getByRole('button', { name: 'Privat' }).getAttribute('aria-pressed')
		).toBe('true');
		expect(householdMocks.reload).not.toHaveBeenCalled();
		localStorage.removeItem('byl-area:user00000000001');
	});

	it('switches to the area of a record a link opens and says so; a record it cannot see changes nothing (ADR-0059 §7)', async () => {
		mocks.session.valid = true;
		mocks.auth.userId = 'user00000000001';
		const state = {
			household: {
				id: 'house0000000001',
				name: 'Haus Beispiel',
				created: '',
				trashRetention: '30'
			},
			me: { member: 'member00000001', role: 'member', rights: [] },
			members: [],
			invites: null
		};
		householdMocks.answers = [state];
		await renderLayout('/tickets/ticket000000001');
		const header = screen.getByRole('banner');
		await vi.waitFor(() =>
			expect(within(header).getByRole('button', { name: 'Haus Beispiel' })).toBeTruthy()
		);
		expect(
			within(header).getByRole('button', { name: 'Privat' }).getAttribute('aria-pressed')
		).toBe('true');

		// Not visible for the account: "nicht gefunden" stays, the area too.
		mocks.page.route.id = '/(app)/(tickets)/tickets/[id]';
		mocks.page.params = { id: 'ticket000000009' };
		areaMocks.recordScope.mockResolvedValueOnce(null);
		for (const callback of mocks.afterNavigate) callback({ to: { url: mocks.page.url } });
		await vi.waitFor(() =>
			expect(areaMocks.recordScope).toHaveBeenLastCalledWith(
				expect.anything(),
				'ticket',
				'ticket000000009'
			)
		);
		expect(
			within(header).getByRole('button', { name: 'Privat' }).getAttribute('aria-pressed')
		).toBe('true');

		// A ticket of the household: the area follows without a navigation.
		mocks.page.params = { id: 'ticket000000001' };
		areaMocks.recordScope.mockResolvedValueOnce('h:house0000000001');
		mocks.goto.mockClear();
		for (const callback of mocks.afterNavigate) callback({ to: { url: mocks.page.url } });
		await vi.waitFor(() =>
			expect(
				within(header).getByRole('button', { name: 'Haus Beispiel' }).getAttribute('aria-pressed')
			).toBe('true')
		);
		expect(screen.getAllByText('Zum Bereich Haus Beispiel gewechselt.').length).toBeGreaterThan(0);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(localStorage.getItem('byl-area:user00000000001')).toBe('household:house0000000001');
		localStorage.removeItem('byl-area:user00000000001');
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

	it('leads from the app name to "Aufgaben" (EH-1)', async () => {
		await renderLayout('/eingang?quelle=mail');

		const heading = within(screen.getByRole('banner')).getByRole('heading', { level: 1 });
		const link = within(heading).getByRole('link', { name: 'becauseyoulovejira' });
		expect(link.getAttribute('href')).toBe('/');
	});

	it('offers the settings as a gear icon button, current in the settings (EH-1)', async () => {
		await renderLayout('/?status=open');

		const header = within(screen.getByRole('banner'));
		const gear = header.getByRole('link', { name: 'Einstellungen' });
		expect(gear.getAttribute('href')).toBe('/einstellungen/kanaele');
		expect(gear.classList.contains('button-icon')).toBe(true);
		expect(gear.getAttribute('title')).toBe('Einstellungen');
		expect(gear.textContent?.trim()).toBe('');
		expect(gear.hasAttribute('aria-current')).toBe(false);
		expect(header.queryByRole('link', { name: 'Kanäle' })).toBeNull();

		document.body.innerHTML = '';
		await renderLayout('/einstellungen/datei-importe');
		expect(
			within(screen.getByRole('banner'))
				.getByRole('link', { name: 'Einstellungen' })
				.getAttribute('aria-current')
		).toBe('page');
	});

	it('remembers the views for the way back from the settings (EH-1)', async () => {
		sessionStorage.clear();
		await renderLayout('/');
		const navigate = (path: string) => {
			for (const callback of mocks.afterNavigate) {
				callback({ to: { url: new URL(path, 'http://localhost:3000') } });
			}
		};

		navigate('/tickets/abc123def456ghi?status=open');
		navigate('/einstellungen/kanaele');
		navigate('/tickets/abc123def456ghi/voll?status=open');

		expect(sessionStorage.getItem('byl-last-view')).toBe('/tickets/abc123def456ghi?status=open');
		sessionStorage.clear();
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

	it('makes the header inert while a side panel covers the view (UI-6b)', () => {
		render(AppHeader, { props: { covered: true } });
		expect(screen.getByRole('banner', { hidden: true }).inert).toBe(true);
		document.body.innerHTML = '';
		render(AppHeader, { props: { covered: false } });
		expect(screen.getByRole('banner').inert).toBe(false);
	});

	it('hands its height to the embedded side panel and removes it when it goes away', async () => {
		const observers: (() => void)[] = [];
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					observers.push(callback);
				}
				observe() {}
				disconnect() {}
			}
		);
		try {
			const { unmount } = render(AppHeader);
			await tick();
			const banner = screen.getByRole('banner');
			Object.defineProperty(banner, 'offsetHeight', { configurable: true, value: 57 });
			for (const callback of observers) callback();
			const root = document.documentElement;
			expect(root.style.getPropertyValue('--app-header-height')).toBe('57px');
			unmount();
			expect(root.style.getPropertyValue('--app-header-height')).toBe('');
		} finally {
			vi.unstubAllGlobals();
		}
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
	useOverlayStubs();

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

	it('counts opening the quick entry as the first step "Schnellerfassung ausprobieren" (EH-12)', async () => {
		localStorage.clear();
		await renderLayout();
		expect(localStorage.getItem('byl-first-steps')).toBeNull();
		press(document.body, { key: 'c' });
		await tick();
		expect(JSON.parse(localStorage.getItem('byl-first-steps') ?? '{}')).toEqual({
			dismissed: false,
			reached: ['quick']
		});
		localStorage.clear();
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

describe('app layout: shortcuts and help menu (EH-9)', () => {
	useOverlayStubs();

	const modal = () => screen.queryByRole('dialog', { name: 'Tastaturkürzel' });

	function press(target: EventTarget, init: KeyboardEventInit): boolean {
		const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
		target.dispatchEvent(event);
		return event.defaultPrevented;
	}

	it('opens the modal "Tastaturkürzel" with ? (Shift+ß) on the page', async () => {
		await renderLayout();
		expect(modal()).toBeNull();
		expect(press(document.body, { key: '?', shiftKey: true })).toBe(true);
		await tick();
		expect(modal()).not.toBeNull();
		// Open already: a second ? belongs to the dialog.
		expect(press(document.body, { key: '?', shiftKey: true })).toBe(false);
		const closers = screen.getAllByRole('button', { name: 'Schließen' });
		await fireEvent.click(closers[closers.length - 1] as HTMLElement);
		expect(modal()).toBeNull();
	});

	it('does not open with ? in input fields, dialogs and open popovers', async () => {
		await renderLayout();
		const main = screen.getByRole('main');
		const field = document.createElement('input');
		main.append(field);
		expect(press(field, { key: '?', shiftKey: true })).toBe(false);

		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		main.append(dialog);
		expect(press(document.body, { key: '?', shiftKey: true })).toBe(false);
		dialog.remove();

		const popover = document.createElement('div');
		popover.setAttribute('popover', 'auto');
		Object.defineProperty(popover, 'matches', {
			value: (selector: string) => selector === ':popover-open'
		});
		main.append(popover);
		expect(press(document.body, { key: '?', shiftKey: true })).toBe(false);
		popover.remove();

		await tick();
		expect(modal()).toBeNull();
	});

	it('offers the help menu "?" between "Neues Ticket" and the gear, and opens the modal from it', async () => {
		await renderLayout();
		const header = within(screen.getByRole('banner'));
		const button = header.getByRole('button', { name: 'Hilfe' });
		const controls = [
			...screen.getByRole('banner').querySelectorAll<HTMLElement>('a, button')
		].filter((element) => element.closest('[popover]') === null);
		const names = controls.map(
			(element) => element.getAttribute('aria-label') ?? element.textContent?.trim()
		);
		expect(names.indexOf('Hilfe')).toBe(names.indexOf('Neues Ticket') + 1);
		expect(names.indexOf('Einstellungen')).toBe(names.indexOf('Hilfe') + 1);

		await fireEvent.click(button);
		await tick();
		await fireEvent.click(screen.getByRole('menuitem', { hidden: true, name: /Tastaturkürzel/ }));
		await tick();
		expect(modal()).not.toBeNull();
	});
});

describe('app layout: guided tour (EH-13)', () => {
	useOverlayStubs();

	it('starts the tour only from "Kurze Einführung", with the button as trigger, and counts the step', async () => {
		localStorage.clear();
		tourMocks.startTour.mockClear();
		await renderLayout('/projekte');
		await tick();
		// Never on its own, also not on the first visit.
		expect(tourMocks.startTour).not.toHaveBeenCalled();

		const button = within(screen.getByRole('banner')).getByRole('button', { name: 'Hilfe' });
		await fireEvent.click(button);
		await tick();
		await fireEvent.click(screen.getByRole('menuitem', { hidden: true, name: 'Kurze Einführung' }));
		await tick();

		expect(tourMocks.startTour).toHaveBeenCalledOnce();
		const deps = tourMocks.startTour.mock.calls[0]?.[0] as unknown as {
			trigger: HTMLElement | null;
			currentPath: () => string;
			navigate: (path: string) => Promise<unknown>;
			reducedMotion: () => boolean;
		};
		expect(deps.trigger).toBe(button);
		expect(deps.currentPath()).toBe('/projekte');
		await deps.navigate('/einstellungen/kanaele');
		expect(mocks.goto).toHaveBeenLastCalledWith('/einstellungen/kanaele');
		expect(typeof deps.reducedMotion()).toBe('boolean');
		expect(JSON.parse(localStorage.getItem('byl-first-steps') ?? '{}').reached).toContain('tour');
		localStorage.clear();
	});
});

describe('app layout: opened again (ADR-0035 section 5)', () => {
	const NONCE = 'Ab3dEf6hIj9kLm2nOp5qRs8t';

	it('confirms a message of start.bat and shows the flag', async () => {
		attentionMocks.ack.mockClear();
		await renderLayout();
		await vi.waitFor(() => expect(mocks.subscribed).toContain('byl/attention'));

		mocks.handlers['byl/attention']?.({ nonce: NONCE, reason: 'start' });
		await tick();

		expect(attentionMocks.ack).toHaveBeenCalledOnce();
		expect(attentionMocks.ack.mock.calls[0]?.[1]).toBe(NONCE);
		expect(screen.getByText('Du hast becauseyoulovejira erneut geöffnet.')).toBeTruthy();
	});

	it('says "beendet" for stop.bat and a restart without a confirmation', async () => {
		attentionMocks.ack.mockClear();
		await renderLayout();
		await vi.waitFor(() => expect(mocks.subscribed).toContain('byl/attention'));

		mocks.handlers['byl/attention']?.({ nonce: NONCE, reason: 'stop' });
		await tick();

		expect(attentionMocks.ack).not.toHaveBeenCalled();
		expect(screen.getByText('becauseyoulovejira wurde beendet.')).toBeTruthy();
	});
});

describe('app layout: context of the tab (KOB-1, ADR-0057)', () => {
	afterEach(() => {
		pb.authStore.clear();
		contextMocks.who = 'pc';
	});

	it.each([
		['the administrator at the PC', 'pc' as const, 1],
		['the administrator on another device', 'remote' as const, 0],
		['another account', 'member' as const, 0]
	])(
		'asks for the notices of backups and sign-ins only for the administrator at the PC: %s',
		async (_who, who, asked) => {
			contextMocks.who = who;
			contextMocks.fetchContext.mockClear();
			contextMocks.backup.mockClear();
			contextMocks.security.mockClear();
			pb.authStore.save('token', { id: 'u0000000000000a', collectionName: 'users' } as never);
			await renderLayout();
			await vi.waitFor(() => expect(contextMocks.fetchContext).toHaveBeenCalledOnce());
			await vi.waitFor(() => expect(appContext.capabilities.mode).toBe(who));
			await tick();
			expect(contextMocks.backup).toHaveBeenCalledTimes(asked);
			expect(contextMocks.security).toHaveBeenCalledTimes(asked);
		}
	);

	it('asks for the context again once the server is back after the restart after an update', async () => {
		// The session comes from the storage; the server before the restart does not know the route.
		contextMocks.fetchContext.mockClear();
		contextMocks.fetchContext.mockResolvedValueOnce({ kind: 'outdated' });
		pb.authStore.save('token', { id: 'u0000000000000a', collectionName: 'users' } as never);
		await renderLayout();
		await vi.waitFor(() => expect(appContext.capabilities.mode).toBe('outdated'));
		await vi.waitFor(() => expect(mocks.subscribed).toHaveLength(26));

		for (const [reconnected] of mocks.live.reconnected.mock.calls) reconnected(undefined);
		await vi.waitFor(() => expect(appContext.capabilities.mode).toBe('pc'));
		expect(contextMocks.fetchContext).toHaveBeenCalledTimes(2);
		expect(appContext.capabilities.adminPages).toBe('full');
	});

	it('goes back to the most restrictive view when the layout goes away', async () => {
		pb.authStore.save('token', { id: 'u0000000000000a', collectionName: 'users' } as never);
		const { unmount } = await renderLayout();
		await vi.waitFor(() => expect(appContext.capabilities.mode).toBe('pc'));
		unmount();
		expect(appContext.capabilities.mode).toBe('pending');
	});
});
