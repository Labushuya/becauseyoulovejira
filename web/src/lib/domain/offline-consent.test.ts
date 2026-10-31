// Keeping changes without a connection on this device (package "Einschalten", ADR-0074 addendum
// "Zustimmung je Gerät"): the stored answer, the device with the old switch value "on" counts as
// "yes", the question only in the phone frame with the capability of the server and without an
// answer, and its words.

import { describe, expect, it } from 'vitest';
import {
	OFFLINE_CONSENT_MARK,
	OFFLINE_CONSENT_STORAGE_KEY,
	OFFLINE_CONSENT_TEXTS,
	asksConsent,
	consentOf,
	parseOfflineConsent,
	showsConsent
} from './offline-consent';

describe('offline consent: the stored answer', () => {
	it('has its own key, only on this device', () => {
		expect(OFFLINE_CONSENT_STORAGE_KEY).toBe('byl-offline-consent');
	});

	it.each([
		['yes', 'yes'],
		['no', 'no'],
		['YES', null],
		['on', null],
		['', null],
		[null, null],
		[undefined, null]
	])('reads %j as %j', (value, consent) => {
		expect(parseOfflineConsent(value)).toBe(consent);
	});

	it('counts a device with the old switch value "on" as "yes" (migration), an answer first', () => {
		expect(consentOf(null, 'on')).toBe('yes');
		expect(consentOf('no', 'on')).toBe('no');
		expect(consentOf('yes', null)).toBe('yes');
		// No old switch, or the new "off": no answer yet.
		expect(consentOf(null, null)).toBeNull();
		expect(consentOf(null, 'off')).toBeNull();
		expect(consentOf('maybe', 'off')).toBeNull();
	});
});

describe('offline consent: the question at the first start of the phone view', () => {
	const base = {
		phone: true,
		supported: true,
		storable: true,
		consent: null,
		dismissed: false
	} as const;

	it('asks in the phone frame when the server takes changes without a connection and the device has no answer', () => {
		expect(asksConsent(base)).toBe(true);
	});

	it.each([
		['on the PC or in a wide window', { phone: false }],
		['without the capability of the server', { supported: false }],
		// Round 2 (E-5): an answer that cannot be stored would bring the question at every start, and
		// without IndexedDB nothing could be kept.
		[
			'where localStorage refuses to write or IndexedDB is missing (round 2, E-5)',
			{ storable: false }
		],
		['after "Ja, merken"', { consent: 'yes' as const }],
		['after "Nein"', { consent: 'no' as const }],
		['after Escape in this document (asked again at the next start)', { dismissed: true }]
	])('does not ask %s', (_name, overrides) => {
		expect(asksConsent({ ...base, ...overrides })).toBe(false);
	});

	// Round 2 (E-1): the question never opens over another dialog or sheet, nor while a navigation
	// runs; it waits until everything is closed. Its own dialog is left out of "covered" by its mark.
	describe('the moment of the question (round 2, E-1)', () => {
		const moment = { asks: true, navigating: false, covered: false } as const;

		it('shows when it is due and nothing else is open', () => {
			expect(showsConsent(moment)).toBe(true);
		});

		it.each([
			['while it is not due', { asks: false }],
			['while another dialog or sheet is open', { covered: true }],
			['while a navigation runs', { navigating: true }]
		])('does not show %s', (_name, overrides) => {
			expect(showsConsent({ ...moment, ...overrides })).toBe(false);
		});

		it('marks the question, so the watch of the open dialogs leaves it out', () => {
			expect(OFFLINE_CONSENT_MARK).toBe('data-offline-consent');
		});
	});

	it('announces the phone view and asks with "Ja, merken" and "Nein"', () => {
		expect(OFFLINE_CONSENT_TEXTS.title).toBe('Änderungen ohne Verbindung auf diesem Gerät merken?');
		expect(OFFLINE_CONSENT_TEXTS.announcement).toMatch(
			/^Die Handy-Ansicht ist jetzt eingeschaltet/
		);
		expect(OFFLINE_CONSENT_TEXTS.yes).toBe('Ja, merken');
		expect(OFFLINE_CONSENT_TEXTS.no).toBe('Nein');
	});

	it('names how many kept changes still go when keeping is off', () => {
		expect(OFFLINE_CONSENT_TEXTS.stillSent(1)).toBe(
			'1 gemerkte Änderung wird trotzdem noch übertragen, sobald die Verbindung zurück ist. Neue merkt die App auf diesem Gerät nicht mehr.'
		);
		expect(OFFLINE_CONSENT_TEXTS.stillSent(3)).toBe(
			'3 gemerkte Änderungen werden trotzdem noch übertragen, sobald die Verbindung zurück ist. Neue merkt die App auf diesem Gerät nicht mehr.'
		);
	});

	// Round 2 (E-2, E-5): the reasons of the locked switch under "Darstellung" (wording = code). Changed
	// with NA-1 (F-3): a failed question may also be an error of the server, not only a missing
	// connection; and a private window often stores for the session after all, so neither names it.
	it('names why the switch is locked: a check that runs, one that failed, a browser without storage', () => {
		expect(OFFLINE_CONSENT_TEXTS.checking).toBe(
			'Wird geprüft … Die App fragt gerade den Server, ob er Änderungen ohne Verbindung merken kann.'
		);
		expect(OFFLINE_CONSENT_TEXTS.unchecked).toBe(
			'Gerade nicht prüfbar – der Server ist nicht erreichbar. Ob er Änderungen ohne Verbindung merken kann, fragt die App später erneut.'
		);
		expect(OFFLINE_CONSENT_TEXTS.noStorage).toBe(
			'Dieser Browser kann hier gerade nichts dauerhaft speichern. Deshalb merkt sich die App ohne Verbindung nichts.'
		);
		expect(OFFLINE_CONSENT_TEXTS.unchecked).not.toMatch(/keine Verbindung/);
		expect(OFFLINE_CONSENT_TEXTS.noStorage).not.toMatch(/privat/);
	});
});
