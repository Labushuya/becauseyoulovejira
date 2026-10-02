// Unit tests of the way back from the settings (ADR-0026 section 1, plan EH-1): which addresses
// count as a view, the check against open redirects, storage failures and the labels.

import { describe, expect, it } from 'vitest';
import {
	LAST_VIEW_KEY,
	LastViewStore,
	isViewPath,
	lastViewLabel,
	type LastViewStorage
} from './last-view.svelte';

const ORIGIN = 'http://127.0.0.1:8090';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const storage: LastViewStorage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value)
	};
	return { storage, values };
}

function store(storage: LastViewStorage | null) {
	return new LastViewStore(
		() => storage,
		() => ORIGIN
	);
}

const at = (path: string) => new URL(path, ORIGIN);

describe('isViewPath', () => {
	it.each([
		['/', true],
		['/tickets/abc123def456ghi', true],
		['/tickets/neu', true],
		['/projekte/proj00000000001', true],
		['/eingang', true],
		['/eingang/item0000000000001', true],
		['/einstellungen', false],
		['/einstellungen/kanaele', false],
		['/einstellungen/datei-importe', false],
		['/tickets/abc123def456ghi/voll', false],
		['/login', false]
	])('%s is a view: %s', (path, expected) => {
		expect(isViewPath(path)).toBe(expected);
	});

	it('does not take a page that only starts like the settings for them', () => {
		expect(isViewPath('/einstellungenx')).toBe(true);
	});
});

describe('LastViewStore', () => {
	it('leads to "Aufgaben" without a remembered view', () => {
		expect(store(memoryStorage().storage).href).toBe('/');
	});

	it('remembers views with query and hash and keeps them in sessionStorage', () => {
		const { storage, values } = memoryStorage();
		const lastView = store(storage);

		lastView.remember(at('/tickets/abc123def456ghi?status=open&sort=titel#x'));

		expect(lastView.href).toBe('/tickets/abc123def456ghi?status=open&sort=titel#x');
		expect(values.get(LAST_VIEW_KEY)).toBe('/tickets/abc123def456ghi?status=open&sort=titel#x');
		// A new store in the same tab (reload, restart of the app) reads it back.
		expect(store(storage).href).toBe('/tickets/abc123def456ghi?status=open&sort=titel#x');
	});

	it('ignores the settings, the full view and the login', () => {
		const { storage } = memoryStorage();
		const lastView = store(storage);
		lastView.remember(at('/eingang?quelle=mail'));

		lastView.remember(at('/einstellungen/kanaele'));
		lastView.remember(at('/tickets/abc123def456ghi/voll?status=open'));
		lastView.remember(at('/login?redirect=%2F'));

		expect(lastView.href).toBe('/eingang?quelle=mail');
	});

	it.each([
		'//evil.example/phish',
		'/\\evil.example',
		'https://evil.example/',
		'javascript:alert(1)',
		'/einstellungen/kanaele',
		'/tickets/x/voll',
		'/\t/evil.example'
	])('falls back to "/" for the manipulated value %s', (value) => {
		const { storage } = memoryStorage({ [LAST_VIEW_KEY]: value });
		expect(store(storage).href).toBe('/');
	});

	it('works without sessionStorage and when the storage throws', () => {
		const lastView = store(null);
		lastView.remember(at('/projekte'));
		expect(lastView.href).toBe('/projekte');

		const broken: LastViewStorage = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		const fallback = store(broken);
		expect(fallback.href).toBe('/');
		fallback.remember(at('/eingang'));
		expect(fallback.href).toBe('/eingang');
	});
});

describe('lastViewLabel', () => {
	it.each([
		['/', 'Zurück zu Aufgaben'],
		['/?status=open', 'Zurück zu Aufgaben'],
		['/tickets/neu?status=open', 'Zurück zu Aufgaben'],
		['/tickets/unknown00000001', 'Zurück zum Ticket'],
		['/projekte', 'Zurück zu Projekte'],
		['/projekte/proj00000000001?archiviert=1', 'Zurück zu Projekte'],
		['/eingang', 'Zurück zum Eingang'],
		['/eingang/neu', 'Zurück zum Eingang'],
		['/eingang/item0000000000001?zustand=verworfen', 'Zurück zum Eintrag'],
		// The calendar and a ticket next to it (ADR-0053).
		['/kalender?ansicht=woche', 'Zurück zum Kalender'],
		['/kalender/tickets/unknown00000001', 'Zurück zum Ticket']
	])('labels %s as "%s"', (href, label) => {
		expect(lastViewLabel(href)).toBe(label);
	});

	it('names the key of an open ticket if the list knows it', () => {
		const keyOf = (id: string) => (id === 'abc123def456ghi' ? 'BYL-12' : null);
		expect(lastViewLabel('/tickets/abc123def456ghi?status=open', keyOf)).toBe('Zurück zu BYL-12');
		expect(lastViewLabel('/kalender/tickets/abc123def456ghi', keyOf)).toBe('Zurück zu BYL-12');
	});
});
