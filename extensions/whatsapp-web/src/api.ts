// Requests of the service worker to the own inbox of the app (ADR-0038 §1): one entry, and
// "Verbindung testen". The key goes only into the Authorization header; answers become the few
// results the content script and the settings page show. `fetchFn` is fetch, or a fake in tests.

import type { IngestPayload } from './payload';
import type { ConnectionSettings } from './settings';

export const INGEST_PATH = '/api/byl/inbox/ingest';
/** Longest wait for the app. */
export const TIMEOUT_MS = 10_000;

export type FailureReason =
	| 'not_configured'
	| 'unreachable'
	| 'unauthorized'
	| 'forbidden'
	| 'rate_limited'
	| 'invalid'
	| 'unavailable'
	| 'server';

export interface Failure {
	status: 'error';
	reason: FailureReason;
	message: string;
}

export type IngestResult =
	{ status: 'created' } | { status: 'duplicate'; state: string } | { status: 'filtered' } | Failure;

export type TestResult = { status: 'ok'; name: string; keywords: number } | Failure;

export const FAILURE_MESSAGES: Readonly<Record<FailureReason, string>> = Object.freeze({
	not_configured:
		'Erst App-Adresse und Zugangsschlüssel in den Einstellungen der Erweiterung eintragen.',
	unreachable:
		'App nicht erreichbar. Läuft becauseyoulovejira (start.bat) unter der eingestellten Adresse?',
	unauthorized: 'Zugangsschlüssel ungültig oder widerrufen. Bitte einen neuen eintragen.',
	forbidden: 'Die App hat die Anfrage abgelehnt.',
	rate_limited: 'Zu viele Anfragen in einer Minute. Bitte kurz warten.',
	invalid: 'Die App hat die Nachricht abgelehnt.',
	unavailable: 'Die App braucht einen Neustart (neu-starten.bat im Ordner app).',
	server: 'Die App hat mit einem Fehler geantwortet.'
});

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

function failure(reason: FailureReason, message = FAILURE_MESSAGES[reason]): Failure {
	return { status: 'error', reason, message };
}

function isFailure(value: Response | Failure): value is Failure {
	return value.status === 'error';
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
	try {
		const value: unknown = await response.json();
		return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function failureOf(status: number, body: Record<string, unknown>): Failure {
	if (status === 401) return failure('unauthorized');
	if (status === 403) return failure('forbidden');
	if (status === 429) return failure('rate_limited');
	if (status === 503) return failure('unavailable');
	if (status === 400) {
		return failure('invalid', typeof body.message === 'string' ? body.message : undefined);
	}
	return failure('server');
}

async function request(
	fetchFn: FetchFn,
	settings: ConnectionSettings,
	init: RequestInit
): Promise<Response | Failure> {
	if (settings.token === '') return failure('not_configured');
	try {
		return await fetchFn(`${settings.appUrl}${INGEST_PATH}`, {
			...init,
			headers: { ...(init.headers ?? {}), Authorization: `Bearer ${settings.token}` },
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'error',
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		return failure('unreachable');
	}
}

/** Sends one entry: created, duplicate (also a discarded one), filtered or a failure. */
export async function sendEntry(
	fetchFn: FetchFn,
	settings: ConnectionSettings,
	payload: IngestPayload
): Promise<IngestResult> {
	const response = await request(fetchFn, settings, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (isFailure(response)) return response;
	const body = await bodyOf(response);
	if (response.status === 201 && body.status === 'created') return { status: 'created' };
	if (response.status === 200 && body.status === 'duplicate') {
		return { status: 'duplicate', state: typeof body.state === 'string' ? body.state : '' };
	}
	if (response.status === 422 && body.status === 'filtered') return { status: 'filtered' };
	return failureOf(response.status, body);
}

/** "Verbindung testen": the name of the key and the keywords of WhatsApp Web, or a failure. */
export async function testConnection(
	fetchFn: FetchFn,
	settings: ConnectionSettings
): Promise<TestResult> {
	const response = await request(fetchFn, settings, { method: 'GET' });
	if (isFailure(response)) return response;
	const body = await bodyOf(response);
	if (response.status === 200 && body.status === 'ok' && typeof body.name === 'string') {
		const keywords =
			typeof body.keywords === 'object' && body.keywords !== null
				? (body.keywords as Record<string, unknown>)['whatsapp-web']
				: undefined;
		return { status: 'ok', name: body.name, keywords: typeof keywords === 'number' ? keywords : 0 };
	}
	return failureOf(response.status, body);
}
