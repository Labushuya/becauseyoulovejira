// The views of the app as the navigation names and links them (ADR-0066 §1): one name and one link
// rule per view, shared by the navigation of the views on the PC (ViewSwitch) and by the bottom bar
// and "Mehr" of the phone frame (MO-1a, ADR-0073), so both lead to the same addresses. A view keeps
// its state while it is shown ("Aufgaben" the list state, "Tagesplan" its day, "Eingang" its chips,
// "Kalender" its view, date and filters, "Erledigte" its filters); from elsewhere the link leads to
// the plain view.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { AreaView } from '$lib/domain/area';
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

/** Link to `view`; with its state of `url` while it is the current view. */
export function viewHref(view: AreaView, current: AreaView | null, url: URL): ResolvedPathname {
	const shown = view === current;
	switch (view) {
		case 'tasks':
			return shown ? listHref(url) : resolve('/');
		case 'dayplan':
			return shown ? dayPlanHref(url) : dayPlanHref();
		case 'projects':
			return projectsHref();
		case 'inbox':
			return shown ? inboxHref(url) : inboxHref();
		case 'recurrences':
			return recurrencesHref();
		case 'calendar':
			return shown ? calendarHref(url) : calendarHref();
		case 'done':
			return shown ? doneViewHref(url) : doneHref();
		case 'trash':
			return trashHref();
	}
}
