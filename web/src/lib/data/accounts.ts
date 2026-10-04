// Accounts (ADR-0056, E7-1; ADR-0006 sections 1 to 5): the routes of the page "Einstellungen →
// Konten" (app/pb_hooks/accounts.pb.js) and the own account through the Record API (name and
// password on "Einstellungen → Konto"). A refusal of a route (this machine, the address of the
// app, not the administrator, rate limit, before the restart) comes as `denied` with its reason, a
// refused input as `invalid` with its problem; the session, the network and an aborted signal are
// DataErrors. The browser sends Origin itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	parseAccountAnswer,
	parseAccountList,
	parsePasswordGrant,
	type Account,
	type AccountList,
	type PasswordGrant
} from '../domain/accounts';
import { denialOf, type SystemDenial } from '../domain/system';
import { reportRefusal } from './context';
import { toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/accounts';
// Statuses with which the routes refuse, plus 404 without the route (before the restart).
const DENIAL_STATUSES = [403, 404, 409, 429, 503];

export type AccountsAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'denied'; reason: SystemDenial }
	| { kind: 'invalid'; problem: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<AccountsAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && response.reason === 'invalid' && typeof response.problem === 'string') {
			return { kind: 'invalid', problem: response.problem };
		}
		if (!signal?.aborted && (status === 400 || DENIAL_STATUSES.includes(status))) {
			reportRefusal(response.reason);
			return { kind: 'denied', reason: denialOf(status, response.reason) };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	return value === null ? { kind: 'denied', reason: 'script' } : { kind: 'ok', value };
}

function post(pb: PocketBase, path: string, body: unknown, signal?: AbortSignal) {
	return () => pb.send(path, { method: 'POST', body, requestKey: null, signal });
}

/** Every account with e-mail, right, switch and creation (administrator only). */
export function fetchAccounts(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<AccountsAnswer<AccountList>> {
	return ask(
		options.signal,
		() => pb.send(ROUTE, { method: 'GET', requestKey: null, signal: options.signal }),
		parseAccountList
	);
}

/** A new account; the answer has the start password, once. */
export function createAccount(
	pb: PocketBase,
	input: { email: string; name: string },
	options: RequestOptions = {}
): Promise<AccountsAnswer<PasswordGrant>> {
	return ask(options.signal, post(pb, ROUTE, input, options.signal), parsePasswordGrant);
}

/** A new password for another account, once; its sessions end. */
export function resetAccountPassword(
	pb: PocketBase,
	id: string,
	options: RequestOptions = {}
): Promise<AccountsAnswer<PasswordGrant>> {
	return ask(
		options.signal,
		post(pb, `${ROUTE}/${encodeURIComponent(id)}/password`, {}, options.signal),
		parsePasswordGrant
	);
}

/** Disables another account (its sessions end) or enables it again. */
export function setAccountDisabled(
	pb: PocketBase,
	id: string,
	disabled: boolean,
	options: RequestOptions = {}
): Promise<AccountsAnswer<Account>> {
	return ask(
		options.signal,
		post(pb, `${ROUTE}/${encodeURIComponent(id)}/disabled`, { disabled }, options.signal),
		parseAccountAnswer
	);
}

/** Gives or takes the right "Verwalter der App". */
export function setAccountAdmin(
	pb: PocketBase,
	id: string,
	admin: boolean,
	options: RequestOptions = {}
): Promise<AccountsAnswer<Account>> {
	return ask(
		options.signal,
		post(pb, `${ROUTE}/${encodeURIComponent(id)}/admin`, { admin }, options.signal),
		parseAccountAnswer
	);
}

/**
 * A new owner for a household whose owner is disabled or gone (E7-4, ADR-0060 §6): an active member,
 * by its membership. Answers the list like `fetchAccounts`.
 */
export function setHouseholdOwner(
	pb: PocketBase,
	householdId: string,
	memberId: string,
	options: RequestOptions = {}
): Promise<AccountsAnswer<AccountList>> {
	return ask(
		options.signal,
		post(
			pb,
			`${ROUTE}/households/${encodeURIComponent(householdId)}/owner`,
			{ member: memberId },
			options.signal
		),
		parseAccountList
	);
}

/** The own display name; the SDK updates the signed-in record with the answer. */
export async function saveOwnName(
	pb: PocketBase,
	id: string,
	name: string,
	options: RequestOptions = {}
): Promise<string> {
	const record = await withDataErrors(options.signal, () =>
		pb.collection('users').update(id, { name }, { requestKey: null, signal: options.signal })
	);
	return typeof record.name === 'string' ? record.name : name;
}

/**
 * The own password with the old one (PocketBase checks it). A new password ends every session of
 * the account, also this one, so the app signs in again with the new password right after.
 */
export async function changeOwnPassword(
	pb: PocketBase,
	input: { id: string; email: string; current: string; next: string },
	options: RequestOptions = {}
): Promise<void> {
	await withDataErrors(options.signal, () =>
		pb
			.collection('users')
			.update(
				input.id,
				{ oldPassword: input.current, password: input.next, passwordConfirm: input.next },
				{ requestKey: null, signal: options.signal }
			)
	);
	await withDataErrors(options.signal, () =>
		pb.collection('users').authWithPassword(input.email, input.next, { requestKey: null })
	);
}
