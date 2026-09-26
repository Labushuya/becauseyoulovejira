// Opening the quick entry from inside a view (plan EH-11): the (app) layout owns the modal and puts
// a function that opens it into the context, so an empty state can offer "Schnellerfassung (c)"
// without its own dialog. Outside the layout (tests, the login page) there is none, and the
// secondary action is simply left out.

import { getContext, setContext } from 'svelte';

/** Context key; exported for component tests that render a view with an opener. */
export const QUICK_CAPTURE_CONTEXT = Symbol('byl-quick-capture');
const KEY = QUICK_CAPTURE_CONTEXT;

/** Opens the quick entry of the (app) layout. */
export type OpenQuickCapture = () => void;

export function setQuickCaptureOpener(open: OpenQuickCapture): OpenQuickCapture {
	return setContext(KEY, open);
}

/** The opener of the layout; undefined outside it. */
export function getQuickCaptureOpener(): OpenQuickCapture | undefined {
	return getContext<OpenQuickCapture | undefined>(KEY);
}
