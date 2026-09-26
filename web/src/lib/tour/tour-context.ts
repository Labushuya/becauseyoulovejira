// Start of the guided tour for views (plan EH-13): the (app) layout owns the tour and puts a function
// that starts it into the context, so "Erste Schritte" can offer "Kurze Einführung starten". Outside
// the layout there is none, and the step is not offered.

import { getContext, setContext } from 'svelte';

/** Context key; exported for component tests. */
export const TOUR_CONTEXT = Symbol('byl-tour');

/** Starts the guided tour of the (app) layout. */
export type StartTour = () => void;

export function setTourStarter(start: StartTour): StartTour {
	return setContext(TOUR_CONTEXT, start);
}

/** The starter of the layout; undefined outside it. */
export function getTourStarter(): StartTour | undefined {
	return getContext<StartTour | undefined>(TOUR_CONTEXT);
}
