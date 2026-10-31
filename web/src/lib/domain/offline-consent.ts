// Keeping changes without a connection on this device (package "Einschalten", ADR-0074 addendum
// "Zustimmung je Gerät"): since the phone view is "Automatisch" by default, the outbox no longer starts
// with it. Each device answers once, at the first start of the phone view, whether it keeps changes
// without a connection; the answer lives only on this device. Pure: no SvelteKit, no DOM; the store in
// lib/offline-consent.svelte.ts reads and writes the storage, the (app) layout asks and tells the outbox.

import { MOBILE_LAYOUT_ON } from './phone-layout';

/** Key of the answer in localStorage, only on this device. */
export const OFFLINE_CONSENT_STORAGE_KEY = 'byl-offline-consent';

/** "Ja, merken" or "Nein"; null while the device has not answered. */
export type OfflineConsent = 'yes' | 'no';

/** Only "yes" and "no" are answers; anything else counts as none. */
export function parseOfflineConsent(value: string | null | undefined): OfflineConsent | null {
	return value === 'yes' || value === 'no' ? value : null;
}

/**
 * The answer of this device: the stored one, else "yes" for a device that had the former switch
 * "Handy-Ansicht (Vorschau)" on (value "on" under `byl-mobile-layout`), whose outbox worked already
 * (migration, decision of the user 2); else none.
 */
export function consentOf(
	stored: string | null | undefined,
	layout: string | null | undefined
): OfflineConsent | null {
	return parseOfflineConsent(stored) ?? (layout === MOBILE_LAYOUT_ON ? 'yes' : null);
}

/** What decides whether the question shows. */
export interface ConsentState {
	/** The phone frame applies (MobileLayoutStore.active). */
	readonly phone: boolean;
	/** The server takes changes without a connection (`offline_ops`, OutboxStore.supported). */
	readonly supported: boolean;
	readonly consent: OfflineConsent | null;
	/** Closed without an answer (Escape, ×) in this document: the next start asks again. */
	readonly dismissed: boolean;
}

/**
 * Whether the layout asks: once at the start of the phone view, when the server can take changes
 * without a connection and the device has no answer. Never on the PC or in a wide window.
 */
export function asksConsent(state: ConsentState): boolean {
	return state.phone && state.supported && state.consent === null && !state.dismissed;
}

/** The words of the question and of the setting under "Darstellung" (wording = code). */
export const OFFLINE_CONSENT_TEXTS = {
	title: 'Änderungen ohne Verbindung auf diesem Gerät merken?',
	announcement:
		'Die Handy-Ansicht ist jetzt eingeschaltet: Auf schmalen Bildschirmen stehen unten Tagesplan, Aufgaben, Erfassen, Eingang und „Mehr“. Ausschalten lässt sie sich unter „Mehr“ → „Darstellung“.',
	explanation:
		'Mit „Ja, merken“ hält die App einige Änderungen auf diesem Gerät fest, wenn die Verbindung abreißt, und überträgt sie von selbst, sobald der Server wieder erreichbar ist. Mit „Nein“ geht ohne Verbindung nichts, wie bisher. Beides lässt sich unter „Darstellung“ ändern.',
	yes: 'Ja, merken',
	no: 'Nein',
	/** The switch under "Darstellung". */
	setting: 'Ohne Verbindung merken (dieses Gerät)',
	/** Keeping is off while the device still holds kept changes. */
	stillSent: (count: number): string =>
		count === 1
			? '1 gemerkte Änderung wird trotzdem noch übertragen, sobald die Verbindung zurück ist. Neue merkt die App auf diesem Gerät nicht mehr.'
			: `${count} gemerkte Änderungen werden trotzdem noch übertragen, sobald die Verbindung zurück ist. Neue merkt die App auf diesem Gerät nicht mehr.`
} as const;
