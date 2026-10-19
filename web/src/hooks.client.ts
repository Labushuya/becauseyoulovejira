// Client hooks of SvelteKit. handleError turns every error of a navigation into a German message
// for the error pages and marks modules that could not be loaded (ADR-0040): the error page then
// loads the address once more; SvelteKit itself already does so when /_app/version.json names a
// new build. It is also called for failed preloads on hover, so it has no side effects, and it
// writes nothing to the console (no-console: no tokens or session data in the output).
// init runs once when the app starts: from then on the errors nobody caught go into the list
// "Fehler dieser Sitzung" of the tab (FP-1, ADR-0071 §4), on every page, the login included.

import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { describeClientError } from '$lib/app-update';
import { watchUnexpectedErrors } from '$lib/stores/problem-log.svelte';

export const init: ClientInit = () => {
	watchUnexpectedErrors(window);
};

export const handleError: HandleClientError = ({ error }) => describeClientError(error);
