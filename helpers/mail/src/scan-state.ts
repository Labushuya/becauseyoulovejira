// State of the full scan of an inbox (ADR-0020, addendum 3): stored by PocketBase in
// connections.scan (JSON, written only through the status route) and read back with the
// connection. The scan goes from the newest mail to the oldest; `below` is the UID below which it
// continues, so every mail with a UID from `below` to `until` is done. Pure, no dependencies.

export const SCAN_STATES = ['running', 'paused', 'done', 'cancelled', 'error'] as const;
export type ScanStateName = (typeof SCAN_STATES)[number];

export interface ScanState {
	/** Keywords and match_body the scan ran with (scanSignature); a change starts it over. */
	signature: string;
	/**
	 * running: in progress or to be continued; paused: the limit of new entries per run was reached
	 * ("Weitere Treffer – erneut abrufen"); done; cancelled by the user; error: continued next run.
	 */
	state: ScanStateName;
	/** UIDVALIDITY of the inbox the UIDs belong to. */
	uidValidity: string;
	/** Highest UID the scan covers; newer mails are fetched through the cursor. */
	until: number;
	/** The scan continues with UIDs below this one; 0 when it is done. */
	below: number;
	/** Mails checked and mails in the scan (progress "1.200/4.800"). */
	done: number;
	total: number;
	/** Entries this scan created so far. */
	created: number;
	/** The server refused the text search; the mails of at least one block were loaded instead. */
	fallback: boolean;
}

const SIGNATURE = /^[0-9a-f]{16}$/;
const UID_VALIDITY = /^\d{1,10}$/;
const UID_MAX = 4294967295;
const COUNT_MAX = 100_000_000;

function isCount(value: unknown, max = COUNT_MAX): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/** The scan state stored at a connection, or null for a missing or broken value. */
export function scanStateOf(value: unknown): ScanState | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const stored = value as Record<string, unknown>;
	const { signature, state, uid_validity: uidValidity, until, below, done, total, created, fallback } = stored;
	if (typeof signature !== 'string' || !SIGNATURE.test(signature)) return null;
	if (typeof state !== 'string' || !(SCAN_STATES as readonly string[]).includes(state)) return null;
	if (typeof uidValidity !== 'string' || !UID_VALIDITY.test(uidValidity)) return null;
	if (!isCount(until, UID_MAX) || !isCount(below, UID_MAX + 1)) return null;
	if (!isCount(done) || !isCount(total) || !isCount(created)) return null;
	return {
		signature,
		state: state as ScanStateName,
		uidValidity,
		until,
		below,
		done,
		total,
		created,
		fallback: fallback === true
	};
}

/** The state in the shape of connections.scan (app/pb_hooks/lib/ingest-rules.js, parseScan). */
export function scanStateValue(scan: ScanState): Record<string, unknown> {
	return {
		signature: scan.signature,
		state: scan.state,
		uid_validity: scan.uidValidity,
		until: scan.until,
		below: scan.below,
		done: scan.done,
		total: scan.total,
		created: scan.created,
		fallback: scan.fallback
	};
}
