// "Übertragen …" after a change of a parent (UE-2, ADR-0070 addendum UE-2) for the (app) layout. The
// ticket stores report every change the user makes in this tab at one ticket (TicketChangeSink): the
// panel and the full view (TicketDetailStore), a cell, the check mark and the calendar
// (TicketListStore). A change of a parent with at least one open sub-task whose fields of the dialog
// differ brings the info flag "Fälligkeit und Priorität von HAUS-12 geändert. Auch für die
// Unteraufgaben?" with the one action "Übertragen …"; it stays until it is taken, closed or pushed
// out, like the offer of a series (FL-1). One flag per parent: further changes of the same parent
// update it, the values before the first change stay the old ones, a field changed back leaves it,
// and with no field left it goes. Such a flag replaces the offer "Auch für künftige Tickets
// übernehmen" of the series for this ticket (the dialog carries it as a checkbox); every other change
// goes to the offer of the series as before. Realtime, the server, bulk actions and the dialog itself
// never report here, so they never bring the flag.
//
// "Übertragen …" opens the dialog in the section "Unteraufgaben" of the parent: where it is shown
// (panel or full view) at once, otherwise the ticket opens first, like "Öffnen" of other flags. The
// request waits only for that way: the next navigation that does not show the parent drops it.

import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import {
	templateOffers,
	type SeriesChange,
	type TemplateApplyResult,
	type TemplateOffer
} from '$lib/domain/series-template';
import { isOpenSubtask } from '$lib/domain/subtask-transfer';
import {
	CHANGE_TEXTS,
	changedDescription,
	changedTitle,
	nextParentChange,
	offerChoice,
	pendingFields,
	startParentChange,
	type ChangedTicket,
	type ParentChange,
	type TicketChange,
	type TicketChangeSink
} from '$lib/domain/subtask-transfer-change';
import type { TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { TransferSupport } from './subtask-transfer.svelte';

/** What the flag needs of the rules: their offer and the way it writes (the RecurrenceStore). */
export interface TransferSeries {
	offerTemplate(changes: readonly SeriesChange[]): string | null;
	withdrawTemplateOffer(id: string): void;
	isTemplateOffer(id: string): boolean;
	ruleById(id: string | null | undefined): RecurrenceRule | null;
	applyTemplateOffers(
		offers: readonly Pick<TemplateOffer, 'ruleId' | 'title' | 'patch'>[]
	): Promise<TemplateApplyResult>;
}

export interface TransferOfferDeps {
	flags?: FlagSink;
	/** Sub-tasks of a ticket as the list knows them. */
	subtasksOf(parentId: string): readonly TicketSummary[];
	series: TransferSeries;
	/** Whether the server knows the route (SubtaskTransferStore.support). */
	support(): TransferSupport;
	/** Shows the ticket (panel or full view) unless it is shown already; resolves after that. */
	reveal(parentId: string): Promise<void>;
}

interface ShownFlag {
	change: ParentChange;
	flag: string;
	title: string;
	description: string;
}

/** The latest offer of the series this store asked for, while it may still stand. */
interface SeriesShown {
	ticketId: string;
	before: ChangedTicket;
	after: ChangedTicket;
	flag: string;
}

interface OpenRequest {
	parentId: string;
	change: ParentChange;
}

export class TransferOfferStore implements TicketChangeSink {
	readonly #deps: TransferOfferDeps;
	readonly #flags: FlagSink;
	/** The flags "Übertragen …" that stand, per parent. */
	readonly #shown = new SvelteMap<string, ShownFlag>();
	#series: SeriesShown | null = null;
	/** "Übertragen …" was chosen: the section "Unteraufgaben" of the parent opens the dialog. */
	#request = $state.raw<OpenRequest | null>(null);
	/** The request whose ticket is being opened; a navigation on that way keeps it. */
	#revealing: OpenRequest | null = null;

	constructor(deps: TransferOfferDeps) {
		this.#deps = deps;
		this.#flags = deps.flags ?? SILENT_FLAGS;
	}

	/** A change the user made in this tab at one ticket. */
	changed(change: TicketChange): void {
		const id = change.after.id;
		const shown = this.#shown.get(id);
		if (shown !== undefined) {
			this.#update(id, shown, nextParentChange(shown.change, change));
			return;
		}
		if (change.undo) return;
		const earlier = this.#earlierOffer(id);
		const started = startParentChange(change, earlier);
		if (this.#choice(started) === 'transfer') {
			// The offer of the series for an earlier change of this ticket gives way to the flag; its
			// fields stay in the change and so in the checkbox of the dialog.
			if (earlier !== null) {
				this.#series = null;
				this.#deps.series.withdrawTemplateOffer(earlier.flag);
			}
			this.#show(id, started);
			return;
		}
		this.#offerSeries(id, change.before, change.after);
	}

	/**
	 * The offer of the series this change would bring ("Auch für künftige Tickets übernehmen"), null
	 * when it would bring none: the checkbox of the dialog stands exactly then.
	 */
	seriesOffer(change: Pick<ParentChange, 'before' | 'after'>): TemplateOffer | null {
		const offers = templateOffers([{ before: change.before, after: change.after }], (id) =>
			this.#deps.series.ruleById(id)
		);
		return offers[0] ?? null;
	}

	/** The checkbox of the dialog: the same writes as the action of the offer of the series. */
	applySeries(offer: TemplateOffer): Promise<TemplateApplyResult> {
		return this.#deps.series.applyTemplateOffers([offer]);
	}

	/** The change whose dialog the section of this ticket should open, null without one. */
	requestFor(ticketId: string): ParentChange | null {
		const request = this.#request;
		return request !== null && request.parentId === ticketId ? request.change : null;
	}

	/** The section of the ticket opens the dialog: the request is taken once. */
	take(ticketId: string): ParentChange | null {
		const change = this.requestFor(ticketId);
		if (change !== null) {
			this.#request = null;
			this.#revealing = null;
		}
		return change;
	}

	/** A navigation ended; a request that is not on its way to its ticket ends with it. */
	navigated(): void {
		if (this.#request !== null && this.#request !== this.#revealing) this.#request = null;
	}

	/**
	 * Another area (E7-3): the flags of the old one go. A request on its way to its ticket stays,
	 * because opening that ticket may be what switched the area.
	 */
	reset(): void {
		const flags = [...this.#shown.values()].map((shown) => shown.flag);
		this.#shown.clear();
		for (const flag of flags) this.#flags.dismiss(flag);
		this.#series = null;
		if (this.#request !== this.#revealing) this.#request = null;
	}

	#choice(change: ParentChange): 'transfer' | 'series' {
		const open = this.#deps.subtasksOf(change.after.id).filter(isOpenSubtask).length;
		return offerChoice(pendingFields(change), open, this.#deps.support() === 'missing');
	}

	#earlierOffer(ticketId: string): SeriesShown | null {
		const series = this.#series;
		if (series === null || series.ticketId !== ticketId) return null;
		return this.#deps.series.isTemplateOffer(series.flag) ? series : null;
	}

	#offerSeries(ticketId: string, before: ChangedTicket, after: ChangedTicket): void {
		const flag = this.#deps.series.offerTemplate([{ before, after }]);
		if (flag !== null) this.#series = { ticketId, before, after, flag };
	}

	#texts(change: ParentChange): { title: string; description: string } {
		return {
			title: changedTitle(pendingFields(change), change.after.key),
			description: changedDescription(this.seriesOffer(change)?.title ?? null)
		};
	}

	#show(ticketId: string, change: ParentChange): void {
		const { title, description } = this.#texts(change);
		const flag: string = this.#flags.show({
			tone: 'info',
			title,
			...(description !== '' && { description }),
			action: { label: CHANGE_TEXTS.action, run: () => this.#open(ticketId) },
			duration: null,
			onclose: () => {
				if (this.#shown.get(ticketId)?.flag === flag) this.#shown.delete(ticketId);
			}
		});
		this.#shown.set(ticketId, { change, flag, title, description });
	}

	/**
	 * A further change of a parent with a flag: the flag names the fields now (a new one replaces it
	 * when its text changes); without a field left it goes, and what else changed of the template goes
	 * to the offer of the series.
	 */
	#update(ticketId: string, shown: ShownFlag, next: ParentChange): void {
		if (this.#choice(next) === 'transfer') {
			const { title, description } = this.#texts(next);
			if (title === shown.title && description === shown.description) {
				this.#shown.set(ticketId, { ...shown, change: next });
				return;
			}
			this.#show(ticketId, next);
			this.#flags.dismiss(shown.flag);
			return;
		}
		this.#shown.delete(ticketId);
		this.#flags.dismiss(shown.flag);
		this.#offerSeries(ticketId, next.before, next.after);
	}

	/** "Übertragen …": the dialog opens in the section of the parent, after opening it if needed. */
	#open(ticketId: string): void {
		const shown = this.#shown.get(ticketId);
		if (shown === undefined) return;
		const request: OpenRequest = { parentId: ticketId, change: shown.change };
		this.#request = request;
		this.#revealing = request;
		const settled = () => {
			if (this.#revealing === request) this.#revealing = null;
		};
		void this.#deps.reveal(ticketId).then(settled, settled);
	}
}

const [getTransferOfferStore, setTransferOfferStore, hasTransferOfferStore] =
	createContext<TransferOfferStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTransferOfferStore(): TransferOfferStore | null {
	return hasTransferOfferStore() ? getTransferOfferStore() : null;
}

export { setTransferOfferStore };
