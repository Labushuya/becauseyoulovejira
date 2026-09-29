// Data of the ticket picker (ADR-0042 section 4) for the (app) layout: one source that every
// place with a ticket choice shares. Open tickets come from the list store, which holds all of
// them anyway and keeps them live (ADR-0006, ADR-0007); the picker only filters them in the client.
// Done tickets are asked for page by page from the server. "Zuletzt angesehen" is a short list of
// ticket IDs per device and user in localStorage (RecentTicketsStore).

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { DataError, toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	listDoneTicketChoices,
	type DoneChoiceQuery,
	type TicketChoicePage
} from '$lib/data/tickets';
import type { CalendarDate } from '$lib/domain/berlin-date';
import { treeOrder } from '$lib/domain/project-tree';
import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
import {
	RECENT_TICKETS_STORAGE_KEY,
	parseRecentTickets,
	rememberTicket,
	serializeRecentTickets
} from '$lib/domain/ticket-picker';
import type { StorageSource } from './first-steps.svelte';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

/** Server access of the picker; tests pass a fake. */
export interface TicketPickerData {
	listDone(
		query: DoneChoiceQuery,
		page: number,
		options: RequestOptions
	): Promise<TicketChoicePage>;
}

export function ticketPickerData(pb: PocketBase): TicketPickerData {
	return {
		listDone: (query, page, options) => listDoneTicketChoices(pb, query, page, options)
	};
}

/** What the picker reads; the app builds it from its stores, tests pass a plain object. */
export interface TicketPickerSource {
	/** Open tickets in the default order of the list (P-2), sub-tasks included. */
	readonly open: readonly TicketSummary[];
	readonly openState: LoadState;
	/** Loads the open tickets once, if the list has not done so yet, or again after a failure. */
	load(): void;
	/** Berlin date of the due labels. */
	readonly today: CalendarDate;
	/** True if the ticket is new for the user (ADR-0015); shown as a dot. */
	isNew(ticket: TicketSummary): boolean;
	/** Project of a ticket as the catalog knows it (with the parent of a sub project). */
	projectOf(ticket: TicketSummary): ProjectRef | null;
	/** Projects in tree order, archived ones included: filter "Projekt" and group order. */
	readonly projects: readonly ProjectRef[];
	/** IDs of the sub projects of a project (ADR-0034); a project filter takes them in. */
	subProjectsOf(projectId: string): readonly string[];
	/** Recently viewed tickets on this device, newest first. */
	readonly recentIds: readonly string[];
	/** One page of done tickets; a lost session ends it (logout) and throws. */
	listDone(
		query: DoneChoiceQuery,
		page: number,
		options: RequestOptions
	): Promise<TicketChoicePage>;
}

/**
 * The recently viewed tickets of the signed-in user on this device (IDs only). The (app) layout
 * creates it per session, so another user starts with the list stored for them.
 */
export class RecentTicketsStore {
	readonly #storage: StorageSource;
	readonly #userId: string | null;
	#ids = $state<string[]>([]);

	constructor(storage: StorageSource, userId: string | null) {
		this.#storage = storage;
		this.#userId = userId;
		try {
			this.#ids = parseRecentTickets(storage()?.getItem(RECENT_TICKETS_STORAGE_KEY), userId);
		} catch {
			this.#ids = [];
		}
	}

	/** Newest first. */
	get ids(): readonly string[] {
		return this.#ids;
	}

	/** The ticket was opened in the panel or the full view: it moves to the front. */
	remember(id: string): void {
		if (this.#userId === null || this.#ids[0] === id) return;
		this.#ids = rememberTicket(this.#ids, id);
		try {
			this.#storage()?.setItem(
				RECENT_TICKETS_STORAGE_KEY,
				serializeRecentTickets(this.#userId, this.#ids)
			);
		} catch {
			// Blocked or full storage: the list lasts for this page.
		}
	}
}

/** What the app hands to `ticketPickerSource`. */
export interface TicketPickerParts {
	data: TicketPickerData;
	session: SessionGuard;
	list: {
		readonly open: readonly TicketSummary[];
		readonly openState: LoadState;
		readonly today: CalendarDate;
		loadOpen(): void;
		reload(): Promise<void>;
		isNew(ticket: TicketSummary): boolean;
	};
	catalog: {
		/** All projects by name, archived ones included, sub projects with their parent. */
		readonly projects: readonly ProjectRef[];
		projectOf(ticket: TicketSummary): ProjectRef | null;
		subProjectsOf(id: string): readonly Pick<ProjectRef, 'id'>[];
	};
	recent: Pick<RecentTicketsStore, 'ids'>;
}

/** The source of the app, on top of its stores. */
export function ticketPickerSource(parts: TicketPickerParts): TicketPickerSource {
	const { data, session, list, catalog, recent } = parts;
	return {
		get open() {
			return list.open;
		},
		get openState() {
			return list.openState;
		},
		// After a failed load the picker tries again when it opens.
		load: () => (list.openState === 'error' ? void list.reload() : list.loadOpen()),
		get today() {
			return list.today;
		},
		isNew: (ticket) => list.isNew(ticket),
		projectOf: (ticket) => catalog.projectOf(ticket),
		get projects() {
			return treeOrder(catalog.projects);
		},
		subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id),
		get recentIds() {
			return recent.ids;
		},
		async listDone(query, page, options) {
			if (!session.ensureValid()) throw new DataError('session');
			try {
				return await data.listDone(query, page, options);
			} catch (error) {
				if (toDataError(error).kind === 'session') session.logout();
				throw error;
			}
		}
	};
}

const [getTicketPickerSource, setTicketPickerSource, hasTicketPickerSource] =
	createContext<TicketPickerSource>();

const [getRecentTickets, setRecentTickets, hasRecentTickets] = createContext<RecentTicketsStore>();

/** The source of the (app) layout, or null outside it (tests of single components). */
export function findTicketPickerSource(): TicketPickerSource | null {
	return hasTicketPickerSource() ? getTicketPickerSource() : null;
}

/** The recently viewed tickets of the (app) layout, or null outside it. */
export function findRecentTickets(): RecentTicketsStore | null {
	return hasRecentTickets() ? getRecentTickets() : null;
}

export { getTicketPickerSource, setRecentTickets, setTicketPickerSource };
