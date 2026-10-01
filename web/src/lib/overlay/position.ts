// Placement of popovers (ADR-0025 section 5): a pure function instead of CSS anchor positioning,
// so Chrome, Opera GX and Firefox show a popover at the same place. Below the button by default,
// above it when there is not enough room below, always inside the viewport. A context menu
// (plan aktionsmenues, AM-3) opens at the pointer instead: a virtual anchor without size, from
// which the menu flips to the left and upwards near the edges, like the menus of the system.

export type Placement = 'bottom-start' | 'bottom-end';

export interface Rect {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

export interface Size {
	width: number;
	height: number;
}

/** A point in CSS pixels relative to the viewport, e.g. the pointer of a right click. */
export interface Point {
	x: number;
	y: number;
}

/**
 * Where a popover opens when code opens it instead of its button (plan aktionsmenues, AM-3): at
 * the pointer of a right click, or below another element (the focused one for Shift+F10).
 */
export type VirtualAnchor = { point: Point } | { element: HTMLElement };

export interface Position {
	top: number;
	left: number;
	/** Room for the popover on the chosen side; the popover must not grow beyond it. */
	maxHeight: number;
	side: 'bottom' | 'top';
}

/** Gap between the button and the popover. */
export const POPOVER_GAP = 4;
/** Minimal distance to the edge of the viewport. */
export const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Side, top and room of a popover of `height` below or above `anchor` with `gap` in between: below
 * if it fits, else on the side with more room.
 */
function vertical(
	anchor: Rect,
	height: number,
	viewport: Size,
	gap: number
): Pick<Position, 'top' | 'maxHeight' | 'side'> {
	const below = viewport.height - VIEWPORT_MARGIN - (anchor.bottom + gap);
	const above = anchor.top - gap - VIEWPORT_MARGIN;
	const side = height > below && above > below ? 'top' : 'bottom';
	const room = Math.max(0, side === 'bottom' ? below : above);
	const shown = Math.min(height, room);
	const top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - shown;
	return { top, maxHeight: room, side };
}

/**
 * Position of a popover of `size` for the button at `anchor` in a viewport of `viewport`, all in
 * CSS pixels relative to the viewport. `bottom-start` aligns the left edges, `bottom-end` the
 * right ones. The popover flips above the button if it does not fit below and there is more room
 * above; it never leaves the viewport minus VIEWPORT_MARGIN.
 */
export function place(anchor: Rect, size: Size, viewport: Size, placement: Placement): Position {
	const preferredLeft = placement === 'bottom-start' ? anchor.left : anchor.right - size.width;
	const left = clamp(preferredLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width);
	return { ...vertical(anchor, size.height, viewport, POPOVER_GAP), left };
}

/**
 * Position of a context menu of `size` at `point`, the pointer of a right click (AM-3): its top
 * left corner at the pointer, without a gap. Near the right edge it flips to the left of the
 * pointer, near the bottom above it, each only where that side has more room; whatever still does
 * not fit is clamped into the viewport minus VIEWPORT_MARGIN, as with `place`.
 */
export function placeAtPoint(point: Point, size: Size, viewport: Size): Position {
	const anchor = { top: point.y, bottom: point.y, left: point.x, right: point.x };
	const right = viewport.width - VIEWPORT_MARGIN - point.x;
	const leftRoom = point.x - VIEWPORT_MARGIN;
	const preferredLeft = size.width > right && leftRoom > right ? point.x - size.width : point.x;
	const left = clamp(preferredLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width);
	return { ...vertical(anchor, size.height, viewport, 0), left };
}
