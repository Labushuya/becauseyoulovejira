// Keeping changes without a connection on this device (package "Einschalten", ADR-0074 addendum
// "Zustimmung je Gerät"): the stored answer, the device with the old switch value "on" counts as
// "yes", the question only in the phone frame with the capability of the server and without an
// answer, and its words.

import { describe, expect, it } from 'vitest';
import {
	OFFLINE_CONSENT_STORAGE_KEY,
	OFFLINE_CONSENT_TEXTS,
	asksConsent,
	consentOf,
	parseOfflineConsent
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
	const base = { phone: true, supported: true, consent: null, dismissed: false } as const;

	it('asks in the phone frame when the server takes changes without a connection and the device has no answer', () => {
		expect(asksConsent(base)).toBe(true);
	});

	it.each([
		['on the PC or in a wide window', { phone: false }],
		['without the capability of the server', { supported: false }],
		['after "Ja, merken"', { consent: 'yes' as const }],
		['after "Nein"', { consent: 'no' as const }],
		['after Escape in this document (asked again at the next start)', { dismissed: true }]
	])('does not ask %s', (_name, overrides) => {
		expect(asksConsent({ ...base, ...overrides })).toBe(false);
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
});
