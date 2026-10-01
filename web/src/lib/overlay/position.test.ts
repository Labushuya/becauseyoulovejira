// Placement of popovers (ADR-0025 section 5; plan UI-Konsistenz, package UI-2): start and end
// alignment with a gap of 4 px, flip above the button, clamping to the viewport with 8 px. A
// context menu at the pointer (plan aktionsmenues, AM-3): corner at the pointer, flipping to the
// left and upwards at the edges, clamping as before.

import { describe, expect, it } from 'vitest';
import { place, placeAtPoint, POPOVER_GAP, VIEWPORT_MARGIN, type Rect } from './position';

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

describe('placeAtPoint', () => {
	const MENU = { width: 180, height: 150 };

	it('puts the top left corner of the menu at the pointer, without a gap', () => {
		expect(placeAtPoint({ x: 300, y: 200 }, MENU, VIEWPORT)).toEqual({
			top: 200,
			left: 300,
			maxHeight: 800 - VIEWPORT_MARGIN - 200,
			side: 'bottom'
		});
	});

	it('flips to the left of the pointer near the right edge', () => {
		const position = placeAtPoint({ x: 1150, y: 200 }, MENU, VIEWPORT);

		expect(position.left).toBe(1150 - 180);
		expect(position.top).toBe(200);
	});

	it('flips above the pointer near the bottom edge', () => {
		const position = placeAtPoint({ x: 300, y: 700 }, MENU, VIEWPORT);

		expect(position.side).toBe('top');
		expect(position.top).toBe(700 - 150);
		expect(position.maxHeight).toBe(700 - VIEWPORT_MARGIN);
		expect(position.left).toBe(300);
	});

	it('flips both ways in the bottom right corner', () => {
		const position = placeAtPoint({ x: 1190, y: 790 }, MENU, VIEWPORT);

		expect(position).toEqual({ top: 790 - 150, left: 1190 - 180, maxHeight: 782, side: 'top' });
	});

	it('stays right of the pointer when the left side has even less room, clamped to the edge', () => {
		const position = placeAtPoint({ x: 150, y: 100 }, MENU, { width: 300, height: 600 });

		// 142 px to the left and 142 px to the right: no flip, clamped to 300 - 8 - 180.
		expect(position.left).toBe(112);
	});

	it('keeps the menu inside the viewport at its very edges', () => {
		expect(placeAtPoint({ x: 0, y: 0 }, MENU, VIEWPORT)).toMatchObject({
			top: 0,
			left: VIEWPORT_MARGIN,
			side: 'bottom'
		});
		const wide = placeAtPoint(
			{ x: 100, y: 50 },
			{ width: 400, height: 50 },
			{ width: 300, height: 600 }
		);
		expect(wide.left).toBe(VIEWPORT_MARGIN);
	});

	it('limits the height to the room of the side with more space', () => {
		const position = placeAtPoint({ x: 300, y: 300 }, { width: 180, height: 900 }, VIEWPORT);

		expect(position.side).toBe('bottom');
		expect(position.top).toBe(300);
		expect(position.maxHeight).toBe(800 - VIEWPORT_MARGIN - 300);
	});
});
