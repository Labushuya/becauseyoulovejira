// Steps of the guided tour (ADR-0026 section 8, plan EH-13): at most five, each on a stable
// data-tour attribute instead of a CSS class. A step with `path` lives on another page; the tour
// goes there before it shows the step. tour-steps.test.ts checks that every target exists in the
// sources and that the texts are German and short.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

export interface TourStep {
	/** Value of the data-tour attribute of the target. */
	readonly target: string;
	/** Page of the target; null for targets in the header and the view switch (on every page). */
	readonly path: ResolvedPathname | null;
	readonly title: string;
	/** At most two sentences (ADS spotlight). */
	readonly description: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
	{
		target: 'quick-capture',
		path: null,
		title: 'Schnellerfassung',
		description:
			'Mit c oder hier notierst du ein Ticket in einer Zeile. @CODE, !hoch und #tag setzen Projekt, Priorität und Tags.'
	},
	{
		target: 'inbox',
		path: null,
		title: 'Eingang',
		description:
			'Hier landet, was deine Kanäle abrufen oder du hereinziehst. Du entscheidest, was ein Ticket wird.'
	},
	{
		target: 'filter-bar',
		path: resolve('/'),
		title: 'Filterleiste',
		description:
			'Filtere die Aufgaben nach Status, Projekt, Tag, Priorität, Fälligkeit und Quelle. Die Filter stehen in der Adresse.'
	},
	{
		target: 'project-layout',
		path: resolve('/projekte'),
		title: 'Liste oder Kacheln',
		description:
			'Projekte zeigst du als sortierbare Liste oder als Kacheln. Die Wahl merkt sich die App.'
	},
	{
		target: 'channel-catalog',
		path: resolve('/einstellungen/kanaele'),
		title: 'Kanäle',
		description:
			'Verbinde Kalender, Telegram oder ein Postfach. Ein Assistent führt dich Schritt für Schritt.'
	}
];

/** CSS selector of a target. */
export function tourSelector(target: string): string {
	return `[data-tour="${target}"]`;
}
