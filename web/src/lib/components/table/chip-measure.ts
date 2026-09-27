// Width of a tag chip for fitChips (ADR-0030 section 6): measureText of an OffscreenCanvas with the
// font of the chips, cached per name, plus padding and border. There is no ResizeObserver per row,
// so hundreds of rows stay cheap. Without a canvas (jsdom) the width is estimated.

import { estimateTextWidth, type MeasureText } from '$lib/domain/columns';

/** Chip font size and horizontal padding in rem (the chips use --font-size-small, 0.375rem). */
const CHIP_FONT_REM = 0.75;
const CHIP_PADDING_REM = 0.75;
/** Border of a chip, left plus right. */
const CHIP_BORDER_PX = 2;
/** Space between two chips and the horizontal padding of the cell, in rem. */
export const CHIP_GAP_REM = 0.25;
export const CELL_PADDING_REM = 1.5;

/** Pixels of 1rem on this page (16 unless the user changed the default font size). */
export function remPx(): number {
	if (typeof document === 'undefined') return 16;
	const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
	return Number.isFinite(size) && size > 0 ? size : 16;
}

function canvasContext(font: string): OffscreenCanvasRenderingContext2D | null {
	if (typeof OffscreenCanvas !== 'function') return null;
	try {
		const context = new OffscreenCanvas(1, 1).getContext('2d');
		if (context === null) return null;
		context.font = font;
		return context;
	} catch {
		return null;
	}
}

/** A measure for the chips of one table; the cache lives as long as the table. */
export function createChipMeasure(): MeasureText {
	const rem = remPx();
	const fontSize = CHIP_FONT_REM * rem;
	const family =
		typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily;
	const context = canvasContext(`${fontSize}px ${family || 'sans-serif'}`);
	const extra = CHIP_PADDING_REM * rem + CHIP_BORDER_PX;
	const cache = new Map<string, number>();
	return (text) => {
		const known = cache.get(text);
		if (known !== undefined) return known;
		const width =
			(context === null ? estimateTextWidth(text, fontSize) : context.measureText(text).width) +
			extra;
		cache.set(text, width);
		return width;
	};
}
