// "Jetzt neu starten" and "Mail-Helfer neu starten" outside the page "Einstellungen → System"
// (BW-1, ADR-0072), e.g. in a step of a setup assistant. The same route with the same checks as the
// page (POST /api/byl/system/actions/{restart|mail-restart}, ADR-0043: this machine, the address of
// the app, the administrator, rate limit, own instance, one action at a time) and the same waiting
// (followRestart of restart-follow.ts): before the restart the store reads the status, so it knows
// the server it waits to come back. One store per page, one run at a time; a run remembers the place
// it was started at (`place`), so only that place shows its progress and result, also after the
// view there was closed and opened again. A failure carries its entry for "Details" (FP-1,
// ADR-0071) with the intent of the action; a refusal of the route is a warning like on the page
// System, only "script" is an error.

import {
	problemOf,
	reportedProblem,
	toDataError,
	unansweredProblem,
	withIntent
} from '$lib/data/errors';
import { denialProblem, type SystemAnswer } from '$lib/data/system';
import type { ProblemEntry } from '$lib/domain/problems';
import {
	RESTART_DENIAL_TEXTS,
	RESTART_TEXTS,
	type SystemDenial,
	type SystemNotice,
	type SystemOverview
} from '$lib/domain/system';
import type { RestartTask } from '$lib/guidance/texts';
import {
	REAL_CLOCK,
	followRestart,
	type RestartBefore,
	type RestartData,
	type SystemClock
} from './restart-follow';
import { denialNotice } from './system.svelte';
import type { SessionGuard } from './ticket-list.svelte';

/** Intents of the two actions in "Details" (the words of the catalog, problem-intents.ts). */
export const RESTART_INTENTS: Readonly<Record<RestartTask, string>> = Object.freeze({
	restart: 'App neu starten',
	'mail-restart': 'Mail-Helfer neu starten'
});

/** preparing: the status is read; stopping: the restart runs; starting: the server is gone. */
export type RestartPhase = 'preparing' | 'stopping' | 'starting';

/**
 * restarted: the server is back (with its status, null if reading it failed); mail: the mail
 * helper was restarted, `overview.mail` says whether it runs now; refused: the route refused
 * (warning, "script" an error); failed: no answer, or the server did not come back in time.
 */
export type RestartResult =
	| { kind: 'restarted'; overview: SystemOverview | null }
	| { kind: 'mail'; overview: SystemOverview }
	| {
			kind: 'refused';
			tone: 'warning' | 'error';
			reason: SystemDenial;
			message: SystemNotice;
			problem: ProblemEntry | null;
	  }
	| { kind: 'failed'; message: SystemNotice; problem: ProblemEntry | null };

/** Ends a run early: nothing to show (aborted, the session ended). */
class Silent extends Error {}

export class RestartStore {
	readonly #data: RestartData;
	readonly #session: SessionGuard;
	readonly #clock: SystemClock;
	#controller = new AbortController();

	#task = $state<RestartTask | null>(null);
	#place = $state<string | null>(null);
	#phase = $state<RestartPhase | null>(null);
	#result = $state.raw<RestartResult | null>(null);

	constructor(data: RestartData, session: SessionGuard, clock: SystemClock = REAL_CLOCK) {
		this.#data = data;
		this.#session = session;
		this.#clock = clock;
	}

	/** The action that runs now, or null. */
	get running(): RestartTask | null {
		return this.#task;
	}

	/** Whether the run that is going on now was started at `place`. */
	runningAt(place: string): boolean {
		return this.#task !== null && this.#place === place;
	}

	/** The phase of the restart started at `place`, null elsewhere and for the mail helper. */
	phaseAt(place: string): RestartPhase | null {
		return this.#place === place ? this.#phase : null;
	}

	/** The result of the last run started at `place`, null for every other place. */
	resultAt(place: string): RestartResult | null {
		return this.#task === null && this.#place === place ? this.#result : null;
	}

	/** Forgets the result shown at `place`. */
	clear(place: string): void {
		if (this.#task === null && this.#place === place) {
			this.#result = null;
			this.#place = null;
		}
	}

	/** "Jetzt neu starten": reads the status, starts the restart and waits for the server. */
	restart(place: string): Promise<RestartResult | null> {
		return this.#run('restart', place, async (signal) => {
			const status = await this.#data.status({ signal });
			if (status.kind === 'denied') return this.#refused(status);
			const before: RestartBefore = {
				pid: status.value.status.pid,
				startedUtc: status.value.status.startedUtc
			};
			const answer = await this.#data.act('restart', { signal });
			if (answer.kind === 'denied') return this.#refused(answer);
			this.#setPhase(signal, 'stopping');
			const follow = await followRestart(this.#data, this.#clock, signal, before, () =>
				this.#setPhase(signal, 'starting')
			);
			if (follow.kind === 'aborted') throw new Silent();
			if (follow.kind === 'back') {
				return {
					kind: 'restarted',
					overview: follow.answer?.kind === 'ok' ? follow.answer.value : null
				};
			}
			return follow.gone ? this.#notBack() : this.#notStarted(follow.last);
		});
	}

	/** "Mail-Helfer neu starten": the result names whether the helper runs now. */
	restartMail(place: string): Promise<RestartResult | null> {
		return this.#run('mail-restart', place, async (signal) => {
			const answer = await this.#data.act('mail-restart', { signal });
			if (answer.kind === 'denied') return this.#refused(answer);
			if (answer.value === 'restarting') throw new Silent();
			return { kind: 'mail', overview: answer.value };
		});
	}

	async #run(
		task: RestartTask,
		place: string,
		run: (signal: AbortSignal) => Promise<RestartResult>
	): Promise<RestartResult | null> {
		if (this.#task !== null || !this.#session.ensureValid()) return null;
		const signal = this.#controller.signal;
		this.#task = task;
		this.#place = place;
		this.#phase = task === 'restart' ? 'preparing' : null;
		this.#result = null;
		let result: RestartResult | null;
		try {
			result = await withIntent(RESTART_INTENTS[task], () => run(signal));
		} catch (error) {
			result = this.#failure(error, signal);
		}
		// After reset() this run is over; a later run owns the state.
		if (signal.aborted) return null;
		this.#task = null;
		this.#phase = null;
		this.#result = result;
		return result;
	}

	#setPhase(signal: AbortSignal, phase: RestartPhase): void {
		if (!signal.aborted) this.#phase = phase;
	}

	#failure(error: unknown, signal: AbortSignal): RestartResult | null {
		if (error instanceof Silent) return null;
		const failure = toDataError(error, signal);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return {
			kind: 'failed',
			message: { title: RESTART_TEXTS.refusedTitle, text: failure.message },
			problem: problemOf(failure)
		};
	}

	#refused(answer: Extract<SystemAnswer<unknown>, { kind: 'denied' }>): RestartResult {
		const tone = answer.reason === 'script' ? 'error' : 'warning';
		return {
			kind: 'refused',
			tone,
			reason: answer.reason,
			message: RESTART_DENIAL_TEXTS[answer.reason] ?? denialNotice(answer.reason),
			problem: tone === 'error' ? denialProblem(answer) : null
		};
	}

	/** The server went and did not come back within the time. */
	#notBack(): RestartResult {
		return {
			kind: 'failed',
			message: { title: RESTART_TEXTS.failedTitle, text: RESTART_TEXTS.failedHere },
			problem: unansweredProblem({
				intent: RESTART_INTENTS.restart,
				method: 'GET',
				path: '/api/health'
			})
		};
	}

	/**
	 * The same server kept answering: the detached restart did not begin. The control script keeps
	 * the error of a run without window (ADR-0048 §4); the last status names it, if it has one.
	 */
	#notStarted(last: SystemAnswer<SystemOverview> | null): RestartResult {
		const background = last?.kind === 'ok' ? last.value.status.backgroundProblem : null;
		return {
			kind: 'failed',
			message: { title: RESTART_TEXTS.notStartedTitle, text: RESTART_TEXTS.notStarted },
			problem: reportedProblem({
				intent: RESTART_INTENTS.restart,
				method: 'GET',
				path: '/api/byl/system',
				code: background?.report.code ?? null,
				message:
					background?.report.problem ??
					'Der Server läuft nach 90 Sekunden noch mit demselben Start.'
			})
		};
	}

	/** Ends a running run without a result (the page goes or changes its area). */
	reset(): void {
		this.#controller.abort();
		this.#controller = new AbortController();
		this.#task = null;
		this.#place = null;
		this.#phase = null;
		this.#result = null;
	}
}
