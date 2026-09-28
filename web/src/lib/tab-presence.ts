// Second tab of the same browser (ADR-0035 section 6): a safety net for what the server check of
// start.bat does not catch (a typed address, a bookmark, a throttled tab without ack). Every tab
// listens on the BroadcastChannel "byl-tabs": it answers "hello" with "here" and passes
// "attention" on to the app like a message of the server. A new tab asks only when
// shouldCheckForDuplicate says so, so a tab from a link of the app (middle click) or a reload is
// never touched. Without BroadcastChannel nothing happens.

import { getContext, hasContext, setContext } from 'svelte';
import type { TitleBlinker } from './title-blink';

export const TAB_CHANNEL = 'byl-tabs';
/** sessionStorage key of "Hier weiterarbeiten": this tab stays for the session. */
export const TAB_KEEP_KEY = 'byl-tab-keep';
/** How long a new tab waits for "here". */
export const DUPLICATE_PROBE_MS = 300;

export type TabMessage = { type: 'hello' } | { type: 'here' } | { type: 'attention' };

export interface NavigationFacts {
	/** document.referrer ('' if none). */
	referrer: string;
	/** Origin of this page. */
	origin: string;
	/** Type of the navigation entry: navigate, reload, back_forward, prerender; null if unknown. */
	navigationType: string | null;
	/** "Hier weiterarbeiten" was chosen in this tab. */
	keep: boolean;
	/** Window of the installed app (display-mode standalone): focus-existing handles it. */
	standalone: boolean;
}

/**
 * Whether a new tab asks for an open one: opened from outside the app (no referrer or a foreign
 * one: Windows, a bookmark, a typed address, the landing page) by a plain navigation, not kept
 * and not the window of the installed app.
 */
export function shouldCheckForDuplicate(facts: NavigationFacts): boolean {
	if (facts.keep || facts.standalone || facts.navigationType !== 'navigate') return false;
	if (facts.referrer === '') return true;
	try {
		return new URL(facts.referrer).origin !== facts.origin;
	} catch {
		return true;
	}
}

/** The facts of the current page load; every source that fails counts as "no hint". */
export function currentNavigation(win: Window, doc: Document): NavigationFacts {
	const standalone =
		typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches;
	return {
		referrer: doc.referrer,
		origin: win.location.origin,
		navigationType: navigationTypeOf(win),
		keep: isKept(win),
		standalone
	};
}

function navigationTypeOf(win: Window): string | null {
	try {
		const entry = win.performance.getEntriesByType('navigation')[0];
		return (entry as PerformanceNavigationTiming | undefined)?.type ?? null;
	} catch {
		return null;
	}
}

function isKept(win: Window): boolean {
	try {
		return win.sessionStorage.getItem(TAB_KEEP_KEY) === '1';
	} catch {
		return false;
	}
}

/** Marks this tab as kept for the session ("Hier weiterarbeiten"). */
export function keepTab(win: Window): void {
	try {
		win.sessionStorage.setItem(TAB_KEEP_KEY, '1');
	} catch {
		// Blocked storage: the tab stays anyway, only a reload would ask again.
	}
}

/** What TabPresence needs of a BroadcastChannel. */
export interface ChannelLike {
	postMessage(message: TabMessage): void;
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	close(): void;
}

function isTabMessage(data: unknown): data is TabMessage {
	if (data === null || typeof data !== 'object') return false;
	const type = (data as { type?: unknown }).type;
	return type === 'hello' || type === 'here' || type === 'attention';
}

export class TabPresence {
	readonly #channel: ChannelLike | null;
	/** Handlers of "attention"; the last one registered gets it (the app over the fallback). */
	readonly #handlers: (() => void)[] = [];
	readonly #waiting = new Set<() => void>();
	#answering = false;

	/** `channel` is null without BroadcastChannel; then every method does nothing. */
	constructor(channel: ChannelLike | null) {
		this.#channel = channel;
		channel?.addEventListener('message', this.#onMessage);
	}

	/** Whether this tab answers "hello" (a tab that is still checking itself does not). */
	answer(): void {
		this.#answering = true;
	}

	/** Registers a handler for "attention" of another tab; returns its removal. */
	onAttention(handler: () => void): () => void {
		this.#handlers.push(handler);
		return () => {
			const index = this.#handlers.lastIndexOf(handler);
			if (index >= 0) this.#handlers.splice(index, 1);
		};
	}

	/** True if another tab answers "here" within `ms`. */
	probe(ms = DUPLICATE_PROBE_MS): Promise<boolean> {
		const channel = this.#channel;
		if (channel === null) return Promise.resolve(false);
		return new Promise((resolve) => {
			const found = () => {
				clearTimeout(timer);
				this.#waiting.delete(found);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this.#waiting.delete(found);
				resolve(false);
			}, ms);
			this.#waiting.add(found);
			channel.postMessage({ type: 'hello' });
		});
	}

	/** Asks the other tabs to show their hint. */
	notifyOthers(): void {
		this.#channel?.postMessage({ type: 'attention' });
	}

	close(): void {
		this.#channel?.removeEventListener('message', this.#onMessage);
		this.#channel?.close();
		this.#handlers.length = 0;
		this.#waiting.clear();
	}

	readonly #onMessage = (event: MessageEvent) => {
		const message: unknown = event.data;
		if (!isTabMessage(message)) return;
		if (message.type === 'hello') {
			if (this.#answering) this.#channel?.postMessage({ type: 'here' });
		} else if (message.type === 'here') {
			for (const found of [...this.#waiting]) found();
		} else {
			this.#handlers.at(-1)?.();
		}
	};
}

/** What the root layout shares with the app layout. */
export interface TabContext {
	tabs: TabPresence;
	blinker: TitleBlinker;
}

const TAB_CONTEXT = Symbol('byl-tab-context');

export function setTabContext(context: TabContext): TabContext {
	return setContext(TAB_CONTEXT, context);
}

/** The context of the root layout, or null (a layout rendered on its own, e.g. in tests). */
export function getTabContext(): TabContext | null {
	return hasContext(TAB_CONTEXT) ? getContext<TabContext>(TAB_CONTEXT) : null;
}
