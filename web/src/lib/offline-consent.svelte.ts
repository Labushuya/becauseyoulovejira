// The answer of this device to "Änderungen ohne Verbindung auf diesem Gerät merken?" (package
// "Einschalten", ADR-0074 addendum "Zustimmung je Gerät"; rules in lib/domain/offline-consent.ts):
// stored in localStorage under OFFLINE_CONSENT_STORAGE_KEY, only on this device. A device that had the
// former switch "Handy-Ansicht (Vorschau)" on gets "yes" stored once, so its answer stays when the
// choice "Handy-Ansicht" removes the old value later. Closing the question without an answer holds
// only for this document (`dismissed`); the next start asks again. Other tabs follow over `storage`.

import {
	OFFLINE_CONSENT_STORAGE_KEY,
	consentOf,
	parseOfflineConsent,
	type OfflineConsent
} from '$lib/domain/offline-consent';
import { MOBILE_LAYOUT_STORAGE_KEY } from '$lib/domain/phone-layout';

/** The answer of this device, with the migration of the former switch; none with a blocked storage. */
export function readOfflineConsent(
	storage: Pick<Storage, 'getItem'> | null
): OfflineConsent | null {
	try {
		return consentOf(
			storage?.getItem(OFFLINE_CONSENT_STORAGE_KEY),
			storage?.getItem(MOBILE_LAYOUT_STORAGE_KEY)
		);
	} catch {
		return null;
	}
}

/** Stores the answer; false if the storage refused it (the answer then lasts for this page). */
export function writeOfflineConsent(
	storage: Pick<Storage, 'setItem'> | null,
	consent: OfflineConsent
): boolean {
	if (storage === null) return false;
	try {
		storage.setItem(OFFLINE_CONSENT_STORAGE_KEY, consent);
		return true;
	} catch {
		return false;
	}
}

/** Whether the answer is stored under its own key (not only taken from the former switch). */
function storedOwn(storage: Pick<Storage, 'getItem'> | null): boolean {
	try {
		return parseOfflineConsent(storage?.getItem(OFFLINE_CONSENT_STORAGE_KEY)) !== null;
	} catch {
		return false;
	}
}

function storageOf(win: Window): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

/** Key of the check whether the storage takes a write; removed again at once. */
const PROBE_KEY = `${OFFLINE_CONSENT_STORAGE_KEY}-probe`;

/** Whether the storage takes a write (round 2, E-5); a private window or a full storage may refuse. */
function takesWrites(storage: Storage | null): boolean {
	if (storage === null) return false;
	try {
		storage.setItem(PROBE_KEY, '1');
		storage.removeItem(PROBE_KEY);
		return true;
	} catch {
		return false;
	}
}

export class OfflineConsentStore {
	/** "yes" after "Ja, merken", "no" after "Nein", null without an answer. */
	consent = $state<OfflineConsent | null>(null);

	/** Closed without an answer in this document (Escape, ×): the question waits for the next start. */
	dismissed = $state(false);

	/**
	 * The storage of the browser takes the answer (round 2, E-5): where it refuses, the layout does not
	 * ask (the question would come at every start) and "Darstellung" locks the switch with the reason.
	 */
	writable = $state(true);

	readonly #win: Window;

	constructor(win: Window) {
		this.#win = win;
		const storage = storageOf(win);
		this.writable = takesWrites(storage);
		this.consent = readOfflineConsent(storage);
		// The former switch "on" counts as "yes" (migration); stored once under the own key.
		if (this.consent !== null && !storedOwn(storage)) writeOfflineConsent(storage, this.consent);
	}

	/** "Ja, merken" or "Nein", in the question or under "Darstellung". */
	choose(consent: OfflineConsent): void {
		this.consent = consent;
		writeOfflineConsent(storageOf(this.#win), consent);
	}

	/** The question closed without an answer: not again in this document. */
	dismiss(): void {
		this.dismissed = true;
	}

	/** Follows the answer of other tabs; returns the cleanup. */
	connect(): () => void {
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key !== null && event.key !== OFFLINE_CONSENT_STORAGE_KEY) return;
			this.consent = event.key === null ? null : parseOfflineConsent(event.newValue);
		};
		this.#win.addEventListener('storage', onstorage);
		return () => this.#win.removeEventListener('storage', onstorage);
	}
}

let shared: OfflineConsentStore | undefined;

/** The store of the app, created on first use. */
export function getOfflineConsentStore(): OfflineConsentStore {
	shared ??= new OfflineConsentStore(window);
	return shared;
}
