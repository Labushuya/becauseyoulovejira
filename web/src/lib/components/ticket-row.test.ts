// Component tests for one list row (E2 plan, package 5): content with and without project, tags
// and due date, text alternatives of the icons, the check mark and "Rückgängig".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { TicketSummary } from '$lib/domain/ticket';
import TicketRow from './TicketRow.svelte';

const TODAY = '2026-09-24';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 'abc123def456ghi',
		key: 'TASK-3',
		title: 'Steuererklärung abgeben',
		status: 'in_progress',
		priority: 'high',
		due: null,
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function renderRow(overrides: Partial<TicketSummary> = {}, props: Record<string, unknown> = {}) {
	const ontoggle = vi.fn();
	const onundo = vi.fn();
	const result = render(TicketRow, {
		props: {
			ticket: ticket(overrides),
			href: '/tickets/abc123def456ghi?erledigte=1' as ResolvedPathname,
			today: TODAY,
			checked: overrides.status === 'done',
			pending: false,
			lingering: false,
			ontoggle,
			onundo,
			...props
		}
	});
	return { ...result, ontoggle, onundo };
}

function link() {
	return screen.getByRole('link');
}

describe('ticket row', () => {
	it('shows key, title with tags, status, priority, project, due date and recurring icon', () => {
		renderRow({
			due: '2026-09-20',
			project: { id: 'p1', name: 'Haushalt', code: 'HH', archived: false },
			tags: [
				{ id: 'g1', name: 'Finanzen' },
				{ id: 'g2', name: 'Amt' }
			],
			recurring: true
		});

		const row = within(link());
		expect(row.getByText('TASK-3').className).toContain('key');
		expect(row.getByText('Steuererklärung abgeben')).toBeTruthy();
		expect(row.getByText('Finanzen')).toBeTruthy();
		expect(row.getByText('Amt')).toBeTruthy();
		expect(row.getByText('In Arbeit')).toBeTruthy();
		expect(row.getByText('Priorität: Hoch')).toBeTruthy();
		expect(row.getByText('HH').getAttribute('title')).toBe('Haushalt');
		expect(row.getByText('20.09.2026').getAttribute('datetime')).toBe('2026-09-20');
		expect(row.getByText('überfällig')).toBeTruthy();
		expect(row.getByText('wiederkehrend')).toBeTruthy();
	});

	it('leaves out project, tags, due date and icon when the ticket has none', () => {
		const { container } = renderRow();

		expect(container.querySelector('.tag')).toBeNull();
		expect(container.querySelector('time')).toBeNull();
		expect(container.querySelector('.project')?.textContent?.trim()).toBe('');
		expect(screen.queryByText('wiederkehrend')).toBeNull();
	});

	it.each([
		['2026-09-24', 'heute'],
		['2026-09-25', 'morgen'],
		['2026-09-28', null]
	])('marks the due date %s with "%s"', (due, hint) => {
		renderRow({ due });

		const label = link().querySelector('.due');
		if (hint) expect(within(link()).getByText(hint)).toBeTruthy();
		else expect(label?.textContent?.trim()).toBe('28.09.2026');
	});

	it('shows no overdue hint for done tickets', () => {
		renderRow({ status: 'done', due: '2026-09-01' });

		expect(screen.queryByText('überfällig')).toBeNull();
		expect(within(link()).getByText('Erledigt')).toBeTruthy();
	});

	it.each([
		['low', 'Priorität: Niedrig'],
		['medium', 'Priorität: Mittel'],
		['urgent', 'Priorität: Dringend']
	] as const)('names the priority %s', (priority, text) => {
		renderRow({ priority });

		expect(within(link()).getByText(text)).toBeTruthy();
	});

	it('links to the detail panel with the current query', () => {
		renderRow();

		expect(link().getAttribute('href')).toBe('/tickets/abc123def456ghi?erledigte=1');
		expect(link().getAttribute('aria-current')).toBeNull();
	});

	it('marks the row shown in the panel as current', () => {
		renderRow({}, { active: true });

		expect(link().getAttribute('aria-current')).toBe('page');
	});

	it('has a check mark of its own, outside the link, labelled with the key', async () => {
		const { ontoggle } = renderRow();

		const toggle = screen.getByRole('checkbox', { name: 'TASK-3 erledigt' });
		expect(link().contains(toggle)).toBe(false);
		await fireEvent.click(toggle);

		expect(ontoggle).toHaveBeenCalledWith(true);
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
		const { container, onundo } = renderRow({ status: 'done' }, { checked: true, lingering: true });

		expect(container.querySelector('li')?.classList.contains('lingering')).toBe(true);
		const undo = screen.getByRole('button', { name: /^Rückgängig/ });
		expect(undo.getAttribute('aria-label')).toBe('Rückgängig: TASK-3 wieder öffnen');
		await fireEvent.click(undo);

		expect(onundo).toHaveBeenCalledOnce();
	});

	it('offers no "Rückgängig" otherwise', () => {
		renderRow({ status: 'done' }, { checked: true });

		expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
	});
});
