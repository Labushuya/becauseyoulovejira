// Which rows of the project list show their open tickets (ADR-0034, addendum "Offene Tickets in
// Projekten"; plan projekte-tickets): a preference of this device, kept in localStorage
// (`byl-projects-tickets`, only record IDs). Default closed. Storage that is blocked or full never
// breaks the list; the choice then lasts for this page. Other tabs follow through the storage
// event. One instance per project view; nothing to share with other parts of the app.

import { SvelteSet } from 'svelte/reactivity';
import {
	PROJECT_TICKETS_STORAGE_KEY,
	readOpenProjectTickets,
	writeOpenProjectTickets
} from '$lib/domain/project-tickets';

type ListStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(win: Window | null): ListStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

export class ProjectTicketsDisclosure {
	readonly #win: Window | null;
	/** Open rows in the order they were opened, the newest last (that order is stored). */
	readonly #open = new SvelteSet<string>();

	constructor(win: Window | null) {
		this.#win = win;
		for (const id of readOpenProjectTickets(storageOf(win))) this.#open.add(id);
	}

	/** Whether the row of the project shows its open tickets. */
	isOpen(projectId: string): boolean {
		return this.#open.has(projectId);
	}

	/** Opens or closes one row. */
	toggle(projectId: string): void {
		if (this.#open.has(projectId)) this.#open.delete(projectId);
		else this.#open.add(projectId);
		this.#save();
	}

	/** "Alle aufklappen": opens every given row; open ones stay. */
	openAll(projectIds: Iterable<string>): void {
		let changed = false;
		for (const id of projectIds) {
			if (this.#open.has(id)) continue;
			this.#open.add(id);
			changed = true;
		}
		if (changed) this.#save();
	}

	/** "Alle zuklappen": closes every row, also those the list does not show right now. */
	closeAll(): void {
		if (this.#open.size === 0) return;
		this.#open.clear();
		this.#save();
	}

	/** Whether no row is open. */
	get none(): boolean {
		return this.#open.size === 0;
	}

	/** Follows other tabs; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key !== null && event.key !== PROJECT_TICKETS_STORAGE_KEY) return;
			const ids =
				event.key === null ? [] : readOpenProjectTickets({ getItem: () => event.newValue });
			this.#open.clear();
			for (const id of ids) this.#open.add(id);
		};
		win.addEventListener('storage', onstorage);
		return () => win.removeEventListener('storage', onstorage);
	}

	#save(): void {
		writeOpenProjectTickets(storageOf(this.#win), [...this.#open]);
	}
}
