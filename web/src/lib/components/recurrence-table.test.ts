// Table of the overview "Wiederholungen" (E5 plan, package 5): caption, columns, the title as row
// header with a link to the rule panel, rhythm in words, next ticket, open ticket as key link,
// project, state as text with an icon, and the row action "Pausieren" or "Fortsetzen".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
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
		// "Weitere Spalten im Panel" only while columns are hidden for lack of space (ADR-0030).
		expect(table.querySelector('caption')?.textContent).toBe(
			'Wiederholungen · aktive zuerst, dann nach nächstem Ticket'
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

	it('marks every column with data-col in head and body and fixes the widths in a colgroup', () => {
		const { table } = setup();
		for (const column of ['title', 'rhythm', 'next', 'open', 'project', 'state', 'actions']) {
			const cells = table.querySelectorAll(`th[data-col='${column}'], td[data-col='${column}']`);
			expect(cells).toHaveLength(RULES.length + 1);
		}
		expect(table.querySelectorAll('colgroup > col')).toHaveLength(7);
	});

	describe('columns (ADR-0030, package SP-5)', () => {
		useResizeObserverStub();

		afterEach(() => {
			localStorage.clear();
		});

		it('lets Projekt and Offenes Ticket give way at 700 px; title, state and action stay', async () => {
			const { table } = setup();

			resize(table.parentElement as HTMLElement, 700);
			await tick();

			expect(
				within(table)
					.getAllByRole('columnheader')
					.map((header) => header.getAttribute('data-col'))
			).toEqual(['title', 'rhythm', 'next', 'state', 'actions']);
			expect(table.querySelector('caption')?.textContent).toMatch(/Weitere Spalten im Panel$/);
		});

		it('resizes a column with its grip and stores it under byl-columns-recurrences', async () => {
			const { table } = setup();
			const grip = table.querySelector('[data-column-grip="rhythm"]') as HTMLElement;

			await fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 100 });
			await fireEvent.pointerUp(grip, { pointerId: 1, clientX: 164 });

			expect(JSON.parse(localStorage.getItem('byl-columns-recurrences') ?? '')).toEqual({
				v: 1,
				widths: { rhythm: 224 },
				hidden: []
			});
		});

		it('clamps the title to two lines and shows rhythm and project in one line with a tooltip', () => {
			const { table } = setup();
			const row = table.querySelector('tr[data-rule-row="rule00000000002"]') as HTMLElement;

			expect(row.querySelector('.title-clamp a.title-link')).not.toBeNull();
			const rhythm = row.querySelector('[data-col="rhythm"]') as HTMLElement;
			expect(rhythm.getAttribute('title')).toBe(rhythm.textContent);
			expect(row.querySelector('[data-col="project"]')?.getAttribute('title')).toBe('Haus (HAUS)');
		});

		it('names a sub project with its path (ADR-0034)', () => {
			const { table } = setup({
				projectOf: (entry: RecurrenceRule) =>
					entry.projectId === null
						? null
						: {
								id: entry.projectId,
								name: 'Garten',
								code: 'GART',
								archived: false,
								parent: { id: 'proj00000000001', name: 'Haus', code: 'HAUS' }
							}
			});
			const cell = table.querySelector(
				'tr[data-rule-row="rule00000000002"] [data-col="project"]'
			) as HTMLElement;
			expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('Haus › Garten (GART)');
			expect(cell.getAttribute('title')).toBe('Haus › Garten (GART)');
		});
	});
});
