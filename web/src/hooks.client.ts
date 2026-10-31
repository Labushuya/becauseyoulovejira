// Client hooks of SvelteKit. handleError turns every error of a navigation into a German message
// for the error pages and marks modules that could not be loaded (ADR-0040): the error page then
// loads the address once more; SvelteKit itself already does so when /_app/version.json names a
// new build. It is also called for failed preloads on hover, so it has no side effects, and it
// writes nothing to the console (no-console: no tokens or session data in the output).
// init runs once when the app starts: from then on the errors nobody caught go into the list
// "Fehler dieser Sitzung" of the tab (FP-1, ADR-0071 §4), on every page, the login included. It
// also holds the address the app opened, before the root layout checks the stored session; the app
// layout decides the start view of the phone frame from it (MO-7c2, lib/app-start.ts).

import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { holdStart } from '$lib/app-start';
import { describeClientError } from '$lib/app-update';
import { watchUnexpectedErrors } from '$lib/stores/problem-log.svelte';

export const init: ClientInit = () => {
	holdStart(window);
	watchUnexpectedErrors(window);
};

export const handleError: HandleClientError = ({ error }) => describeClientError(error);
