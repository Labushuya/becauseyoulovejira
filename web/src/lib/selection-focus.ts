// The focus after an action or "Ergebnis schließen" of the bar of the selection (SelectionBar of
// "Aufgaben", "Papierkorb" and "Eingang"; MO-7c1, Q-1 and Q-2 of the review of MO-7b, ADR-0073 addendum
// MO-7c1). The button that had the focus may be gone with the action (the actions close in the phone
// frame, a running action replaces the buttons, the result closes): while the bar stands the focus
// goes into it, otherwise to the heading of its list, never to the page (body). Like BulkActionBar
// since BI-2, now shared; since NA-1 (C5) also "Verwerfen (n)" and "Wiederherstellen (n)" of the inbox.

/** What in the bar can take the focus, in the order of the bar (the first one is taken). */
const IN_BAR = 'button:not([disabled]), [tabindex]';

/**
 * Keeps the focus at the bar, but only a focus the action lost (on the page, body): its first button
 * while the bar stands, else `heading`. A focus in the bar stays, and so does an element the user
 * chose meanwhile, also during a long run (NA-1, C4; before, the bar took it back). Every caller is an
 * action of the bar, so a lost focus was in the bar or in a dialog opened from it. Call it after the
 * DOM has followed the action (`await tick()`), with the heading taken before the action, because the
 * owner of the bar may be gone by then.
 */
export function keepFocusAtBar(
	bar: HTMLElement | null | undefined,
	heading: HTMLElement | null | undefined
): void {
	const active = document.activeElement;
	if (active !== null && active !== document.body) return;
	const first = bar?.isConnected === true ? bar.querySelector<HTMLElement>(IN_BAR) : null;
	(first ?? heading)?.focus();
}
