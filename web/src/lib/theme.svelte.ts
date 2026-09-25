// Light and dark mode (ADR-0025 section 10; CLAUDE.md section 8). The choice lives in
// localStorage under THEME_STORAGE_KEY, only on this device: "light" or "dark"; "Wie System"
// removes the key, and tokens.css then follows the system setting live through its media query.
// The inline script in app.html applies the stored choice before the first paint and moves the
// old key td-theme over once; theme-boot.test.ts keeps both in line with this module.

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'byl-theme';
/** Key of the earlier boot script; app.html moves a valid value over and removes it. */
export const LEGACY_THEME_STORAGE_KEY = 'td-theme';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Entries of the menu. */
export const THEME_LABELS: Record<ThemePreference, string> = {
	light: 'Hell',
	dark: 'Dunkel',
	system: 'Wie System'
};

/** Only "light" and "dark" count; everything else means the system setting. */
export function parsePreference(value: string | null | undefined): ThemePreference {
	return value === 'light' || value === 'dark' ? value : 'system';
}

/** The stored choice; a storage that throws (blocked, private mode) means the system setting. */
export function readPreference(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
	try {
		return parsePreference(storage?.getItem(THEME_STORAGE_KEY));
	} catch {
		return 'system';
	}
}

/** Stores the choice; false if the storage refused it (the choice then lasts for this page). */
export function writePreference(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	preference: ThemePreference
): boolean {
	if (storage === null) return false;
	try {
		if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY);
		else storage.setItem(THEME_STORAGE_KEY, preference);
		return true;
	} catch {
		return false;
	}
}

/** Sets or removes data-theme on the root element; tokens.css does the rest. */
export function applyPreference(root: Element, preference: ThemePreference): void {
	if (preference === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', preference);
}

function storageOf(win: Window): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

/** The current choice of this tab; `connect` follows the choice made in other tabs. */
export class ThemeStore {
	preference = $state<ThemePreference>('system');

	readonly #win: Window;

	constructor(win: Window) {
		this.#win = win;
		this.preference = readPreference(storageOf(win));
	}

	choose(preference: ThemePreference): void {
		this.preference = preference;
		applyPreference(this.#win.document.documentElement, preference);
		writePreference(storageOf(this.#win), preference);
	}

	/** Follows changes of the key in other tabs (storage event); returns the unsubscribe. */
	connect(): () => void {
		const onstorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
			this.preference = parsePreference(event.key === null ? null : event.newValue);
			applyPreference(this.#win.document.documentElement, this.preference);
		};
		this.#win.addEventListener('storage', onstorage);
		return () => this.#win.removeEventListener('storage', onstorage);
	}
}

let shared: ThemeStore | undefined;

/** The store of the app, created on first use. */
export function getThemeStore(): ThemeStore {
	shared ??= new ThemeStore(window);
	return shared;
}
