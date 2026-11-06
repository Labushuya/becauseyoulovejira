// Failures for the fakes of the data layers (FP-3b, ADR-0071): a failed request as the data layer
// throws it (a DataError with its request noted, so the catalog names its intent) and a refusal
// "script" with its entry beside the answer, as the routes of the administration answer it.

import {
	DataError,
	keepAnswerProblem,
	noteRequest,
	unreadableProblem,
	type DataErrorKind
} from '$lib/data/errors';

/** A DataError of `kind` (default: no connection) for `method` `path`. */
export function failedRequest(method: string, path: string, kind: DataErrorKind = 'network') {
	const failure = new DataError(kind);
	noteRequest(failure, method, path);
	return failure;
}

/** A refusal "script" of `method` `path`: an answer of another form, with its entry beside it. */
export function scriptRefusal(method: string, path: string): { kind: 'denied'; reason: 'script' } {
	return keepAnswerProblem<{ kind: 'denied'; reason: 'script' }>(
		{ kind: 'denied', reason: 'script' },
		unreadableProblem(method, path)
	);
}
