// Stand-in for ResizeObserver, which jsdom lacks (ADR-0030; next to overlay-stubs.ts). Tests set
// the width of an observed element with `resize`; the observers get an entry with that content
// width, as the browser reports it when the frame of a table changes.

import { afterEach, beforeEach } from 'vitest';

type Callback = (entries: { target: Element; contentRect: { width: number } }[]) => void;

const observers = new Set<StubResizeObserver>();

class StubResizeObserver {
	readonly #callback: Callback;
	readonly targets = new Set<Element>();

	constructor(callback: Callback) {
		this.#callback = callback;
		observers.add(this);
	}

	observe(target: Element): void {
		this.targets.add(target);
	}

	unobserve(target: Element): void {
		this.targets.delete(target);
	}

	disconnect(): void {
		this.targets.clear();
		observers.delete(this);
	}

	report(target: Element, width: number): void {
		if (this.targets.has(target)) this.#callback([{ target, contentRect: { width } }]);
	}
}

/** Reports `width` as the new content width of `target` to every observer that watches it. */
export function resize(target: Element, width: number): void {
	for (const observer of [...observers]) observer.report(target, width);
}

/** Installs the stand-in for each test of the calling file and removes it afterwards. */
export function useResizeObserverStub(): void {
	let saved: unknown;
	beforeEach(() => {
		saved = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
	});
	afterEach(() => {
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved;
		observers.clear();
	});
}
