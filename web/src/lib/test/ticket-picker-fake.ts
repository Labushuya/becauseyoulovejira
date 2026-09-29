// Stand-in for the source of the ticket picker (ADR-0042) in component tests: open tickets, done
// ones page by page, projects, recently viewed tickets and the "new" mark, without stores.

import { vi } from 'vitest';
import type { LoadState } from '$lib/stores/ticket-list.svelte';
import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';

/** Done tickets per page of the fake, as PICKER_DONE_PAGE_SIZE of the data layer. */
export const FAKE_DONE_PAGE = 20;

let counter = 0;

/** A ticket of the list with a unique ID; `overrides` set what the test needs. */
export function pickerTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	counter += 1;
	return {
		id: `p${String(counter).padStart(14, '0')}`,
		key: `TASK-${counter}`,
		title: `Ticket ${counter}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		scope: 'u:owner0000000001',
		...overrides
	};
}

export interface FakePickerOptions {
	open?: TicketSummary[];
	/** Done tickets the server knows, most recently changed first. */
	done?: TicketSummary[];
	openState?: LoadState;
	projects?: ProjectRef[];
	recentIds?: string[];
	/** Tickets that are new for the user. */
	newIds?: string[];
	/** Sub project IDs per project. */
	subProjects?: Record<string, string[]>;
	today?: string;
}

/** A source with a spy on `listDone` and `load`. */
export function fakePickerSource(options: FakePickerOptions = {}) {
	const projects = options.projects ?? [];
	const done = options.done ?? [];
	const listDone = vi.fn<TicketPickerSource['listDone']>(async (_query, page) => ({
		items: done.slice((page - 1) * FAKE_DONE_PAGE, page * FAKE_DONE_PAGE),
		hasMore: page * FAKE_DONE_PAGE < done.length
	}));
	const load = vi.fn();
	const source: TicketPickerSource = {
		open: options.open ?? [],
		openState: options.openState ?? 'ready',
		load,
		today: options.today ?? '2026-09-30',
		isNew: (ticket) => (options.newIds ?? []).includes(ticket.id),
		projectOf: (ticket) => projects.find((project) => project.id === ticket.projectId) ?? null,
		projects,
		subProjectsOf: (id) => options.subProjects?.[id] ?? [],
		recentIds: options.recentIds ?? [],
		listDone
	};
	return { source, listDone, load };
}
