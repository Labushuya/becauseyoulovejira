// The focus after an action or "Ergebnis schließen" of the bar of the selection (SelectionBar of
// "Aufgaben", "Papierkorb" and "Eingang"; MO-7c1, Q-1 and Q-2 of the review of MO-7b, ADR-0073 addendum
// MO-7c1). The button that had the focus may be gone with the action (the actions close in the phone
// frame, the result closes): while the bar stands the focus goes into it, otherwise to the heading of
// its list, never to the page (body). Like BulkActionBar since BI-2, now shared.

/** What in the bar can take the focus, in the order of the bar (the first one is taken). */
const IN_BAR = 'button:not([disabled]), [tabindex]';

/**
 * Keeps the focus at the bar: nothing to do while it is inside; else its first button while the bar
 * stands; once the bar is gone, `heading`, but only when the focus was lost with it (an element the
 * user chose meanwhile keeps it). Call it after the DOM has followed the action (`await tick()`), with
 * the heading taken before the action, because the owner of the bar may be gone by then.
 */
export function keepFocusAtBar(
	bar: HTMLElement | null | undefined,
	heading: HTMLElement | null | undefined
): void {
	const active = document.activeElement;
	if (bar?.isConnected) {
		if (bar.contains(active)) return;
		const first = bar.querySelector<HTMLElement>(IN_BAR);
		if (first !== null) {
			first.focus();
			return;
		}
	}
	if (active === null || active === document.body) heading?.focus();
}
