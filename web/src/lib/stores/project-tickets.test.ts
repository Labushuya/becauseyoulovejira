// Unit tests for the rows of the project list that show their open tickets (ADR-0034, addendum
// "Offene Tickets in Projekten"): kept on this device in localStorage, "Alle aufklappen" and
// "Alle zuklappen", other tabs through the storage event, a blocked storage.

import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_TICKETS_STORAGE_KEY } from '$lib/domain/project-tickets';
import { ProjectTicketsDisclosure } from './project-tickets.svelte';

const HOUSE = 'house0000000001';
const GARDEN = 'garden000000001';
const CAR = 'car000000000001';

afterEach(() => {
	localStorage.clear();
});

describe('ProjectTicketsDisclosure', () => {
	it('starts closed and keeps opened rows in localStorage', () => {
		const rows = new ProjectTicketsDisclosure(window);
		expect(rows.isOpen(HOUSE)).toBe(false);
		expect(rows.none).toBe(true);

		rows.toggle(HOUSE);
		rows.toggle(GARDEN);
		expect(rows.isOpen(HOUSE)).toBe(true);
		expect(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY)).toBe(`["${HOUSE}","${GARDEN}"]`);

		rows.toggle(HOUSE);
		expect(rows.isOpen(HOUSE)).toBe(false);
		expect(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY)).toBe(`["${GARDEN}"]`);

		// The next visit on this device (a new view) opens the same rows.
		expect(new ProjectTicketsDisclosure(window).isOpen(GARDEN)).toBe(true);
	});

	it('opens all given rows and closes all, also rows the list does not show', () => {
		const rows = new ProjectTicketsDisclosure(window);
		rows.toggle(CAR);
		rows.openAll([HOUSE, GARDEN, CAR]);
		expect([HOUSE, GARDEN, CAR].every((id) => rows.isOpen(id))).toBe(true);
		expect(JSON.parse(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY) ?? '[]')).toEqual([
			CAR,
			HOUSE,
			GARDEN
		]);

		rows.closeAll();
		expect(rows.none).toBe(true);
		expect(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY)).toBeNull();
	});

	it('follows other tabs', () => {
		const rows = new ProjectTicketsDisclosure(window);
		const cleanup = rows.connect();
		rows.toggle(HOUSE);

		window.dispatchEvent(
			new StorageEvent('storage', { key: PROJECT_TICKETS_STORAGE_KEY, newValue: `["${GARDEN}"]` })
		);
		expect(rows.isOpen(HOUSE)).toBe(false);
		expect(rows.isOpen(GARDEN)).toBe(true);

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(rows.isOpen(GARDEN)).toBe(true);

		// The other tab cleared the whole storage.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(rows.none).toBe(true);

		cleanup();
		window.dispatchEvent(
			new StorageEvent('storage', { key: PROJECT_TICKETS_STORAGE_KEY, newValue: `["${CAR}"]` })
		);
		expect(rows.isOpen(CAR)).toBe(false);
	});

	it('keeps the choice for the page when the storage is blocked', () => {
		const blocked = {
			get localStorage(): Storage {
				throw new Error('blocked');
			},
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		} as unknown as Window;
		const rows = new ProjectTicketsDisclosure(blocked);
		rows.toggle(HOUSE);
		expect(rows.isOpen(HOUSE)).toBe(true);

		const none = new ProjectTicketsDisclosure(null);
		none.openAll([HOUSE]);
		expect(none.isOpen(HOUSE)).toBe(true);
		expect(none.connect()).toBeTypeOf('function');
	});
});
