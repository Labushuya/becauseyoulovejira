// The restart of the app (ADR-0043 §5, since BW-1 ADR-0072): what the page "System" and every other
// place with "Jetzt neu starten" share. The route POST /api/byl/system/actions/restart starts the
// detached restart and answers at once; then the place asks /api/health every second until the
// server was gone and answers again, or answers with a new start time (a restart so fast that it
// never seemed gone), and gives up after RESTART_TIMEOUT_MS. The short polling concerns the server,
// not data (CLAUDE.md §7), and ends with the restart. Module without runes; tests pass a fake clock.
// Since FP-3b `noResultProblem` is the one entry of "Details" for a restart (page System and
// "Jetzt neu starten") and a restore of a backup that gave no result in time.

import { reportedScriptProblem, unansweredProblem } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { SystemAnswer } from '$lib/data/system';
import type { ProblemEntry } from '$lib/domain/problems';
import type { BackgroundProblem, SystemAction, SystemOverview } from '$lib/domain/system';
import type { RestartTask } from '$lib/guidance/texts';

/** Intents of the two actions in "Details" (the words of the catalog, problem-intents.ts). */
export const RESTART_INTENTS: Readonly<Record<RestartTask, string>> = Object.freeze({
	restart: 'App neu starten',
	'mail-restart': 'Mail-Helfer neu starten'
});

/** What a restart needs of the data layer (data/system.ts); the page "System" needs more. */
export interface RestartData {
	status(options: RequestOptions): Promise<SystemAnswer<SystemOverview>>;
	act(
		action: SystemAction,
		options: RequestOptions
	): Promise<SystemAnswer<SystemOverview | 'restarting'>>;
	health(options: RequestOptions): Promise<boolean>;
}

/** Time for the restart; tests pass a fake one. */
export interface SystemClock {
	now(): number;
	wait(ms: number, signal: AbortSignal): Promise<void>;
}

export const REAL_CLOCK: SystemClock = {
	now: () => Date.now(),
	wait: (ms, signal) =>
		new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true }
			);
		})
};

/** How often the restart asks /api/health. */
export const RESTART_POLL_MS = 1000;
/** Without a moment of absence, the status is compared after this long (a very fast restart). */
export const RESTART_COMPARE_AFTER_MS = 5000;
/** The restart counts as failed after this long. */
export const RESTART_TIMEOUT_MS = 90_000;

/** The server as it was before the restart: a new PID or start time means it started again. */
export interface RestartBefore {
	pid: number | null;
	startedUtc: string | null;
}

/**
 * How the waiting ended: the server is back (with the status it answered, null if that failed),
 * the time is over (`gone`: the server went and did not come back; `last`: the last status read),
 * or the signal ended the waiting.
 */
export type RestartFollow =
	| { kind: 'back'; answer: SystemAnswer<SystemOverview> | null }
	| { kind: 'timeout'; gone: boolean; last: SystemAnswer<SystemOverview> | null }
	| { kind: 'aborted' };

/**
 * Waits for the restart that was just started: asks /api/health every RESTART_POLL_MS; `ongone`
 * runs whenever the server does not answer (the place says "Der Server startet wieder.").
 */
export async function followRestart(
	data: Pick<RestartData, 'health' | 'status'>,
	clock: SystemClock,
	signal: AbortSignal,
	before: RestartBefore,
	ongone: () => void
): Promise<RestartFollow> {
	const started = clock.now();
	let gone = false;
	let last: SystemAnswer<SystemOverview> | null = null;
	for (;;) {
		if (signal.aborted) return { kind: 'aborted' };
		const up = await data.health({ signal });
		if (signal.aborted) return { kind: 'aborted' };
		const elapsed = clock.now() - started;
		if (!up) {
			gone = true;
			ongone();
		} else if (gone || elapsed >= RESTART_COMPARE_AFTER_MS) {
			const answer = await data.status({ signal }).catch(() => null);
			if (signal.aborted) return { kind: 'aborted' };
			last = answer;
			const status = answer?.kind === 'ok' ? answer.value : null;
			const changed =
				status !== null &&
				(status.status.pid !== before.pid || status.status.startedUtc !== before.startedUtc);
			if (gone || changed) return { kind: 'back', answer };
		}
		if (elapsed >= RESTART_TIMEOUT_MS) return { kind: 'timeout', gone, last };
		await clock.wait(RESTART_POLL_MS, signal);
	}
}

/** The request a place kept asking while it waited for a result. */
export interface AskedRequest {
	method: string;
	path: string;
}

/**
 * The entry behind "Details" of a restart or a restore that gave no result in time (BW-1, ADR-0072
 * §6; since FP-3b also the page System and the restore of a backup):
 * - `gone`: the server went and did not come back, `unanswered` got no answer: "Keine Verbindung
 *   zum Server" with that request;
 * - otherwise the server kept answering `answered` without a result (the restart did not begin, the
 *   restore did not end): "Vom Server gemeldeter Fehler" with the error of the last run without
 *   window the control script keeps (ADR-0048 §4, only its code and problem), else `fallback`.
 */
export function noResultProblem(input: {
	intent: string;
	gone: boolean;
	unanswered: AskedRequest;
	answered: AskedRequest;
	background: BackgroundProblem | null;
	fallback: string;
}): ProblemEntry {
	if (input.gone) return unansweredProblem({ intent: input.intent, ...input.unanswered });
	return reportedScriptProblem({
		intent: input.intent,
		...input.answered,
		report: input.background?.report ?? null,
		code: null,
		message: input.fallback
	});
}

/**
 * The entry of a restart without a result in time, the same on the page System and at every
 * "Jetzt neu starten": the server did not come back (`gone`, GET /api/health without an answer) or
 * kept running with the same start (the last status names the error of the run without window).
 */
export function restartNoResultProblem(
	gone: boolean,
	last: SystemAnswer<SystemOverview> | null
): ProblemEntry {
	return noResultProblem({
		intent: RESTART_INTENTS.restart,
		gone,
		unanswered: { method: 'GET', path: '/api/health' },
		answered: { method: 'GET', path: '/api/byl/system' },
		background: last?.kind === 'ok' ? last.value.status.backgroundProblem : null,
		fallback: 'Der Server läuft nach 90 Sekunden noch mit demselben Start.'
	});
}
