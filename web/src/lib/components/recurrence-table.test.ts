// Table of the overview "Wiederholungen" (E5 plan, package 5): caption, columns, the title as row
// header with a link to the rule panel, rhythm in words, next ticket, open ticket as key link,
// project, state as text with an icon, and the row action "Pausieren" or "Fortsetzen".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import RecurrenceTable from './RecurrenceTable.svelte';

const TODAY = '2026-09-25';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll rausbringen',
		description: '',
		projectId: null,
		tagIds: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-09-28',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const RULES = [
	rule(),
	rule({
		id: 'rule00000000002',
		title: 'Blumen gießen',
		mode: 'after_completion',
		freq: 'daily',
		interval: 3,
		weekdays: [],
		nextDue: null,
		projectId: 'proj00000000001'
	}),
	rule({
		id: 'rule00000000003',
		title: 'Steuer',
		freq: 'yearly',
		weekdays: [],
		anchor: '2026-05-31',
		nextDue: '2027-05-31',
		active: false
	})
];

function setup(overrides: Record<string, unknown> = {}) {
	const ontoggle = vi.fn();
	render(RecurrenceTable, {
		props: {
			rules: RULES,
			today: TODAY,
			hrefOf: (entry: RecurrenceRule) => `/wiederholungen/${entry.id}` as ResolvedPathname,
			openTicketOf: (entry: RecurrenceRule) =>
				entry.id === 'rule00000000001'
					? { id: 'ticket000000001', key: 'TASK-7', title: 'Müll rausbringen' }
					: null,
			ticketHrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname,
			projectOf: (entry: RecurrenceRule) =>
				entry.projectId === null
					? null
					: { id: entry.projectId, name: 'Haus', code: 'HAUS', archived: false },
			ontoggle,
			...overrides
		}
	});
	return { ontoggle, table: screen.getByRole('table') };
}

describe('RecurrenceTable', () => {
	it('names its order in the caption and its columns in the head', () => {
		const { table } = setup();
		expect(table.querySelector('caption')?.textContent).toBe(
			'Wiederholungen · aktive zuerst, dann nach nächstem Ticket · Weitere Spalten im Panel'
		);
		expect(
			within(table)
				.getAllByRole('columnheader')
				.map((header) => header.textContent?.trim())
		).toEqual([
			'Titel',
			'Rhythmus',
			'Nächstes Ticket',
			'Offenes Ticket',
			'Projekt',
			'Zustand',
			'Aktionen'
		]);
	});

	it('shows each rule in the given order with rhythm, next ticket, open ticket and project', () => {
		const { table } = setup();
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows.map((row) => within(row).getByRole('rowheader').textContent?.trim())).toEqual([
			'Müll rausbringen',
			'Blumen gießen',
			'Steuer'
		]);

		const [weekly, afterCompletion, yearly] = rows as [HTMLElement, HTMLElement, HTMLElement];
		const cells = (row: HTMLElement) =>
			within(row)
				.getAllByRole('cell')
				.map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim());
		expect(cells(weekly)).toEqual([
			'Jeden Montag',
			'28.09.',
			'TASK-7',
			'–kein Projekt',
			'Aktiv',
			''
		]);
		expect(cells(afterCompletion)).toEqual([
			'3 Tage nach Erledigung',
			'nach dem Erledigen',
			'–keins',
			'Haus (HAUS)',
			'Aktiv',
			''
		]);
		expect(cells(yearly)).toEqual([
			'Jährlich am 31. Mai',
			'31.05.2027',
			'–keins',
			'–kein Projekt',
			'Pausiert',
			''
		]);
	});

	it('links the title to the rule panel and the key to the ticket panel', () => {
		setup({ activeId: 'rule00000000002' });
		const title = screen.getByRole('link', { name: 'Blumen gießen' });
		expect(title.getAttribute('href')).toBe('/wiederholungen/rule00000000002');
		expect(title.getAttribute('aria-current')).toBe('page');
		expect(title.closest('tr')?.classList.contains('active')).toBe(true);
		expect(
			screen.getByRole('link', { name: 'Müll rausbringen' }).hasAttribute('aria-current')
		).toBe(false);
		const key = screen.getByRole('link', { name: 'TASK-7' });
		expect(key.getAttribute('href')).toBe('/tickets/ticket000000001');
	});

	it('says "wird geladen" while the open tickets are unknown', () => {
		setup({ openTicketOf: () => undefined });
		expect(screen.getAllByText('wird geladen')).toHaveLength(3);
	});

	it('pauses or resumes a row through a named icon button', async () => {
		const { ontoggle } = setup();
		const pause = screen.getByRole('button', { name: 'Pausieren: Müll rausbringen' });
		expect(pause.getAttribute('title')).toBe('Pausieren');
		await fireEvent.click(pause);
		expect(ontoggle).toHaveBeenCalledWith(RULES[0]);

		await fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen: Steuer' }));
		expect(ontoggle).toHaveBeenLastCalledWith(RULES[2]);
	});

	it('locks the button of a running action', async () => {
		const { ontoggle } = setup({ busyId: 'rule00000000001' });
		const pause = screen.getByRole('button', { name: 'Pausieren: Müll rausbringen' });
		expect(pause.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(pause);
		expect(ontoggle).not.toHaveBeenCalled();
	});

	it('marks the columns that give way with data-col in head and body', () => {
		const { table } = setup();
		for (const column of ['rhythm', 'next', 'open', 'project']) {
			expect(table.querySelectorAll(`[data-col='${column}']`)).toHaveLength(RULES.length + 1);
		}
	});
});
