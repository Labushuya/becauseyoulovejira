// Switch "Transparenz" (ADR-0029 section 7; CLAUDE.md section 8): the glass of the control layer is
// on by default. The choice lives in localStorage under TRANSPARENCY_STORAGE_KEY, only on this
// device, and only "off" is stored; "on" removes the key. tokens.css makes everything opaque under
// data-transparency="off" on the root element. The inline script in app.html applies the stored
// choice before the first paint; theme-boot.test.ts keeps it in line with this module. The system
// setting "reduce transparency" always wins: tokens.css follows the media query on its own, the
// store only reports it, so the page can say so.

export type Transparency = 'on' | 'off';

export const TRANSPARENCY_STORAGE_KEY = 'byl-transparency';

/** The only stored value and the value of data-transparency (the allowlist of app.html). */
export const TRANSPARENCY_OFF = 'off';

export const DEFAULT_TRANSPARENCY: Transparency = 'on';

/** The system setting that makes the glass opaque regardless of the switch. */
export const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

/** Only "off" counts; everything else (missing, unknown) means the default "on". */
export function parseTransparency(value: string | null | undefined): Transparency {
	return value === TRANSPARENCY_OFF ? 'off' : DEFAULT_TRANSPARENCY;
}

/** The stored choice; a storage that throws (blocked, private mode) means "on". */
export function readTransparency(storage: Pick<Storage, 'getItem'> | null): Transparency {
	try {
		return parseTransparency(storage?.getItem(TRANSPARENCY_STORAGE_KEY));
	} catch {
		return DEFAULT_TRANSPARENCY;
	}
}

/** Stores the choice; false if the storage refused it (the choice then lasts for this page). */
export function writeTransparency(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	transparency: Transparency
): boolean {
	if (storage === null) return false;
	try {
		if (transparency === 'off') storage.setItem(TRANSPARENCY_STORAGE_KEY, TRANSPARENCY_OFF);
		else storage.removeItem(TRANSPARENCY_STORAGE_KEY);
		return true;
	} catch {
		return false;
	}
}

/** Sets or removes data-transparency on the root element; tokens.css does the rest. */
export function applyTransparency(root: Element, transparency: Transparency): void {
	if (transparency === 'off') root.setAttribute('data-transparency', TRANSPARENCY_OFF);
	else root.removeAttribute('data-transparency');
}

function storageOf(win: Window): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

/** The media query of the system setting, or null where matchMedia is missing. */
function reducedQuery(win: Window): MediaQueryList | null {
	return typeof win.matchMedia === 'function' ? win.matchMedia(REDUCED_TRANSPARENCY_QUERY) : null;
}

/**
 * The switch of this tab and whether the system reduces transparency; `connect` follows the choice
 * made in other tabs and changes of the system setting.
 */
export class TransparencyStore {
	transparency = $state<Transparency>(DEFAULT_TRANSPARENCY);

	/** True while the system setting makes the glass opaque anyway. */
	systemReduces = $state(false);

	readonly #win: Window;

	constructor(win: Window) {
		this.#win = win;
		this.transparency = readTransparency(storageOf(win));
		this.systemReduces = reducedQuery(win)?.matches ?? false;
	}

	choose(transparency: Transparency): void {
		this.transparency = transparency;
		applyTransparency(this.#win.document.documentElement, transparency);
		writeTransparency(storageOf(this.#win), transparency);
	}

	/** Follows other tabs (storage event) and the system setting; returns the unsubscribe. */
	connect(): () => void {
		const onstorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== TRANSPARENCY_STORAGE_KEY) return;
			this.transparency = parseTransparency(event.key === null ? null : event.newValue);
			applyTransparency(this.#win.document.documentElement, this.transparency);
		};
		const query = reducedQuery(this.#win);
		const onchange = (event: MediaQueryListEvent) => {
			this.systemReduces = event.matches;
		};
		this.systemReduces = query?.matches ?? false;
		this.#win.addEventListener('storage', onstorage);
		query?.addEventListener('change', onchange);
		return () => {
			this.#win.removeEventListener('storage', onstorage);
			query?.removeEventListener('change', onchange);
		};
	}
}

let shared: TransparencyStore | undefined;

/** The store of the app, created on first use. */
export function getTransparencyStore(): TransparencyStore {
	shared ??= new TransparencyStore(window);
	return shared;
}
