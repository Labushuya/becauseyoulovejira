// The question before completing an ongoing project (VH-1, ADR-0065 addendum VH-1), pure. A
// ticket of the kind "Laufendes Vorhaben" comes into the day plan every day, and its check mark
// there only means "für heute erledigt". Completing it ends that, so every way that sets it to
// "Erledigt" asks first with the same question as the day plan: the check mark and the status cell
// of "Aufgaben", the status menu and check mark of a sub-task, the status of the detail and the bulk
// actions "Erledigen" and "Status". A task never asks. The bulk asks once and names how many
// ongoing projects the chosen tickets hold.

import { kindOf } from './day-plan';
import { keysText } from './subtasks';

/** What the question needs of a ticket that is about to be completed. */
export interface OngoingCandidate {
	readonly key: string;
	readonly title: string;
	readonly status: string;
	/** The kind; missing before the migration, which reads as a task. */
	readonly kind?: string | undefined;
}

/** An ongoing project the question names. */
export interface OngoingProject {
	readonly key: string;
	readonly title: string;
}

export interface OngoingFinishQuestion {
	/** The open ongoing projects that the action completes, in the order of the action. */
	readonly projects: readonly OngoingProject[];
	/** How many tickets the action completes; more than `projects` only for a bulk action. */
	readonly total: number;
}

/** The button that confirms (the "Abbrechen" of the confirmation changes nothing). */
export const ONGOING_FINISH_CONFIRM = 'Abschließen';

/** The last line of the question: for one day the check mark of the day plan is the way. */
export const ONGOING_FINISH_DAY_HINT = 'Für heute allein reicht der Haken im Tagesplan.';

/** The open ongoing projects among tickets about to be completed; done ones and tasks never ask. */
export function openOngoing<T extends OngoingCandidate>(tickets: readonly T[]): T[] {
	return tickets.filter((ticket) => kindOf(ticket.kind) === 'ongoing' && ticket.status !== 'done');
}

/** The question for one ongoing project, for a place that already knows it is one (day plan). */
export function ongoingFinishOf(project: OngoingProject): OngoingFinishQuestion {
	return { projects: [{ key: project.key, title: project.title }], total: 1 };
}

/**
 * The question before completing `tickets` (`total` of them in a bulk action), or null when none
 * is an open ongoing project: then the action runs at once, as before.
 */
export function ongoingFinishQuestion(
	tickets: readonly OngoingCandidate[],
	total: number = tickets.length
): OngoingFinishQuestion | null {
	const projects = openOngoing(tickets).map(({ key, title }) => ({ key, title }));
	if (projects.length === 0) return null;
	return { projects, total: Math.max(total, projects.length) };
}

/** "Vorhaben HAUS-7 abschließen?" for one, "3 Vorhaben abschließen?" for several. */
export function ongoingFinishTitle(question: OngoingFinishQuestion): string {
	const [first] = question.projects;
	if (question.projects.length === 1 && first !== undefined) {
		return `Vorhaben ${first.key} abschließen?`;
	}
	return `${question.projects.length} Vorhaben abschließen?`;
}

/**
 * What completing means: the project is done and no longer comes into the day plan every day. A
 * bulk action names the number and the keys; with other tickets chosen besides, "Abbrechen" keeps
 * all of them as they are.
 */
export function ongoingFinishText(question: OngoingFinishQuestion): string {
	const { projects, total } = question;
	const count = projects.length;
	const keys = keysText(
		projects.map((project) => project.key),
		count
	);
	const [first] = projects;
	if (total === 1 && first !== undefined) {
		return `„${first.title}“ ist ein laufendes Vorhaben. Abgeschlossen ist es erledigt und erscheint nicht mehr täglich im Tagesplan.`;
	}
	const done =
		count === 1
			? 'Abgeschlossen ist es erledigt und erscheint nicht mehr täglich im Tagesplan.'
			: 'Abgeschlossen sind sie erledigt und erscheinen nicht mehr täglich im Tagesplan.';
	if (total === count) {
		return `Die ${count} ausgewählten Tickets sind laufende Vorhaben: ${keys}. ${done}`;
	}
	const among =
		count === 1
			? `Unter den ${total} ausgewählten Tickets ist 1 laufendes Vorhaben: ${keys}.`
			: `Unter den ${total} ausgewählten Tickets sind ${count} laufende Vorhaben: ${keys}.`;
	return `${among} ${done} Mit „Abbrechen“ bleiben alle Tickets, wie sie sind.`;
}
