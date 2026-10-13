// The question "Vorhaben abschließen?" of one place (VH-1, ADR-0065 addendum VH-1): the table
// "Aufgaben", the section "Unteraufgaben", the fields of a ticket and the bar of the bulk actions each
// hold one and render it with OngoingFinishDialog, so in the full view it stands inline where the
// action was (ADR-0025 addendum 16). An action that completes tickets runs through `run`: at once
// when none of them is an open ongoing project, otherwise only after "Abschließen"; "Abbrechen"
// runs nothing. The texts are pure in domain/ongoing-finish.ts.

import {
	ongoingFinishQuestion,
	type OngoingCandidate,
	type OngoingFinishQuestion
} from '$lib/domain/ongoing-finish';

export class OngoingFinishAsk {
	#question = $state.raw<OngoingFinishQuestion | null>(null);
	#answer: ((confirmed: boolean) => void) | null = null;

	/** The open question, null without one. */
	get question(): OngoingFinishQuestion | null {
		return this.#question;
	}

	/**
	 * Runs `action` right away when none of `tickets` is an open ongoing project (the result comes
	 * back as it is, so a check mark stays as quick as before); otherwise asks first and runs it only
	 * after "Abschließen", resolving to its result, or to null after "Abbrechen". `total` is the
	 * number of tickets of a bulk action. A new question answers an open one with "Abbrechen".
	 */
	run<T>(
		tickets: readonly OngoingCandidate[],
		action: () => T,
		total: number = tickets.length
	): T | Promise<Awaited<T> | null> {
		const question = ongoingFinishQuestion(tickets, total);
		if (question === null) return action();
		this.#settle(false);
		this.#question = question;
		return new Promise<boolean>((resolve) => {
			this.#answer = resolve;
		}).then(async (confirmed): Promise<Awaited<T> | null> => (confirmed ? await action() : null));
	}

	/** "Abschließen": the action runs. */
	accept(): void {
		this.#settle(true);
	}

	/** "Abbrechen", Escape, × or the veil: nothing changes. */
	cancel(): void {
		this.#settle(false);
	}

	#settle(confirmed: boolean): void {
		const answer = this.#answer;
		this.#answer = null;
		this.#question = null;
		answer?.(confirmed);
	}
}
