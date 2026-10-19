// "Anna hat dir HAUS-12 zugewiesen." (E7-5, ADR-0068 §4): the (app) layout subscribes to the topic
// byl/assigned and shows every notice as an info flag with "Öffnen", which leads to the ticket in the
// view of the tab. The flag never takes the focus (ADR-0025 section 8). The ticket is "neu" for the
// account as well (the server deleted its read row), so it is seen later without the flag too. Since
// UE-1 one notice may stand for several sub-tasks of a ticket ("Anna hat dir 3 Unteraufgaben von
// HAUS-12 zugewiesen."); "Öffnen" then opens that ticket.

import type PocketBase from 'pocketbase';
import { subscribeAssigned, type AssignedNotice } from '$lib/data/assigned';
import type { Unsubscribe } from '$lib/data/realtime';
import { assignedNoticeText, assignedSubtasksNoticeText } from '$lib/domain/assignee';
import type { FlagSink } from './flags.svelte';
import { hold, type HoldOptions } from './realtime';

export type { AssignedNotice };

/** The notices of the server and the reconnections; tests pass a fake. */
export interface AssignedLive {
	notices(onNotice: (notice: AssignedNotice) => void): Promise<Unsubscribe>;
}

export function assignedLive(pb: PocketBase): AssignedLive {
	return { notices: (onNotice) => subscribeAssigned(pb, onNotice) };
}

/** Label of the action of the flag. */
export const OPEN_ASSIGNED_LABEL = 'Öffnen';

export class AssignedNotices {
	readonly #flags: FlagSink;
	readonly #open: (notice: AssignedNotice) => void;
	readonly #hold: HoldOptions;

	constructor(
		flags: FlagSink,
		open: (notice: AssignedNotice) => void,
		holdOptions: HoldOptions = {}
	) {
		this.#flags = flags;
		this.#open = open;
		this.#hold = holdOptions;
	}

	/**
	 * Shows the flag of one notice: the sentence, the title of the ticket and "Öffnen". A notice of
	 * several sub-tasks at once (UE-1, ADR-0070 §5) names their number and the parent, whose title it
	 * shows and which "Öffnen" opens.
	 */
	show(notice: AssignedNotice): void {
		const parent = notice.parent;
		if (parent !== null) {
			const target = { ...notice, ticket: parent.id, key: parent.key, title: parent.title };
			this.#flags.show({
				tone: 'info',
				title: assignedSubtasksNoticeText(notice.byName, notice.count, parent.key),
				...(parent.title !== '' && { description: parent.title }),
				action: { label: OPEN_ASSIGNED_LABEL, run: () => this.#open(target) }
			});
			return;
		}
		this.#flags.show({
			tone: 'info',
			title: assignedNoticeText(notice.byName, notice.key),
			...(notice.title !== '' && { description: notice.title }),
			action: { label: OPEN_ASSIGNED_LABEL, run: () => this.#open(notice) }
		});
	}

	/**
	 * Follows the notices of the server; the cleanup ends the subscription. A notice lost in a gap is
	 * not repeated: the ticket is "neu" anyway (ADR-0068 §4).
	 */
	connect(live: AssignedLive): () => void {
		return hold((guard) => live.notices(guard((notice) => this.show(notice))), this.#hold);
	}
}
