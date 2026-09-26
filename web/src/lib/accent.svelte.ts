// Accent themes (ADR-0027; CLAUDE.md section 8): Petrol (default), Rubin, Purpur, Smaragd, Honig,
// each in light and dark, independent of the mode in theme.svelte.ts. The choice lives in
// localStorage under ACCENT_STORAGE_KEY, only on this device: one of STORED_ACCENTS; "Petrol"
// removes the key. tokens.css holds the colors under data-accent on the root element. The inline
// script in app.html applies the stored choice before the first paint with the same allowlist;
// theme-boot.test.ts keeps both in line with this module.

export type AccentTheme = 'petrol' | 'rubin' | 'purpur' | 'smaragd' | 'honig';

export const ACCENT_STORAGE_KEY = 'byl-accent';

/** All themes in the order of the menu and the page "Darstellung"; Petrol is the default. */
export const ACCENT_THEMES: readonly AccentTheme[] = [
	'petrol',
	'rubin',
	'purpur',
	'smaragd',
	'honig'
];

export const DEFAULT_ACCENT: AccentTheme = 'petrol';

/** Values that are stored and set as data-accent (the allowlist of app.html). */
export const STORED_ACCENTS: readonly Exclude<AccentTheme, 'petrol'>[] = [
	'rubin',
	'purpur',
	'smaragd',
	'honig'
];

/** Names of the themes in the menu and on the page. */
export const ACCENT_LABELS: Record<AccentTheme, string> = {
	petrol: 'Petrol',
	rubin: 'Rubin',
	purpur: 'Purpur',
	smaragd: 'Smaragd',
	honig: 'Honig'
};

/** One line per theme for the tiles of the page "Darstellung". */
export const ACCENT_DESCRIPTIONS: Record<AccentTheme, string> = {
	petrol: 'Blaugrün, der Standard.',
	rubin: 'Karminrot mit einem Hauch Magenta.',
	purpur: 'Dunkles Violett.',
	smaragd: 'Kräftiges Grün.',
	honig: 'Bernstein, im Dunkeln Gold.'
};

function isStoredAccent(value: unknown): value is Exclude<AccentTheme, 'petrol'> {
	return (STORED_ACCENTS as readonly unknown[]).includes(value);
}

/** Only the stored themes count; everything else means Petrol. */
export function parseAccent(value: string | null | undefined): AccentTheme {
	return isStoredAccent(value) ? value : DEFAULT_ACCENT;
}

/** The stored choice; a storage that throws (blocked, private mode) means Petrol. */
export function readAccent(storage: Pick<Storage, 'getItem'> | null): AccentTheme {
	try {
		return parseAccent(storage?.getItem(ACCENT_STORAGE_KEY));
	} catch {
		return DEFAULT_ACCENT;
	}
}

/** Stores the choice; false if the storage refused it (the choice then lasts for this page). */
export function writeAccent(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	accent: AccentTheme
): boolean {
	if (storage === null) return false;
	try {
		if (accent === DEFAULT_ACCENT) storage.removeItem(ACCENT_STORAGE_KEY);
		else storage.setItem(ACCENT_STORAGE_KEY, accent);
		return true;
	} catch {
		return false;
	}
}

/** Sets or removes data-accent on the root element; tokens.css does the rest. */
export function applyAccent(root: Element, accent: AccentTheme): void {
	if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent');
	else root.setAttribute('data-accent', accent);
}

function storageOf(win: Window): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

/** The current accent of this tab; `connect` follows the choice made in other tabs. */
export class AccentStore {
	accent = $state<AccentTheme>(DEFAULT_ACCENT);

	readonly #win: Window;

	constructor(win: Window) {
		this.#win = win;
		this.accent = readAccent(storageOf(win));
	}

	choose(accent: AccentTheme): void {
		this.accent = accent;
		applyAccent(this.#win.document.documentElement, accent);
		writeAccent(storageOf(this.#win), accent);
	}

	/** Follows changes of the key in other tabs (storage event); returns the unsubscribe. */
	connect(): () => void {
		const onstorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== ACCENT_STORAGE_KEY) return;
			this.accent = parseAccent(event.key === null ? null : event.newValue);
			applyAccent(this.#win.document.documentElement, this.accent);
		};
		this.#win.addEventListener('storage', onstorage);
		return () => this.#win.removeEventListener('storage', onstorage);
	}
}

let shared: AccentStore | undefined;

/** The store of the app, created on first use. */
export function getAccentStore(): AccentStore {
	shared ??= new AccentStore(window);
	return shared;
}
