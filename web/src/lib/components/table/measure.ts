// Measuring for the tables (ADR-0030): the width of the frame for fitColumns and the natural
// width of a column for the double click on its grip. Browser only; in jsdom every width is 0,
// which the callers read as "not measured".

/**
 * Reports the content width of `element` now and on every change (ResizeObserver); 0 is
 * reported as null. Returns the cleanup.
 */
export function observeWidth(
	element: HTMLElement,
	onwidth: (width: number | null) => void
): () => void {
	const measured = element.clientWidth;
	onwidth(measured > 0 ? measured : null);
	if (typeof ResizeObserver !== 'function') return () => undefined;
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const width = entry.contentRect.width;
			onwidth(width > 0 ? width : null);
		}
	});
	observer.observe(element);
	return () => observer.disconnect();
}

function horizontalPadding(element: Element): number {
	const style = getComputedStyle(element);
	return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
}

/** Width of the content of `element` without wrapping or clipping (the cells are nowrap). */
function contentWidth(element: Element): number {
	const range = element.ownerDocument.createRange();
	range.selectNodeContents(element);
	const width =
		typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect().width : 0;
	range.detach();
	return width;
}

/**
 * Natural width of a column: the widest content of its cells plus their padding. A header cell
 * is measured by its `[data-column-label]` (the grip beside it does not count).
 */
export function naturalWidth(cells: readonly Element[]): number {
	let widest = 0;
	for (const cell of cells) {
		const label = cell.querySelector('[data-column-label]') ?? cell;
		widest = Math.max(widest, contentWidth(label) + horizontalPadding(cell));
	}
	return Math.ceil(widest);
}
