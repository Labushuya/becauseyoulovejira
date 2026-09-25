// Placement of popovers (ADR-0025 section 5): a pure function instead of CSS anchor positioning,
// so Chrome, Opera GX and Firefox show a popover at the same place. Below the button by default,
// above it when there is not enough room below, always inside the viewport.

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
 * Position of a popover of `size` for the button at `anchor` in a viewport of `viewport`, all in
 * CSS pixels relative to the viewport. `bottom-start` aligns the left edges, `bottom-end` the
 * right ones. The popover flips above the button if it does not fit below and there is more room
 * above; it never leaves the viewport minus VIEWPORT_MARGIN.
 */
export function place(anchor: Rect, size: Size, viewport: Size, placement: Placement): Position {
	const below = viewport.height - VIEWPORT_MARGIN - (anchor.bottom + POPOVER_GAP);
	const above = anchor.top - POPOVER_GAP - VIEWPORT_MARGIN;
	const side = size.height > below && above > below ? 'top' : 'bottom';
	const room = Math.max(0, side === 'bottom' ? below : above);
	const height = Math.min(size.height, room);

	const top = side === 'bottom' ? anchor.bottom + POPOVER_GAP : anchor.top - POPOVER_GAP - height;
	const preferredLeft = placement === 'bottom-start' ? anchor.left : anchor.right - size.width;
	const left = clamp(preferredLeft, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width);

	return { top, left, maxHeight: room, side };
}
