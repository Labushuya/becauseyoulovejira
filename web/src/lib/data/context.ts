// Context of the app in this tab (KX-1, ADR-0057): GET /api/byl/context for signed-in app accounts.
// The answer only picks what the tab shows, so it never fails: 404 (the server does not know the
// route yet, before the restart after an update) is "outdated", every other failure "failed" (the
// tab keeps what it had, or the most restrictive view). A refusal of a route with "loopback",
// "owner" or "platform" says the context is out of date; the data layer reports it here and the
// context store asks again. The capabilities of the tab for texts outside components (the error
// "Server nicht erreichbar", the hint after an update) come from here as well: the context store
// provides them; until then, and in the root tests that load the data layer without it, the most
// restrictive view holds. A read in a template or an effect follows the store, because the
// provider reads its runes.

import type PocketBase from 'pocketbase';
import {
	PENDING_CONTEXT,
	capabilitiesOf,
	isContextRefusal,
	parseContext,
	type AppContext,
	type Capabilities
} from '../domain/context';
import type { RequestOptions } from './options';

const RESTRICTIVE = (): Capabilities => capabilitiesOf(PENDING_CONTEXT);

let provider: () => Capabilities = RESTRICTIVE;

/** The capabilities of this tab now. */
export function currentCapabilities(): Capabilities {
	return provider();
}

/** Sets where the capabilities come from; returns the way back to the restrictive view. */
export function provideCapabilities(next: () => Capabilities): () => void {
	provider = next;
	return () => {
		if (provider === next) provider = RESTRICTIVE;
	};
}

const ROUTE = '/api/byl/context';

export type ContextAnswer =
	{ kind: 'ready'; context: AppContext } | { kind: 'outdated' } | { kind: 'failed' };

function statusOf(error: unknown): number {
	return typeof error === 'object' &&
		error !== null &&
		typeof (error as { status?: unknown }).status === 'number'
		? (error as { status: number }).status
		: 0;
}

export async function fetchContext(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<ContextAnswer> {
	try {
		const answer: unknown = await pb.send(ROUTE, {
			method: 'GET',
			requestKey: null,
			signal: options.signal
		});
		const context = parseContext(answer);
		return context === null ? { kind: 'failed' } : { kind: 'ready', context };
	} catch (error) {
		return statusOf(error) === 404 && !options.signal?.aborted
			? { kind: 'outdated' }
			: { kind: 'failed' };
	}
}

type RefusalListener = () => void;

const listeners = new Set<RefusalListener>();

/** Called by the data layer for every refusal of a route; reports "loopback", "owner", "platform". */
export function reportRefusal(reason: unknown): void {
	if (!isContextRefusal(reason)) return;
	for (const listener of [...listeners]) listener();
}

/** Listens for refusals that make the context out of date; returns the end of the listening. */
export function onContextRefusal(listener: RefusalListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
