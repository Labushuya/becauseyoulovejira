// Dependencies of a ticket in the trash (ADR-0047, ADR-0037 addendum): the SPA mirror of the pure
// rule app/pb_hooks/lib/trash-dependencies.js (parity test tests/unit/web-trash.test.mjs) and the
// words of the decision help. The server finds the dependencies of a group; the SPA derives the
// options of each from the same rule, builds the collective ways and words them.

import type { Status } from './status';

/** What the decision help offers for a dependency (only the ways our rules allow). */
export type DependencyOption =
	'complete' | 'complete_children' | 'restore' | 'detach' | 'inbox' | 'discard' | 'move';

/** A ticket of the group that is not done. */
export interface TicketDependency {
	kind: 'ticket';
	ticket: string;
	key: string;
	title: string;
	status: Status;
	/** A sub-task of the group (not its first ticket). */
	subtask: boolean;
	/** First ticket only: its open sub-tasks with "Blockiert das übergeordnete Ticket". */
	openBlocking: number;
	options: readonly DependencyOption[];
}

/** An inbox entry still bound to a ticket of the group (discarded with it, ADR-0037 §6). */
export interface SourceDependency {
	kind: 'source';
	item: string;
	/** Ticket of the group it hangs on, with its key. */
	ticket: string;
	key: string;
	title: string;
	channel: string;
	scope: string;
	/** The main source of that ticket (ADR-0031): it never moves to another ticket. */
	primary: boolean;
	options: readonly DependencyOption[];
}

export type TrashDependency = TicketDependency | SourceDependency;

/** One decision of the route POST /api/byl/trash/{id}/resolve. */
export type ResolveAction =
	| { action: 'complete'; ticket: string; complete_children?: true }
	| { action: 'inbox' | 'discard'; item: string }
	| { action: 'move'; item: string; target: string };

/** The collective ways of the decision help. */
export type CollectiveKind = 'complete' | 'inbox' | 'discard';

/** The options of a dependency, the same as the hook (optionsOf). */
export function optionsOf(
	dependency:
		| Pick<TicketDependency, 'kind' | 'subtask' | 'openBlocking'>
		| Pick<SourceDependency, 'kind' | 'primary'>
): DependencyOption[] {
	if (dependency.kind === 'ticket') {
		const complete = dependency.openBlocking > 0 ? 'complete_children' : 'complete';
		return dependency.subtask ? [complete, 'restore', 'detach'] : [complete, 'restore'];
	}
	return dependency.primary ? ['inbox', 'discard'] : ['inbox', 'discard', 'move'];
}

/** { total, tickets, sources } of a list of dependencies (countsOf of the hook). */
export function countsOf(dependencies: readonly TrashDependency[]): {
	total: number;
	tickets: number;
	sources: number;
} {
	const tickets = dependencies.filter((dependency) => dependency.kind === 'ticket').length;
	return { total: dependencies.length, tickets, sources: dependencies.length - tickets };
}

/**
 * The decisions of a collective way (collectiveActions of the hook): every open ticket done, the
 * sub-tasks first; every source back to the inbox; every source discarded.
 */
export function collectiveActions(
	dependencies: readonly TrashDependency[],
	kind: CollectiveKind
): ResolveAction[] {
	if (kind === 'complete') {
		const tickets = dependencies.filter((dependency) => dependency.kind === 'ticket');
		return [
			...tickets.filter((dependency) => dependency.subtask),
			...tickets.filter((dependency) => !dependency.subtask)
		].map((dependency) => ({ action: 'complete', ticket: dependency.ticket }));
	}
	return dependencies.flatMap((dependency) =>
		dependency.kind === 'source' ? [{ action: kind, item: dependency.item }] : []
	);
}

function plural(count: number, one: string, many: string): string {
	return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** "1 offenes Ticket und 2 Quellen", for the lozenge, the refusal and the collective ways. */
export function dependencySummary(counts: { tickets: number; sources: number }): string {
	const parts: string[] = [];
	if (counts.tickets > 0) parts.push(plural(counts.tickets, 'offenes Ticket', 'offene Tickets'));
	if (counts.sources > 0) parts.push(plural(counts.sources, 'Quelle', 'Quellen'));
	return parts.join(' und ');
}

/** Label of the lozenge of a blocked row: "Blockiert (3)". */
export function blockedLabel(count: number): string {
	return `Blockiert (${count})`;
}

/** Name of the lozenge for screen readers: "Blockiert: 3 Abhängigkeiten". */
export function blockedName(count: number): string {
	return `Blockiert: ${plural(count, 'Abhängigkeit', 'Abhängigkeiten')}`;
}

/** What the decision help says first about a blocked ticket. */
export function blockedIntro(key: string, counts: { tickets: number; sources: number }): string {
	return `${key} lässt sich erst endgültig löschen, wenn über ${dependencySummary(counts)} entschieden ist. Bis dahin löscht auch die Aufbewahrung es nicht.`;
}

/** Why the main source has no "Anderem Ticket zuordnen …". */
export const PRIMARY_SOURCE_NOTE =
	'Hauptquelle: Sie bleibt bei dem Ticket, aus dem sie entstanden ist, und lässt sich keinem anderen Ticket zuordnen. Sie geht zurück in den Eingang oder wird verworfen.';

/** What "Verwerfen" means for a source. */
export const DISCARD_NOTE =
	'Verworfene Einträge stehen im Eingang unter „Verworfen“; ihren Inhalt leert die App nach 30 Tagen, die Sperre gegen erneutes Eintreffen bleibt.';

/** Labels of the buttons of the decision help. */
export const OPTION_LABELS: Readonly<Record<DependencyOption, string>> = Object.freeze({
	complete: 'Als erledigt markieren',
	complete_children: 'Mit Unteraufgaben als erledigt markieren',
	restore: 'Wiederherstellen',
	detach: 'Lösen und als eigenständiges Ticket wiederherstellen',
	inbox: 'Zurück in den Eingang',
	discard: 'Verwerfen',
	move: 'Anderem Ticket zuordnen …'
});

/**
 * Text and accessible name of an option of a dependency: the button names its object ("HAUS-3
 * als erledigt markieren", "„Rechnung“ verwerfen"); `rootKey` is the first ticket of the group.
 */
export function optionLabel(
	option: DependencyOption,
	dependency: TrashDependency,
	rootKey: string
): { text: string; name: string } {
	if (dependency.kind === 'source') {
		const object = `„${dependency.title || 'Ohne Titel'}“`;
		const verb: Record<string, string> = {
			inbox: 'zurück in den Eingang',
			discard: 'verwerfen',
			move: 'anderem Ticket zuordnen …'
		};
		return { text: OPTION_LABELS[option], name: `${object} ${verb[option] ?? ''}`.trim() };
	}
	const key = dependency.key;
	switch (option) {
		case 'complete_children': {
			const children =
				dependency.openBlocking === 1
					? '1 Unteraufgabe'
					: `${dependency.openBlocking} Unteraufgaben`;
			return {
				text: `Mit ${children} als erledigt markieren`,
				name: `${key} mit ${children} als erledigt markieren`
			};
		}
		case 'restore':
			return dependency.subtask
				? {
						text: `Mit ${rootKey} wiederherstellen`,
						name: `${key} mit ${rootKey} wiederherstellen`
					}
				: { text: OPTION_LABELS.restore, name: `${key} wiederherstellen` };
		case 'detach':
			return {
				text: OPTION_LABELS.detach,
				name: `${key} lösen und als eigenständiges Ticket wiederherstellen`
			};
		default:
			return { text: OPTION_LABELS.complete, name: `${key} als erledigt markieren` };
	}
}

/** Labels of the collective ways. */
export const COLLECTIVE_LABELS: Readonly<Record<CollectiveKind, string>> = Object.freeze({
	complete: 'Alle als erledigt markieren',
	inbox: 'Alle Quellen zurück in den Eingang',
	discard: 'Alle Quellen verwerfen'
});

/** The preview of a collective way: "Betrifft 2 Tickets: HAUS-1, HAUS-2." */
export function collectivePreview(
	dependencies: readonly TrashDependency[],
	kind: CollectiveKind
): string {
	const actions = collectiveActions(dependencies, kind);
	if (kind === 'complete') {
		const keys = actions.flatMap((action) =>
			action.action === 'complete'
				? dependencies.flatMap((dependency) =>
						dependency.kind === 'ticket' && dependency.ticket === action.ticket
							? [dependency.key]
							: []
					)
				: []
		);
		return `Betrifft ${plural(keys.length, 'Ticket', 'Tickets')}: ${keys.join(', ')}. Sie bekommen den Status „Erledigt“.`;
	}
	const titles = dependencies.flatMap((dependency) =>
		dependency.kind === 'source' ? [`„${dependency.title || 'Ohne Titel'}“`] : []
	);
	const effect =
		kind === 'inbox'
			? 'Sie stehen danach wieder als neu im Eingang und kommen beim Wiederherstellen mit zurück, solange sie frei sind.'
			: 'Sie stehen danach im Eingang unter „Verworfen“.';
	return `Betrifft ${plural(titles.length, 'Quelle', 'Quellen')}: ${titles.join(', ')}. ${effect}`;
}

/** Flag after a decision of the help. */
export function resolvedText(actions: readonly ResolveAction[], key: string): string {
	const first = actions[0];
	if (actions.length === 1 && first !== undefined) {
		if (first.action === 'complete') return 'Als erledigt markiert.';
		if (first.action === 'inbox') return 'Quelle zurück in den Eingang gelegt.';
		if (first.action === 'discard') return 'Quelle verworfen.';
		return 'Quelle zugeordnet.';
	}
	return `${plural(actions.length, 'Entscheidung', 'Entscheidungen')} für ${key} übernommen.`;
}
