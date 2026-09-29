// Client hooks of SvelteKit. handleError turns every error of a navigation into a German message
// for the error pages and marks modules that could not be loaded (ADR-0040): the error page then
// loads the address once more; SvelteKit itself already does so when /_app/version.json names a
// new build. It is also called for failed preloads on hover, so it has no side effects, and it
// writes nothing to the console (no-console: no tokens or session data in the output).

import type { HandleClientError } from '@sveltejs/kit';
import { describeClientError } from '$lib/app-update';

export const handleError: HandleClientError = ({ error }) => describeClientError(error);
