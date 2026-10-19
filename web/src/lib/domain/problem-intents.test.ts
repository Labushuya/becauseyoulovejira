// Catalog of intents (FP-1, ADR-0071 §3): routes of BYL, the record API of every collection of the
// SPA and the rest of the SDK, the most specific pattern first. Whether every route of app/pb_hooks
// has an entry checks tests/unit/web-problem-intents.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	BYL_ROUTE_INTENTS,
	COLLECTION_INTENTS,
	INTENT_CATALOG,
	UNKNOWN_INTENT,
	intentOf,
	matchesIntentPath,
	routeKey
} from './problem-intents';

describe('intents of the catalog', () => {
	it('names the routes of BYL with their IDs', () => {
		expect(intentOf('POST', '/api/byl/tickets/abc123def456789/subtasks/transfer')).toBe(
			'Unteraufgaben übertragen'
		);
		expect(intentOf('POST', '/api/byl/connections/conn00000000001/run')).toBe(
			'Kanal jetzt abrufen'
		);
		expect(intentOf('get', '/api/byl/trash')).toBe('Papierkorb laden');
		expect(intentOf('POST', '/api/byl/tickets/create')).toBe('Ticket anlegen');
		expect(intentOf('GET', '/api/byl/tickets/create')).toBe('Optionen für neue Tickets laden');
	});

	it('names the record API of a collection by method', () => {
		const records = '/api/collections/tickets/records';
		expect(intentOf('PATCH', `${records}/abc123def456789`)).toBe('Ticket speichern');
		expect(intentOf('POST', records)).toBe('Ticket anlegen');
		expect(intentOf('GET', records)).toBe('Tickets laden');
		expect(intentOf('DELETE', `${records}/abc123def456789`)).toBe('Ticket löschen');
		expect(intentOf('POST', '/api/collections/connections/records')).toBe('Kanal verbinden');
		expect(intentOf('DELETE', '/api/collections/ticket_pins/records/pin000000000001')).toBe(
			'Anheften lösen'
		);
	});

	it('names sign-in, realtime and health of the SDK', () => {
		expect(intentOf('POST', '/api/collections/users/auth-with-password')).toBe('Anmelden');
		expect(intentOf('POST', '/api/realtime')).toBe('Live-Aktualisierung verbinden');
		expect(intentOf('GET', '/api/health')).toBe('Server prüfen');
	});

	it('prefers the more specific pattern', () => {
		expect(intentOf('POST', '/api/byl/system/actions/restart')).toBe('App neu starten');
		expect(intentOf('POST', '/api/byl/system/actions/erfunden')).toBe(
			'Aktion der Seite System ausführen'
		);
		expect(intentOf('POST', '/api/byl/storage/actions/vacuum')).toBe('Datenbank verdichten');
	});

	it('knows nothing without a method, for another method or an unknown path', () => {
		expect(intentOf(null, '/api/byl/trash')).toBeNull();
		expect(intentOf('DELETE', '/api/byl/trash')).toBeNull();
		expect(intentOf('GET', '/api/byl/erfunden')).toBeNull();
		expect(intentOf('PATCH', '/api/collections/erfunden/records/x')).toBeNull();
		expect(UNKNOWN_INTENT).toBe('Unbekannte Aktion');
	});
});

describe('patterns', () => {
	it('lets `*` stand for exactly one segment', () => {
		expect(matchesIntentPath('/api/byl/trash/*', '/api/byl/trash/abc')).toBe(true);
		expect(matchesIntentPath('/api/byl/trash/*', '/api/byl/trash')).toBe(false);
		expect(matchesIntentPath('/api/byl/trash/*', '/api/byl/trash/abc/restore')).toBe(false);
		expect(matchesIntentPath('/api/byl/trash/empty', '/api/byl/trash/empty/')).toBe(true);
	});

	it('turns a route of the hooks into its key', () => {
		expect(routeKey('post', '/api/byl/tickets/{id}/ticket-sources/{source}/remove')).toBe(
			'POST /api/byl/tickets/*/ticket-sources/*/remove'
		);
	});

	it('has well-formed keys with an intent each and five entries per collection', () => {
		for (const [key, intent] of Object.entries(BYL_ROUTE_INTENTS)) {
			expect(key, key).toMatch(/^(GET|POST|PATCH|DELETE) \/api\/byl\/[\w*/-]*$/);
			expect(intent.trim(), key).not.toBe('');
		}
		const records = INTENT_CATALOG.filter((route) => route.path.startsWith('/api/collections/'));
		const collections = Object.keys(COLLECTION_INTENTS);
		expect(records.filter((route) => route.path.includes('/records'))).toHaveLength(
			collections.length * 5
		);
	});
});
