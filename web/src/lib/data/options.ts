// Shared request options of the data layer (ADR-0006 section 4).

export interface RequestOptions {
	/** Aborts the request; the call then fails with the kind "aborted". */
	signal?: AbortSignal;
}

/** Record ID of the signed-in user, needed as owner or author of new records. */
export function currentUserId(authRecord: { id?: unknown } | null): string | null {
	return typeof authRecord?.id === 'string' && authRecord.id !== '' ? authRecord.id : null;
}
