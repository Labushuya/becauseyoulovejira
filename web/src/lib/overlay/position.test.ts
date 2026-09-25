// Placement of popovers (ADR-0025 section 5; plan UI-Konsistenz, package UI-2): start and end
// alignment with a gap of 4 px, flip above the button, clamping to the viewport with 8 px.

import { describe, expect, it } from 'vitest';
import { place, POPOVER_GAP, VIEWPORT_MARGIN, type Rect } from './position';

const VIEWPORT = { width: 1200, height: 800 };

function button(left: number, top: number, width = 100, height = 30): Rect {
	return { left, top, right: left + width, bottom: top + height };
}

describe('place', () => {
	it('puts the popover 4 px below the button with the left edges aligned (bottom-start)', () => {
		const position = place(button(200, 100), { width: 180, height: 150 }, VIEWPORT, 'bottom-start');

		expect(position).toEqual({ top: 134, left: 200, maxHeight: 658, side: 'bottom' });
		expect(POPOVER_GAP).toBe(4);
	});

	it('aligns the right edges for bottom-end', () => {
		const position = place(button(600, 100), { width: 180, height: 150 }, VIEWPORT, 'bottom-end');

		expect(position.left).toBe(520);
		expect(position.left + 180).toBe(700);
	});

	it('flips above the button when it does not fit below and there is more room above', () => {
		const anchor = button(200, 700);
		const position = place(anchor, { width: 180, height: 150 }, VIEWPORT, 'bottom-start');

		expect(position.side).toBe('top');
		expect(position.top).toBe(700 - 4 - 150);
		expect(position.maxHeight).toBe(700 - 4 - VIEWPORT_MARGIN);
	});

	it('stays below when neither side has room and below has more', () => {
		const position = place(button(200, 300), { width: 180, height: 900 }, VIEWPORT, 'bottom-start');

		expect(position.side).toBe('bottom');
		expect(position.top).toBe(334);
		expect(position.maxHeight).toBe(800 - 8 - 334);
	});

	it('limits the height above the button to the room there', () => {
		const position = place(button(200, 500), { width: 180, height: 700 }, VIEWPORT, 'bottom-start');

		expect(position.side).toBe('top');
		expect(position.maxHeight).toBe(488);
		expect(position.top).toBe(VIEWPORT_MARGIN);
	});

	it.each([
		['the left edge', button(0, 100), 'bottom-end' as const, VIEWPORT_MARGIN],
		['the right edge', button(1150, 100), 'bottom-start' as const, 1200 - 8 - 180]
	])('clamps to %s of the viewport with 8 px', (_edge, anchor, placement, left) => {
		expect(place(anchor, { width: 180, height: 100 }, VIEWPORT, placement).left).toBe(left);
	});

	it('keeps the left margin when the popover is wider than the viewport', () => {
		const position = place(
			button(20, 10),
			{ width: 400, height: 50 },
			{ width: 300, height: 600 },
			'bottom-end'
		);

		expect(position.left).toBe(VIEWPORT_MARGIN);
	});
});
