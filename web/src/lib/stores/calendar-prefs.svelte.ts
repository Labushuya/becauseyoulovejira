// What this device remembers of the calendar (ADR-0053 §2): the last chosen view and the shown
// layers, in localStorage like the way to open tickets (ADR-0036 §1) and the columns (ADR-0030 §5),
// not per user and not in the URL. The URL still names the view it shows, so a link keeps it; the
// remembered one applies to the plain calendar. Below CALENDAR_NARROW_QUERY a calendar without a
// choice starts with the agenda. Blocked or full storage never breaks the calendar, a choice then
// lasts for this page; other tabs follow through the storage event.

import { SvelteSet } from 'svelte/reactivity';
import {
	CALENDAR_LAYERS_STORAGE_KEY,
	CALENDAR_NARROW_QUERY,
	CALENDAR_VIEW_STORAGE_KEY,
	parseLayers,
	serializeLayers,
	viewOf,
	viewValue,
	type CalendarLayer,
	type CalendarView
} from '$lib/domain/calendar';

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(win: Window | null): PrefsStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

function read(win: Window | null, key: string): string | null {
	try {
		return storageOf(win)?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export class CalendarPrefsStore {
	readonly #win: Window | null;
	#view = $state<CalendarView | null>(null);
	#layers = $state.raw<ReadonlySet<CalendarLayer>>(parseLayers(null));
	#narrow = $state(false);

	constructor(win: Window | null) {
		this.#win = win;
		this.#view = viewOf(read(win, CALENDAR_VIEW_STORAGE_KEY));
		this.#layers = parseLayers(read(win, CALENDAR_LAYERS_STORAGE_KEY));
		if (win !== null && typeof win.matchMedia === 'function') {
			this.#narrow = win.matchMedia(CALENDAR_NARROW_QUERY).matches;
		}
	}

	/** The last chosen view, null without a choice. */
	get view(): CalendarView | null {
		return this.#view;
	}

	get layers(): ReadonlySet<CalendarLayer> {
		return this.#layers;
	}

	/** The window is narrow (CALENDAR_NARROW_QUERY); false without matchMedia (tests). */
	get narrow(): boolean {
		return this.#narrow;
	}

	/** Remembers a view the user chose. */
	chooseView(view: CalendarView): void {
		this.#view = view;
		this.#write(CALENDAR_VIEW_STORAGE_KEY, viewValue(view));
	}

	/** Shows or hides a layer and remembers the choice. */
	setLayer(layer: CalendarLayer, shown: boolean): void {
		if (this.#layers.has(layer) === shown) return;
		const others = [...this.#layers].filter((entry) => entry !== layer);
		const next = new SvelteSet<CalendarLayer>(shown ? [...others, layer] : others);
		this.#layers = next;
		this.#write(CALENDAR_LAYERS_STORAGE_KEY, serializeLayers(next));
	}

	#write(key: string, value: string | null): void {
		try {
			const storage = storageOf(this.#win);
			if (value === null) storage?.removeItem(key);
			else storage?.setItem(key, value);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Follows the width of the window and the choices of other tabs; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const cleanups: (() => void)[] = [];
		if (typeof win.matchMedia === 'function') {
			const query = win.matchMedia(CALENDAR_NARROW_QUERY);
			const update = () => {
				this.#narrow = query.matches;
			};
			update();
			query.addEventListener('change', update);
			cleanups.push(() => query.removeEventListener('change', update));
		}
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key === null || event.key === CALENDAR_VIEW_STORAGE_KEY) {
				this.#view = viewOf(event.key === null ? null : event.newValue);
			}
			if (event.key === null || event.key === CALENDAR_LAYERS_STORAGE_KEY) {
				this.#layers = parseLayers(event.key === null ? null : event.newValue);
			}
		};
		win.addEventListener('storage', onstorage);
		cleanups.push(() => win.removeEventListener('storage', onstorage));
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}
}
