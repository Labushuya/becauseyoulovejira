// Blinking title of a hidden tab (ADR-0035 section 5): while the tab is hidden, the title
// alternates every second between the normal title and ATTENTION_TITLE, for at most 30 s. It stops
// and restores the title as soon as the tab becomes visible, when the page goes away and on
// stop(). A title the app sets in the meantime (a navigation) becomes the one to restore.

import { ATTENTION_TITLE } from './guidance/texts';

export const BLINK_INTERVAL_MS = 1000;
export const BLINK_MAX_MS = 30_000;

type Timers = Pick<
	Window,
	'setInterval' | 'clearInterval' | 'addEventListener' | 'removeEventListener'
>;

export class TitleBlinker {
	readonly #doc: Document;
	readonly #win: Timers;
	#timer: ReturnType<Window['setInterval']> | null = null;
	#original = '';
	#elapsed = 0;

	constructor(doc: Document, win: Timers) {
		this.#doc = doc;
		this.#win = win;
	}

	get running(): boolean {
		return this.#timer !== null;
	}

	/** Starts blinking if the tab is hidden; a new start begins the 30 s again. */
	start(): void {
		if (this.#doc.visibilityState !== 'hidden') return;
		this.#elapsed = 0;
		if (this.#timer !== null) return;
		this.#original = this.#doc.title;
		this.#doc.title = ATTENTION_TITLE;
		this.#timer = this.#win.setInterval(() => this.#tick(), BLINK_INTERVAL_MS);
		this.#doc.addEventListener('visibilitychange', this.#onVisibility);
		this.#win.addEventListener('pagehide', this.#onPageHide);
	}

	/** Stops and restores the normal title. */
	stop(): void {
		if (this.#timer === null) return;
		this.#win.clearInterval(this.#timer);
		this.#timer = null;
		this.#doc.removeEventListener('visibilitychange', this.#onVisibility);
		this.#win.removeEventListener('pagehide', this.#onPageHide);
		if (this.#doc.title === ATTENTION_TITLE) this.#doc.title = this.#original;
	}

	#tick(): void {
		this.#elapsed += BLINK_INTERVAL_MS;
		if (this.#elapsed >= BLINK_MAX_MS) {
			this.stop();
			return;
		}
		if (this.#doc.title === ATTENTION_TITLE) {
			this.#doc.title = this.#original;
		} else {
			this.#original = this.#doc.title;
			this.#doc.title = ATTENTION_TITLE;
		}
	}

	readonly #onVisibility = () => {
		if (this.#doc.visibilityState !== 'hidden') this.stop();
	};

	readonly #onPageHide = () => this.stop();
}
