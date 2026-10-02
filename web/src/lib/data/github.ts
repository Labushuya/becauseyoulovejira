// GitHub channel (ADR-0050 §7; ADR-0006 sections 1 to 5): the routes under
// /api/byl/connections/{id}/github of app/pb_hooks/github.pb.js. Stateless functions with the
// PocketBase instance as first parameter. The token never reaches the browser: the details come
// from what the runs of the server stored, "Verbindung prüfen" asks GitHub in the server. Errors
// of GitHub come as an answer with status "error" and the German message of the server; a failed
// request is a DataError (404 before the restart, when the server does not know the routes yet).

import type PocketBase from 'pocketbase';
import {
	githubCheckOf,
	githubDetailsOf,
	type GitHubCheck,
	type GitHubDetails
} from '../domain/github';
import { withDataErrors } from './errors';
import type { RequestOptions } from './options';

function routeOf(id: string, name: string): string {
	const base = `/api/byl/connections/${encodeURIComponent(id)}/github`;
	return name === '' ? base : `${base}/${name}`;
}

/** The details of the card: access, rate limit and per repository its state (no request to GitHub). */
export function getGitHubDetails(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<GitHubDetails> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<unknown>(routeOf(id, ''), { method: 'GET', signal });
		return githubDetailsOf(result);
	});
}

/** "Verbindung prüfen": the user of the token, the rate limit and per repository whether it answers. */
export function checkGitHub(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<GitHubCheck> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<unknown>(routeOf(id, 'check'), { method: 'POST', signal });
		return githubCheckOf(result);
	});
}
