// Component tests for one table row (E3 plan, T-4 and package 5; carried over from the E2 row
// tests): cells with and without project, tags and due date, text alternatives of the icons, the
// check mark, "Rückgängig", the mouse-only "Öffnen" link and the click on the row.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
import TicketTableRow from './TicketTableRow.svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn(async () => undefined) }));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

const TODAY = '2026-09-24';
const HREF = '/tickets/abc123def456ghi?erledigte=1' as ResolvedPathname;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 'abc123def456ghi',
		key: 'TASK-3',
		title: 'Steuererklärung abgeben',
		status: 'in_progress',
		priority: 'high',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function renderRow(
	overrides: Partial<TicketSummary> = {},
	props: { project?: ProjectRef | null; tags?: TagRef[]; [key: string]: unknown } = {}
) {
	const ontoggle = vi.fn();
	const onundo = vi.fn();
	const table = document.createElement('table');
	const body = document.createElement('tbody');
	table.append(body);
	document.body.append(table);
	const result = render(TicketTableRow, {
		target: body,
		props: {
			ticket: ticket(overrides),
			project: null,
			tags: [],
			href: HREF,
			today: TODAY,
			checked: overrides.status === 'done',
			pending: false,
			lingering: false,
			ontoggle,
			onundo,
			...props
		}
	});
	return { ...result, ontoggle, onundo, row: body.querySelector('tr') as HTMLTableRowElement };
}

function cell(row: HTMLElement, name: string): HTMLElement {
	return row.querySelector(`.${name}`) as HTMLElement;
}

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
});

describe('ticket table row', () => {
	it('shows key, priority, status, title, project, tags, due date, creation date and icon', () => {
		const { row } = renderRow(
			{ due: '2026-09-20', recurring: true, created: '2026-09-01 22:30:00.000Z' },
			{
				project: { id: 'p1', name: 'Haushalt', code: 'HH', archived: false },
				tags: [
					{ id: 'g1', name: 'Finanzen' },
					{ id: 'g2', name: 'Amt' }
				]
			}
		);

		const cells = [...row.children].map((element) => element.className.split(' ')[0]);
		expect(cells).toEqual([
			'key',
			'priority',
			'status',
			'title',
			'project',
			'tags',
			'due',
			'created',
			'actions'
		]);
		expect(cell(row, 'key').textContent).toBe('TASK-3');
		expect(within(cell(row, 'priority')).getByText('Priorität: Hoch')).toBeTruthy();
		expect(within(cell(row, 'status')).getByText('In Arbeit')).toBeTruthy();
		const title = cell(row, 'title');
		expect(title.tagName).toBe('TH');
		expect(title.getAttribute('scope')).toBe('row');
		expect(within(title).getByRole('link').textContent).toBe('Steuererklärung abgeben');
		expect(within(title).getByText('wiederkehrend')).toBeTruthy();
		const project = within(cell(row, 'project')).getByText('Haushalt');
		expect(project.getAttribute('title')).toBe('Haushalt (HH)');
		expect([...cell(row, 'tags').querySelectorAll('.tag')].map((tag) => tag.textContent)).toEqual([
			'Finanzen',
			'Amt'
		]);
		const due = cell(row, 'due').querySelector('time');
		expect(due?.getAttribute('datetime')).toBe('2026-09-20');
		expect(due?.textContent).toBe('seit 4 Tagen überfällig, 20.09.2026');
		// 22:30 UTC is already the next day in Berlin.
		const created = within(cell(row, 'created')).getByText('02.09.2026');
		expect(created.getAttribute('datetime')).toBe('2026-09-02');
		expect(created.getAttribute('title')).toBe('02.09.2026 00:30');
	});

	it('leaves project, tags, due date and icon empty when the ticket has none', () => {
		const { row } = renderRow();

		expect(cell(row, 'project').textContent?.trim()).toBe('');
		expect(cell(row, 'tags').textContent?.trim()).toBe('');
		expect(cell(row, 'due').querySelector('time')).toBeNull();
		expect(within(cell(row, 'due')).getByText('keine Fälligkeit')).toBeTruthy();
		expect(screen.queryByText('wiederkehrend')).toBeNull();
	});

	it.each([
		['2026-09-24', 'heute, 24.09.2026'],
		['2026-09-25', 'morgen, 25.09.2026'],
		['2026-09-28', 'in 4 Tagen, 28.09.2026'],
		['2026-10-05', '05.10.2026']
	])('labels the due date %s as "%s"', (due, text) => {
		const { row } = renderRow({ due });

		expect(cell(row, 'due').querySelector('time')?.textContent).toBe(text);
	});

	it('shows only the date for done tickets', () => {
		const { row } = renderRow({ status: 'done', due: '2026-09-01' });

		expect(cell(row, 'due').querySelector('time')?.textContent).toBe('01.09.2026');
		expect(screen.queryByText(/überfällig/)).toBeNull();
		expect(within(cell(row, 'status')).getByText('Erledigt')).toBeTruthy();
	});

	it.each([
		['low', 'Priorität: Niedrig'],
		['medium', 'Priorität: Mittel'],
		['urgent', 'Priorität: Dringend']
	] as const)('names the priority %s', (priority, text) => {
		const { row } = renderRow({ priority });

		expect(within(cell(row, 'priority')).getByText(text)).toBeTruthy();
	});

	it('links the title to the detail panel with the current query', () => {
		renderRow();

		const link = screen.getByRole('link');
		expect(link.getAttribute('href')).toBe(HREF);
		expect(link.getAttribute('aria-current')).toBeNull();
	});

	it('marks the row shown in the panel as current', () => {
		const { row } = renderRow({}, { active: true });

		expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
		expect(row.classList.contains('active')).toBe(true);
	});

	it('offers "Öffnen" only to the mouse', () => {
		const { row } = renderRow();

		const open = cell(row, 'open');
		expect(open.getAttribute('href')).toBe(HREF);
		expect(open.getAttribute('tabindex')).toBe('-1');
		expect(open.getAttribute('aria-hidden')).toBe('true');
		// The accessible tree knows only the title link.
		expect(screen.getAllByRole('link')).toHaveLength(1);
	});

	it('opens the ticket on a click anywhere in the row outside of controls', async () => {
		const { row } = renderRow();

		await fireEvent.click(cell(row, 'project'));
		await fireEvent.click(cell(row, 'key'));

		expect(mocks.goto).toHaveBeenCalledTimes(2);
		expect(mocks.goto).toHaveBeenLastCalledWith(HREF);
	});

	it('leaves modified clicks and other buttons to the browser', async () => {
		const { row } = renderRow();

		await fireEvent.click(cell(row, 'key'), { ctrlKey: true });
		await fireEvent.click(cell(row, 'key'), { button: 1 });

		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('does not open the ticket from a click on the check mark', async () => {
		const { ontoggle } = renderRow();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-3 erledigt' }));

		expect(ontoggle).toHaveBeenCalledWith(true);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('does not open the ticket while text in the row is selected', async () => {
		const { row } = renderRow();
		const selection = vi.spyOn(window, 'getSelection').mockReturnValue({
			toString: () => 'Steuer'
		} as Selection);

		await fireEvent.click(cell(row, 'key'));

		expect(mocks.goto).not.toHaveBeenCalled();
		selection.mockRestore();
	});

	it('has a check mark of its own, outside the title link, labelled with the key', () => {
		renderRow();

		const toggle = screen.getByRole('checkbox', { name: 'TASK-3 erledigt' });
		expect(screen.getByRole('link').contains(toggle)).toBe(false);
	});

	it('locks the check mark during a request without taking the focus away', async () => {
		const { ontoggle } = renderRow({}, { checked: true, pending: true });

		const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: 'TASK-3 erledigt' });
		toggle.focus();
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		expect(toggle.checked).toBe(true);
		await fireEvent.click(toggle);

		expect(ontoggle).not.toHaveBeenCalled();
		expect(toggle.checked).toBe(true);
		expect(document.activeElement).toBe(toggle);
	});

	it('strikes a just checked row through and offers "Rückgängig"', async () => {
		const { row, onundo } = renderRow({ status: 'done' }, { checked: true, lingering: true });

		expect(row.classList.contains('lingering')).toBe(true);
		const undo = screen.getByRole('button', { name: /^Rückgängig/ });
		expect(undo.getAttribute('aria-label')).toBe('Rückgängig: TASK-3 wieder öffnen');
		await fireEvent.click(undo);

		expect(onundo).toHaveBeenCalledOnce();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('offers no "Rückgängig" otherwise', () => {
		renderRow({ status: 'done' }, { checked: true });

		expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
	});
});
