// Switch "Handy-Ansicht (Vorschau)" (MO-1a, ADR-0073; docs/regeln/einstellungen-system.md): the phone
// frame applies only while the switch of this device is on and the window is narrow (PHONE_QUERY).
// It is off by default, so the app looks as before on every device until the user turns it on
// under "Einstellungen → Darstellung". The choice lives in localStorage under
// MOBILE_LAYOUT_STORAGE_KEY, only on this device; only "on" is stored. The store sets
// data-mobile-layout="on" on the root element while the switch is on (tokens.css and the phone
// rules of the CSS add their own media query), and while connected it gives the meta viewport the
// keys of the phone frame only while the frame applies. Without matchMedia (jsdom) the window counts
// as wide, so every component test stays a desktop test.

import {
	MOBILE_LAYOUT_ATTRIBUTE,
	MOBILE_LAYOUT_ON,
	MOBILE_LAYOUT_STORAGE_KEY,
	PHONE_QUERY,
	isPhoneLayout,
	parseMobileLayout,
	viewportContent
} from '$lib/domain/phone-layout';

/** The stored switch; a storage that throws (blocked, private mode) means "off". */
export function readMobileLayout(storage: Pick<Storage, 'getItem'> | null): boolean {
	try {
		return parseMobileLayout(storage?.getItem(MOBILE_LAYOUT_STORAGE_KEY));
	} catch {
		return false;
	}
}

/** Stores the switch; false if the storage refused it (the choice then lasts for this page). */
export function writeMobileLayout(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	enabled: boolean
): boolean {
	if (storage === null) return false;
	try {
		if (enabled) storage.setItem(MOBILE_LAYOUT_STORAGE_KEY, MOBILE_LAYOUT_ON);
		else storage.removeItem(MOBILE_LAYOUT_STORAGE_KEY);
		return true;
	} catch {
		return false;
	}
}

/** Sets or removes data-mobile-layout on the root element. */
export function applyMobileLayout(root: Element, enabled: boolean): void {
	if (enabled) root.setAttribute(MOBILE_LAYOUT_ATTRIBUTE, MOBILE_LAYOUT_ON);
	else root.removeAttribute(MOBILE_LAYOUT_ATTRIBUTE);
}

/** Gives the meta viewport of app.html the content of the frame that applies, if there is one. */
export function applyViewport(doc: Document, phone: boolean): void {
	const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
	const content = viewportContent(phone);
	if (meta !== null && meta.content !== content) meta.content = content;
}

function storageOf(win: Window): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

/** The media query of the phone width, or null where matchMedia is missing (tests). */
function phoneQuery(win: Window): MediaQueryList | null {
	return typeof win.matchMedia === 'function' ? win.matchMedia(PHONE_QUERY) : null;
}

/**
 * The switch of this device and the width of the window; `active` is the one decision every part
 * of the phone frame asks. `connect` follows other tabs, the width (turning the phone, a narrower
 * window) and keeps the meta viewport in line.
 */
export class MobileLayoutStore {
	/** The switch "Handy-Ansicht (Vorschau)" of this device. */
	enabled = $state(false);

	/** The window is narrower than 40rem (PHONE_QUERY); false without matchMedia. */
	narrow = $state(false);

	readonly #win: Window;
	#connected = 0;

	constructor(win: Window) {
		this.#win = win;
		this.enabled = readMobileLayout(storageOf(win));
		this.narrow = phoneQuery(win)?.matches ?? false;
		applyMobileLayout(win.document.documentElement, this.enabled);
	}

	/** Whether the phone frame applies now: the switch on and a narrow window. */
	get active(): boolean {
		return isPhoneLayout(this.enabled, this.narrow);
	}

	/**
	 * A press (mousedown) on a button that saves leaves the focus in the field in the phone frame
	 * (MO-5, since MO-6 also in "Erfassen"): the on-screen keyboard stays open for the next line
	 * instead of closing and opening again; the click still runs. Elsewhere the button takes the focus
	 * as before.
	 */
	keepFocus(event: MouseEvent): void {
		if (this.active) event.preventDefault();
	}

	choose(enabled: boolean): void {
		this.enabled = enabled;
		applyMobileLayout(this.#win.document.documentElement, enabled);
		writeMobileLayout(storageOf(this.#win), enabled);
		this.#viewport();
	}

	/** The meta viewport follows the frame only while the app layout is connected. */
	#viewport(): void {
		if (this.#connected > 0) applyViewport(this.#win.document, this.active);
	}

	/** Follows other tabs and the width of the window; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		const query = phoneQuery(win);
		const onchange = (event: MediaQueryListEvent) => {
			this.narrow = event.matches;
			this.#viewport();
		};
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key !== null && event.key !== MOBILE_LAYOUT_STORAGE_KEY) return;
			this.enabled = parseMobileLayout(event.key === null ? null : event.newValue);
			applyMobileLayout(win.document.documentElement, this.enabled);
			this.#viewport();
		};
		this.#connected += 1;
		this.narrow = query?.matches ?? false;
		this.#viewport();
		query?.addEventListener('change', onchange);
		win.addEventListener('storage', onstorage);
		return () => {
			query?.removeEventListener('change', onchange);
			win.removeEventListener('storage', onstorage);
			this.#connected -= 1;
			if (this.#connected === 0) applyViewport(win.document, false);
		};
	}
}

let shared: MobileLayoutStore | undefined;

/** The store of the app, created on first use. */
export function getMobileLayoutStore(): MobileLayoutStore {
	shared ??= new MobileLayoutStore(window);
	return shared;
}
