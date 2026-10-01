// "Alle Kanäle jetzt abrufen" (testing feedback package A, item 4): the store runs every
// switched-on connection one after the other with live status and ends with one flag; the button
// is busy meanwhile. Fakes instead of PocketBase (the route itself: mailbox-route.test.mjs).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Connection, RunResult } from '$lib/domain/connections';
import SyncAllButton from '$lib/components/SyncAllButton.svelte';
import { FlagStore } from './flags.svelte';
import { SyncAllStore, type SyncAllData } from './sync-all.svelte';

function connection(id: string, label: string, overrides: Partial<Connection> = {}): Connection {
	return {
		id,
		type: 'calendar',
		label,
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: ['todo'],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

const OK: RunResult = {
	status: 'ok',
	created: 0,
	duplicates: 0,
	updated: 0,
	skipped: 0,
	failed: 0,
	unmatched: 0,
	error: '',
	missing: []
};

const CAL = connection('conn00000000001', 'Kalender');
const MAIL = connection('conn00000000002', 'Web.de', { type: 'mail', mailProvider: 'webde' });
const PAUSED = connection('conn00000000003', 'Bot', { type: 'telegram', enabled: false });

function setup(items: Connection[] = [CAL, MAIL, PAUSED]) {
	const data = {
		list: vi.fn<SyncAllData['list']>(async () => items),
		run: vi.fn<SyncAllData['run']>(async () => OK)
	} satisfies SyncAllData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	const navigate = { card: vi.fn(), channels: vi.fn() };
	return {
		store: new SyncAllStore(data, session, flags, navigate),
		data,
		session,
		flags,
		navigate
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('SyncAllStore', () => {
	it('runs the switched-on connections one after the other and announces "N neue"', async () => {
		const context = setup();
		const first = deferred<RunResult>();
		context.data.run
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce({ ...OK, created: 1 });
		const running = context.store.runAll();
		await vi.waitFor(() =>
			expect(context.store.status).toBe('„Kalender“ wird abgerufen (1 von 2) …')
		);
		expect(context.store.running).toBe(true);
		expect(context.data.run).toHaveBeenCalledTimes(1);
		first.resolve({ ...OK, created: 2 });
		await running;
		expect(context.data.run.mock.calls.map(([id]) => id)).toEqual([CAL.id, MAIL.id]);
		expect(context.store.running).toBe(false);
		expect(context.flags.flags[0]).toMatchObject({
			tone: 'success',
			title: '2 Kanäle abgerufen: 3 neue.',
			action: null
		});
	});

	it('says "keine neuen" when nothing came', async () => {
		const context = setup([CAL]);
		await context.store.runAll();
		expect(context.flags.flags[0]?.title).toBe('1 Kanal abgerufen: keine neuen.');
	});

	it('leaves Notion out: it only imports on request (ADR-0041)', async () => {
		const notion = connection('conn00000000004', 'Notion', {
			type: 'notion',
			secretEnv: 'BYL_NOTION_TOKEN',
			keywords: []
		});
		const context = setup([CAL, notion]);
		await context.store.runAll();
		expect(context.data.run.mock.calls.map(([id]) => id)).toEqual([CAL.id]);
		expect(context.flags.flags[0]?.title).toBe('1 Kanal abgerufen: keine neuen.');
	});

	it('links the flag to the card of a failed connection and goes on with the others', async () => {
		const context = setup();
		context.data.run
			.mockResolvedValueOnce({ ...OK, status: 'error', error: 'HTTP 404.' })
			.mockRejectedValueOnce(new DataError('network', { status: 0 }));
		await context.store.runAll();
		expect(context.data.run).toHaveBeenCalledTimes(2);
		const flag = context.flags.flags[0];
		expect(flag).toMatchObject({
			tone: 'error',
			title: '2 Kanäle abgerufen: keine neuen, 2 mit Problem.'
		});
		expect(flag?.action?.label).toBe('Zur Karte „Kalender“');
		flag?.action?.run();
		expect(context.navigate.card).toHaveBeenCalledWith(CAL.id);
	});

	it('leads to the channels without a switched-on connection', async () => {
		const context = setup([PAUSED]);
		await context.store.runAll();
		expect(context.data.run).not.toHaveBeenCalled();
		const flag = context.flags.flags[0];
		expect(flag?.tone).toBe('info');
		flag?.action?.run();
		expect(context.navigate.channels).toHaveBeenCalledOnce();
	});

	it('logs out when the session ended and ignores a second click while running', async () => {
		const context = setup([CAL]);
		const first = deferred<RunResult>();
		context.data.run.mockReturnValueOnce(first.promise);
		const running = context.store.runAll();
		await context.store.runAll();
		await vi.waitFor(() => expect(context.data.run).toHaveBeenCalledTimes(1));
		first.resolve(OK);
		await running;
		expect(context.data.list).toHaveBeenCalledTimes(1);

		context.data.run.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await context.store.runAll();
		expect(context.session.logout).toHaveBeenCalledOnce();
		expect(context.store.running).toBe(false);
	});

	it('reports a list that cannot be loaded as error flag', async () => {
		const context = setup();
		context.data.list.mockRejectedValueOnce(new DataError('network', { status: 0 }));
		await context.store.runAll();
		expect(context.flags.flags[0]).toMatchObject({
			tone: 'error',
			title: 'Die Kanäle ließen sich nicht laden.'
		});
		expect(context.data.run).not.toHaveBeenCalled();
	});
});

describe('SyncAllButton', () => {
	it('is busy with a polite live status while it runs, then free again', async () => {
		const context = setup([MAIL]);
		const first = deferred<RunResult>();
		context.data.run.mockReturnValueOnce(first.promise);
		render(SyncAllButton, { props: { store: context.store } });
		const button = screen.getByRole('button', { name: 'Alle Kanäle jetzt abrufen' });
		await fireEvent.click(button);
		const busy = await screen.findByRole('button', { name: 'Wird abgerufen …' });
		expect(busy.getAttribute('aria-busy')).toBe('true');
		expect(busy.getAttribute('aria-disabled')).toBe('true');
		await vi.waitFor(() =>
			expect(screen.getByRole('status').textContent).toBe('„Web.de“ wird abgerufen (1 von 1) …')
		);
		await fireEvent.click(busy);
		expect(context.data.list).toHaveBeenCalledTimes(1);
		first.resolve({ ...OK, created: 1 });
		await screen.findByRole('button', { name: 'Alle Kanäle jetzt abrufen' });
		expect(screen.getByRole('status').textContent).toBe('');
		expect(context.flags.flags[0]?.title).toBe('1 Kanal abgerufen: 1 neuer.');
	});
});
