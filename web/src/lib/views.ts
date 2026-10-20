// The views of the app as the navigation names and links them (ADR-0066 §1): one name and one link
// rule per view, shared by the navigation of the views on the PC (ViewSwitch) and by the bottom bar
// and "Mehr" of the phone frame (MO-1a, ADR-0073), so both lead to the same addresses. A view keeps
// its state while it is shown ("Aufgaben" the list state, "Tagesplan" its day, "Eingang" its chips,
// "Kalender" its view, date and filters, "Erledigte" its filters); from elsewhere the link leads to
// the plain view. Since MO-6 (ADR-0073 addendum MO-6) also the name of the arrow back to a view and
// whether the page before a page of the phone frame is the page of a view.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { AreaView } from '$lib/domain/area';
import { VIEW_ORDER } from '$lib/domain/phone-layout';
import {
	CALENDAR_HOST,
	DAY_PLAN_HOST,
	DONE_HOST,
	INBOX_HOST,
	LIST_HOST,
	PROJECTS_HOST,
	RECURRENCES_HOST
} from '$lib/ticket-host';
import {
	calendarHref,
	dayPlanHref,
	doneHref,
	doneViewHref,
	inboxHref,
	listHref,
	projectsHref,
	recurrencesHref,
	trashHref
} from '$lib/ticket-links';

export const VIEW_LABELS: Readonly<Record<AreaView, string>> = {
	tasks: 'Aufgaben',
	dayplan: 'Tagesplan',
	projects: 'Projekte',
	inbox: 'Eingang',
	recurrences: 'Wiederholungen',
	calendar: 'Kalender',
	done: 'Erledigte',
	trash: 'Papierkorb'
};

/** The plain link to `view`, without a state: the link from elsewhere. */
export function viewPath(view: AreaView): ResolvedPathname {
	switch (view) {
		case 'tasks':
			return resolve('/');
		case 'dayplan':
			return dayPlanHref();
		case 'projects':
			return projectsHref();
		case 'inbox':
			return inboxHref();
		case 'recurrences':
			return recurrencesHref();
		case 'calendar':
			return calendarHref();
		case 'done':
			return doneHref();
		case 'trash':
			return trashHref();
	}
}

/** Link to `view`; with its state of `url` while it is the current view. */
export function viewHref(view: AreaView, current: AreaView | null, url: URL): ResolvedPathname {
	if (view !== current) return viewPath(view);
	switch (view) {
		case 'tasks':
			return listHref(url);
		case 'dayplan':
			return dayPlanHref(url);
		case 'inbox':
			return inboxHref(url);
		case 'calendar':
			return calendarHref(url);
		case 'done':
			return doneViewHref(url);
		default:
			return viewPath(view);
	}
}

/**
 * Name of the arrow back to a view in the phone frame (MO-4, MO-6): the way back the tickets of the
 * view name ("Zum Tagesplan", "Zur Liste"), and "Zum Papierkorb" for the trash, which has no tickets.
 */
export const VIEW_BACK_LABELS: Readonly<Record<AreaView, string>> = Object.freeze({
	tasks: LIST_HOST.backLabel,
	dayplan: DAY_PLAN_HOST.backLabel,
	projects: PROJECTS_HOST.backLabel,
	inbox: INBOX_HOST.backLabel,
	recurrences: RECURRENCES_HOST.backLabel,
	calendar: CALENDAR_HOST.backLabel,
	done: DONE_HOST.backLabel,
	trash: 'Zum Papierkorb'
});

/** Path of an address of the app, without query and fragment. */
function pathOf(entry: string): string {
	return entry.split(/[?#]/, 1)[0] ?? '';
}

/**
 * The view whose own page the address `entry` (path and query of the app) shows, in whatever state:
 * the list of the view, where its bar and "＋" stand. Null for a panel, a form, a ticket and the
 * settings.
 */
export function viewOfEntry(entry: string): AreaView | null {
	const path = pathOf(entry);
	return VIEW_ORDER.find((view) => pathOf(viewPath(view)) === path) ?? null;
}

/**
 * Where the arrow of a page in the phone frame leads (MO-6, ADR-0073 addendum MO-6). When the page
 * right before it in the history is the page of a view (`previous`, as `previousEntry` of
 * lib/way-back.ts knows it): back through the history to that view, named after it, like the back
 * gesture of Android, so the list of the inbox comes back with its chips and its place, and an entry
 * captured with "＋" leads back to the view of the capture. Otherwise (opened from outside, reloaded,
 * reached from a ticket or a form): a new navigation to `own`, the view of the page, like the × on
 * the PC.
 */
export function arrowBack(
	previous: string | null,
	own: AreaView
): { label: string; throughHistory: boolean } {
	const before = previous === null ? null : viewOfEntry(previous);
	return before === null
		? { label: VIEW_BACK_LABELS[own], throughHistory: false }
		: { label: VIEW_BACK_LABELS[before], throughHistory: true };
}
