// Source of the ticket picker (ADR-0042 section 4): open tickets, projects in tree order, sub
// projects and the "new" mark come from the stores of the app; done tickets from the server only
// with a valid session, a lost one ends it. Recently viewed tickets per device and user in
// localStorage, IDs only, robust against blocked storage.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
import { RECENT_TICKETS_STORAGE_KEY } from '$lib/domain/ticket-picker';
import { pickerTicket } from '$lib/test/ticket-picker-fake';
import {
	RecentTicketsStore,
	ticketPickerSource,
	type TicketPickerData,
	type TicketPickerParts
} from './ticket-picker.svelte';

const USER = 'user00000000001';
const A = 'a00000000000001';
const B = 'b00000000000002';

const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARTEN = {
	id: 'garten000000001',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parentId: HAUS.id,
	parent: { id: HAUS.id, name: 'Haus', code: 'HAUS' }
};
const AUTO: ProjectRef = { id: 'auto00000000001', name: 'Auto', code: 'AUTO', archived: false };

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
		values
	};
}

function parts() {
	const open = [pickerTicket({ key: 'HAUS-1' })];
	const data: TicketPickerData = {
		listDone: vi.fn<TicketPickerData['listDone']>(async () => ({ items: [], hasMore: false }))
	};
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const list = {
		open,
		openState: 'idle' as const,
		today: '2026-09-30',
		loadOpen: vi.fn(),
		reload: vi.fn(async () => undefined),
		isNew: (ticket: TicketSummary) => ticket.key === 'HAUS-1'
	};
	const catalog = {
		projects: [AUTO, GARTEN, HAUS],
		projectOf: (ticket: TicketSummary) => (ticket.projectId === HAUS.id ? HAUS : null),
		subProjectsOf: (id: string) => (id === HAUS.id ? [GARTEN] : [])
	};
	return { data, session, list, catalog, recent: { ids: [A] } } satisfies TicketPickerParts;
}

describe('ticketPickerSource', () => {
	it('reads open tickets, projects in tree order, sub projects and the "new" mark from the stores', () => {
		const given = parts();
		const source = ticketPickerSource(given);
		expect(source.open).toBe(given.list.open);
		expect(source.openState).toBe('idle');
		expect(source.today).toBe('2026-09-30');
		expect(source.projects.map((project) => project.code)).toEqual(['AUTO', 'HAUS', 'GART']);
		expect(source.subProjectsOf(HAUS.id)).toEqual([GARTEN.id]);
		expect(source.isNew(given.list.open[0] as TicketSummary)).toBe(true);
		expect(source.recentIds).toEqual([A]);
		source.load();
		expect(given.list.loadOpen).toHaveBeenCalledOnce();
	});

	it('loads the open tickets again after a failure', () => {
		const given = parts();
		const source = ticketPickerSource({ ...given, list: { ...given.list, openState: 'error' } });
		source.load();
		expect(given.list.reload).toHaveBeenCalledOnce();
		expect(given.list.loadOpen).not.toHaveBeenCalled();
	});

	it('asks the server for done tickets only with a valid session and ends a lost one', async () => {
		const given = parts();
		const source = ticketPickerSource(given);
		const query = { patterns: ['%_pf_l%'], project: null };
		await source.listDone(query, 2, {});
		expect(given.data.listDone).toHaveBeenCalledWith(query, 2, {});

		given.session.ensureValid.mockReturnValueOnce(false);
		await expect(source.listDone(query, 1, {})).rejects.toMatchObject({ kind: 'session' });

		vi.mocked(given.data.listDone).mockRejectedValueOnce(new DataError('session'));
		await expect(source.listDone(query, 1, {})).rejects.toMatchObject({ kind: 'session' });
		expect(given.session.logout).toHaveBeenCalledOnce();

		vi.mocked(given.data.listDone).mockRejectedValueOnce(new DataError('network'));
		await expect(source.listDone(query, 1, {})).rejects.toMatchObject({ kind: 'network' });
		expect(given.session.logout).toHaveBeenCalledOnce();
	});
});

describe('RecentTicketsStore', () => {
	it('reads the list of the user and puts a viewed ticket first', () => {
		const storage = memoryStorage({
			[RECENT_TICKETS_STORAGE_KEY]: JSON.stringify({ user: USER, ids: [A] })
		});
		const store = new RecentTicketsStore(() => storage, USER);
		expect(store.ids).toEqual([A]);
		store.remember(B);
		expect(store.ids).toEqual([B, A]);
		expect(JSON.parse(storage.values.get(RECENT_TICKETS_STORAGE_KEY) ?? '')).toEqual({
			user: USER,
			ids: [B, A]
		});
		// The first one again: nothing to write.
		storage.setItem.mockClear();
		store.remember(B);
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it('ignores the list of another user and remembers nothing without one', () => {
		const storage = memoryStorage({
			[RECENT_TICKETS_STORAGE_KEY]: JSON.stringify({ user: 'other0000000001', ids: [A] })
		});
		expect(new RecentTicketsStore(() => storage, USER).ids).toEqual([]);
		const anonymous = new RecentTicketsStore(() => storage, null);
		anonymous.remember(B);
		expect(anonymous.ids).toEqual([]);
	});

	it('keeps working with blocked or full storage', () => {
		const blocked = new RecentTicketsStore(() => {
			throw new Error('blocked');
		}, USER);
		expect(blocked.ids).toEqual([]);
		blocked.remember(A);
		expect(blocked.ids).toEqual([A]);
		const full = memoryStorage();
		full.setItem.mockImplementation(() => {
			throw new Error('full');
		});
		const store = new RecentTicketsStore(() => full, USER);
		store.remember(B);
		expect(store.ids).toEqual([B]);
	});
});
