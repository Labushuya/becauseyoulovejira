// Client of the ingest routes of PocketBase (app/pb_hooks/ingest.pb.js; ADR-0016 section 5). The
// token goes only into the Authorization header; answers are checked before they are used.

import type { IngestDraft } from './mail';
import { scanStateOf, type ScanState } from './scan-state';

const TIMEOUT_MS = 30_000;
const CURSOR_PATTERN = /^\d{1,10}:\d{1,10}$/;
const ID_PATTERN = /^[a-z0-9]{15}$/;

/** A mail connection as the ingest route lists it (no owner, no secret, only the variable name). */
export interface MailConnection {
	id: string;
	label: string;
	provider: string;
	user: string;
	secretEnv: string;
	keywords: string[];
	matchBody: boolean;
	/** "UIDVALIDITY:UID" of the last checked mail, '' before the first run. */
	cursor: string;
	/** State of the full scan of the inbox (connections.scan); null before the first scan. */
	scan: ScanState | null;
}

export type IngestResult =
	| { status: 'created'; item: string }
	| { status: 'duplicate'; item: string; state: string }
	/** A fetched mail without keyword; the route saved nothing. */
	| { status: 'unmatched' }
	/** The connection is gone or switched off. */
	| { status: 'gone' }
	/** The route refused the mail (for example a field the hook does not accept). */
	| { status: 'rejected'; message: string };

export interface StatusReport {
	/** Cleaned error text; '' after a good run. */
	error: string;
	hint?: string;
	cursor?: string;
	/** State of the full scan (scanStateValue); since 0.7.0. */
	scan?: Record<string, unknown>;
}

/**
 * Why PocketBase could not be used: not reachable (stopped, starting), no ingest route (started
 * without BYL_INGEST_TOKEN), token refused, route missing before the migration, or an unexpected
 * answer. A run ends there and tries again at the next interval.
 */
export class IngestError extends Error {
	constructor(
		readonly reason: 'unreachable' | 'no-route' | 'unauthorized' | 'unavailable' | 'unexpected',
		message: string
	) {
		super(message);
		this.name = 'IngestError';
	}
}

export interface IngestApi {
	listConnections(): Promise<MailConnection[]>;
	sendItem(draft: IngestDraft, original?: Uint8Array): Promise<IngestResult>;
	reportStatus(id: string, report: StatusReport): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toConnection(value: unknown): MailConnection | null {
	if (!isRecord(value)) return null;
	const { id, label, provider, user, secret_env, keywords, match_body, cursor, scan } = value;
	if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
	if (typeof secret_env !== 'string' || typeof provider !== 'string' || typeof user !== 'string')
		return null;
	const cursorText = typeof cursor === 'string' && CURSOR_PATTERN.test(cursor) ? cursor : '';
	return {
		id,
		label: typeof label === 'string' ? label : id,
		provider,
		user,
		secretEnv: secret_env,
		keywords: Array.isArray(keywords)
			? keywords.filter((keyword): keyword is string => typeof keyword === 'string')
			: [],
		matchBody: match_body === true,
		cursor: cursorText,
		scan: scanStateOf(scan)
	};
}

export class IngestClient implements IngestApi {
	readonly #base: string;
	readonly #token: string;
	readonly #fetch: typeof fetch;

	constructor(appUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
		this.#base = appUrl.replace(/\/+$/, '');
		this.#token = token;
		this.#fetch = fetchImpl;
	}

	async #request(path: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
		let response: Response;
		try {
			response = await this.#fetch(`${this.#base}${path}`, {
				...init,
				headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.#token}` },
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch {
			// Refused connection, timeout: the error itself carries nothing more that helps.
			throw new IngestError('unreachable', `PocketBase unter ${this.#base} nicht erreichbar.`);
		}
		const text = await response.text().catch(() => '');
		let json: unknown = null;
		try {
			json = text === '' ? null : JSON.parse(text);
		} catch {
			json = null;
		}
		if (response.status === 401) {
			throw new IngestError('unauthorized', 'PocketBase lehnt den Token ab (BYL_INGEST_TOKEN).');
		}
		if (response.status === 503) {
			throw new IngestError(
				'unavailable',
				'PocketBase kennt die Verbindungen noch nicht (Neustart nötig).'
			);
		}
		return { status: response.status, json };
	}

	async listConnections(): Promise<MailConnection[]> {
		const { status, json } = await this.#request('/api/byl/ingest/connections', { method: 'GET' });
		if (status === 404) {
			throw new IngestError(
				'no-route',
				'PocketBase läuft ohne BYL_INGEST_TOKEN; bitte stop.bat und dann start.bat ausführen.'
			);
		}
		if (status !== 200 || !isRecord(json) || !Array.isArray(json.items)) {
			throw new IngestError('unexpected', `Unerwartete Antwort der Verbindungsliste (HTTP ${status}).`);
		}
		return json.items.map(toConnection).filter((item): item is MailConnection => item !== null);
	}

	async sendItem(draft: IngestDraft, original?: Uint8Array): Promise<IngestResult> {
		let init: RequestInit;
		if (original === undefined) {
			init = {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(draft)
			};
		} else {
			const form = new FormData();
			form.set('draft', JSON.stringify(draft));
			form.set('original', new Blob([original], { type: 'message/rfc822' }), 'mail.eml');
			init = { method: 'POST', body: form };
		}
		const { status, json } = await this.#request('/api/byl/ingest/items', init);
		const body = isRecord(json) ? json : {};
		if (status === 200 && body.status === 'created' && typeof body.item === 'string') {
			return { status: 'created', item: body.item };
		}
		if (status === 200 && body.status === 'duplicate' && typeof body.item === 'string') {
			return { status: 'duplicate', item: body.item, state: typeof body.state === 'string' ? body.state : '' };
		}
		if (status === 422) return { status: 'unmatched' };
		if (status === 404) return { status: 'gone' };
		if (status === 400) {
			return { status: 'rejected', message: typeof body.message === 'string' ? body.message : 'Abgelehnt.' };
		}
		throw new IngestError('unexpected', `Unerwartete Antwort beim Speichern (HTTP ${status}).`);
	}

	async reportStatus(id: string, report: StatusReport): Promise<void> {
		const { status } = await this.#request(`/api/byl/ingest/connections/${encodeURIComponent(id)}/status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(report)
		});
		if (status !== 200 && status !== 404) {
			throw new IngestError('unexpected', `Unerwartete Antwort beim Status (HTTP ${status}).`);
		}
	}
}
