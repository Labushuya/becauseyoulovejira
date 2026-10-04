// Moving between the areas (E7-4, ADR-0060; ADR-0006 sections 1 to 5): POST /api/byl/area/move
// (app/pb_hooks/area.pb.js). A refused request comes as `invalid` with its problem and params (the
// texts in domain/area-move.ts), the server before the restart (404 without the route, 503) as
// `missing`; the session, the network and an aborted signal are DataErrors. Answers are read
// strictly. Dissolving a household is a route of the household (data/household.ts).

import type PocketBase from 'pocketbase';
import { parseMovePreview, type MovePreview } from '../domain/area-move';
import { DataError, toDataError } from './errors';
import type { RequestOptions } from './options';

export type MoveAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'invalid'; problem: string; params: Record<string, unknown> }
	| { kind: 'missing' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	pb: PocketBase,
	path: string,
	body: Record<string, unknown>,
	parse: (answer: unknown) => T | null,
	signal: AbortSignal | undefined
): Promise<MoveAnswer<T>> {
	let answer: unknown;
	try {
		answer = await pb.send(path, { method: 'POST', body, requestKey: null, signal });
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted) {
			if (response.reason === 'invalid' && typeof response.problem === 'string') {
				return {
					kind: 'invalid',
					problem: response.problem,
					params: isRecord(response.params) ? response.params : {}
				};
			}
			if (status === 404 || status === 503) return { kind: 'missing' };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	if (value === null) throw new DataError('server');
	return { kind: 'ok', value };
}

/** The preview (with `preview: true`) or the move of records into the other area. */
export function moveRecords(
	pb: PocketBase,
	body: Record<string, unknown>,
	options: RequestOptions = {}
): Promise<MoveAnswer<MovePreview>> {
	return ask(pb, '/api/byl/area/move', body, parseMovePreview, options.signal);
}
