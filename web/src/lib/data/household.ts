// A household (ADR-0058, E7-2; ADR-0006 sections 1 to 5): the routes of the page "Einstellungen →
// Haushalt" (app/pb_hooks/household.pb.js) and the realtime topic byl/household. A refused request
// comes as `invalid` with its problem (the texts in domain/household.ts), the rate limit of joining
// as `rate`, the server before the restart (503, or 404 without the route) as `missing`; the
// session, the network and an aborted signal are DataErrors. Answers are read strictly.

import type PocketBase from 'pocketbase';
import { parseDissolvePreview, type DissolveMode, type DissolvePreview } from '../domain/area-move';
import {
	parseHouseholdAnswer,
	parseInviteGrant,
	type HouseholdState,
	type InviteGrant
} from '../domain/household';
import { DataError, toDataError } from './errors';
import type { RequestOptions } from './options';
import type { Unsubscribe } from './realtime';

const ROUTE = '/api/byl/household';

/** Realtime topic of the server: the household or a membership of the account changed (no data). */
export const HOUSEHOLD_TOPIC = 'byl/household';

export type HouseholdAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'invalid'; problem: string }
	| { kind: 'rate' }
	| { kind: 'missing' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | undefined
): Promise<HouseholdAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted) {
			if (response.reason === 'invalid' && typeof response.problem === 'string') {
				return { kind: 'invalid', problem: response.problem };
			}
			if (status === 429) return { kind: 'rate' };
			if (status === 503 || status === 404) return { kind: 'missing' };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	if (value === undefined) throw new DataError('server');
	return { kind: 'ok', value };
}

function send(pb: PocketBase, path: string, body: unknown, signal?: AbortSignal) {
	return () =>
		pb.send(path, {
			method: body === undefined ? 'GET' : 'POST',
			body,
			requestKey: null,
			signal
		});
}

const state = (answer: unknown) => parseHouseholdAnswer(answer);

/** The household of the signed-in account, or null without one. */
export function fetchHousehold(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, ROUTE, undefined, options.signal), state);
}

/** Founds a household; the account becomes its owner. */
export function foundHousehold(
	pb: PocketBase,
	name: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, ROUTE, { name }, options.signal), state);
}

/** Renames the household (right "rename"). */
export function renameHousehold(
	pb: PocketBase,
	name: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, `${ROUTE}/rename`, { name }, options.signal), state);
}

/** A new invitation code (right "invite"); the answer carries it once. */
export function createHouseholdInvite(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<InviteGrant>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/invites`, {}, options.signal),
		(answer) => parseInviteGrant(answer) ?? undefined
	);
}

/** Revokes an open code (right "invite"). */
export function revokeHouseholdInvite(
	pb: PocketBase,
	id: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/invites/${encodeURIComponent(id)}/revoke`, {}, options.signal),
		state
	);
}

/** Joins the household of a code; case, spaces and hyphens do not count. */
export function joinHousehold(
	pb: PocketBase,
	code: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, `${ROUTE}/join`, { code }, options.signal), state);
}

/** The rights of a member (right "delegate"). */
export function setHouseholdRights(
	pb: PocketBase,
	memberId: string,
	rights: readonly string[],
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/members/${encodeURIComponent(memberId)}/rights`, { rights }, options.signal),
		state
	);
}

/** Removes a member (right "remove"). */
export function removeHouseholdMember(
	pb: PocketBase,
	memberId: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/members/${encodeURIComponent(memberId)}/remove`, {}, options.signal),
		state
	);
}

/** Hands the household to another member (only the owner). */
export function transferHousehold(
	pb: PocketBase,
	memberId: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/members/${encodeURIComponent(memberId)}/transfer`, {}, options.signal),
		state
	);
}

/** The retention of the trash of the household (E7-3; owner or right "purge"). */
export function setHouseholdRetention(
	pb: PocketBase,
	retention: string,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, `${ROUTE}/retention`, { retention }, options.signal), state);
}

/** Leaves the household (every member but the owner). */
export function leaveHousehold(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<HouseholdAnswer<HouseholdState | null>> {
	return ask(options.signal, send(pb, `${ROUTE}/leave`, {}, options.signal), state);
}

/**
 * Dissolving the household (E7-4, ADR-0060 §5; only its owner): with `preview` what it holds and the
 * codes that would get a suffix, else `adopt` (everything into the private area of the owner) or
 * `delete` (with the typed name). The answer of both is the preview.
 */
export function dissolveHousehold(
	pb: PocketBase,
	body: { mode: DissolveMode; preview?: boolean; name?: string },
	options: RequestOptions = {}
): Promise<HouseholdAnswer<DissolvePreview>> {
	return ask(
		options.signal,
		send(pb, `${ROUTE}/dissolve`, body, options.signal),
		(answer) => parseDissolvePreview(answer) ?? undefined
	);
}

/** What the server says with a change; `dissolved` when the household was dissolved (E7-4). */
export interface HouseholdChange {
	dissolved: boolean;
}

/** Calls `onChange` whenever the server reports a change of the household or a membership. */
export function subscribeHousehold(
	pb: PocketBase,
	onChange: (change: HouseholdChange) => void
): Promise<Unsubscribe> {
	return pb.realtime.subscribe(HOUSEHOLD_TOPIC, (data: unknown) =>
		onChange({ dissolved: isRecord(data) && data.dissolved === true })
	);
}
