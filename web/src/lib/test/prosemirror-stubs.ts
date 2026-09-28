// Stand-ins for the layout APIs that ProseMirror uses and jsdom lacks (plan editor section 3.6;
// next to overlay-stubs.ts): client rects of a Range and elementFromPoint. jsdom has no layout,
// so every rect is empty; the position of menus stays a manual case of the test manifest.
// Typing goes through `typeText` (handleTextInput, so input rules apply), keys as KeyboardEvent
// on the editable element.

import { afterAll, beforeAll } from 'vitest';

const EMPTY_RECT = {
	x: 0,
	y: 0,
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	width: 0,
	height: 0,
	toJSON: () => ({})
};

/** Installs the stand-ins for all tests of the calling file. */
export function useProseMirrorStubs(): void {
	const saved: { rects?: unknown; bounds?: unknown; fromPoint?: unknown } = {};
	beforeAll(() => {
		const range = Range.prototype as unknown as Record<string, unknown>;
		saved.rects = range.getClientRects;
		saved.bounds = range.getBoundingClientRect;
		saved.fromPoint = (document as unknown as Record<string, unknown>).elementFromPoint;
		range.getClientRects = () => ({
			length: 0,
			item: () => null,
			[Symbol.iterator]: [][Symbol.iterator]
		});
		range.getBoundingClientRect = () => EMPTY_RECT;
		(document as unknown as Record<string, unknown>).elementFromPoint = () => null;
	});
	afterAll(() => {
		const range = Range.prototype as unknown as Record<string, unknown>;
		range.getClientRects = saved.rects;
		range.getBoundingClientRect = saved.bounds;
		(document as unknown as Record<string, unknown>).elementFromPoint = saved.fromPoint;
	});
}

/** The part of a ProseMirror view the helpers need. */
interface ViewLike {
	state: {
		selection: { from: number; to: number };
		tr: { insertText(text: string, from: number, to: number): unknown };
	};
	dispatch(transaction: never): void;
	someProp(
		name: 'handleTextInput',
		f: (handler: (view: never, from: number, to: number, text: string) => boolean) => boolean
	): boolean | undefined;
}

/** Types `text` character by character at the selection, as the browser would (input rules run). */
export function typeText(view: ViewLike, text: string): void {
	for (const char of text) {
		const { from, to } = view.state.selection;
		const handled = view.someProp('handleTextInput', (handler) =>
			handler(view as never, from, to, char)
		);
		if (!handled) view.dispatch(view.state.tr.insertText(char, from, to) as never);
	}
}
