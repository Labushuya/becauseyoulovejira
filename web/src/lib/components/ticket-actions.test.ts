// The menu "•••" of a ticket (plan aktionsmenues, AM-1): the button and the menu for assistive
// technology, the entries depending on what is possible, the keyboard (APG menu button), choosing
// an entry closes the menu before it runs and leaves the focus on the button, and "Link kopieren"
// with its flag. jsdom has no popover API; the shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DayPlanEntryStore } from '$lib/stores/day-plan.svelte';
import type { FlagInput } from '$lib/stores/flags.svelte';
import DayPlanEntryHarness from '$lib/test/DayPlanEntryHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketActions from './TicketActions.svelte';

useOverlayStubs();

const TICKET = { id: 'ticket000000012', key: 'HAUS-12' };

function renderMenu(props: Record<string, unknown> = {}) {
	const shown: FlagInput[] = [];
	const flags = {
		show: vi.fn((input: FlagInput) => {
			shown.push(input);
			return 'flag';
		}),
		dismiss: vi.fn()
	};
	const onduplicate = vi.fn();
	const ondelete = vi.fn();
	render(TicketActions, { props: { ticket: TICKET, flags, onduplicate, ondelete, ...props } });
	const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
	// jsdom renders a popover as display: none and computes no name for it; hence `hidden`.
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '') as HTMLElement;
	const entries = () =>
		within(menu)
			.getAllByRole('menuitem', { hidden: true })
			.map((item) => item.textContent?.trim());
	const entry = (name: string) => within(menu).getByRole('menuitem', { name, hidden: true });
	return { trigger, menu, entries, entry, shown, flags, onduplicate, ondelete };
}

async function open(trigger: HTMLElement) {
	trigger.focus();
	await fireEvent.click(trigger);
	await tick();
}

describe('menu "•••" of a ticket (AM-1)', () => {
	it('is a named symbol button that opens a named menu', () => {
		const { trigger, menu } = renderMenu();
		expect(trigger.getAttribute('title')).toBe('Weitere Aktionen');
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.className).toContain('button-icon');
		expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		expect(menu.getAttribute('role')).toBe('menu');
		expect(menu.getAttribute('aria-label')).toBe('Weitere Aktionen für HAUS-12');
	});

	it('lists "Link kopieren", "Duplizieren …" and, after a line, "In den Papierkorb …"', () => {
		const { menu, entries, entry } = renderMenu();
		expect(entries()).toEqual(['Link kopieren', 'Duplizieren …', 'In den Papierkorb …']);
		const line = within(menu).getByRole('separator', { hidden: true });
		expect(line.nextElementSibling).toBe(entry('In den Papierkorb …'));
		// In the side panel both open a dialog; copying does not.
		expect(entry('Duplizieren …').getAttribute('aria-haspopup')).toBe('dialog');
		expect(entry('In den Papierkorb …').getAttribute('aria-haspopup')).toBe('dialog');
		expect(entry('Link kopieren').getAttribute('aria-haspopup')).toBeNull();
		// Entries are reached with the arrow keys, not with Tab.
		for (const item of within(menu).getAllByRole('menuitem', { hidden: true })) {
			expect(item.getAttribute('tabindex')).toBe('-1');
		}
	});

	it('leaves out "Duplizieren …" without its store', () => {
		const { entries } = renderMenu({ onduplicate: null });
		expect(entries()).toEqual(['Link kopieren', 'In den Papierkorb …']);
	});

	it('puts "Folge-Ticket anlegen …" after "Duplizieren …", also for a done ticket, and runs it (ADR-0067)', async () => {
		const onfollowup = vi.fn();
		const { trigger, entries, entry } = renderMenu({
			ticket: { ...TICKET, status: 'done' },
			onfollowup
		});
		expect(entries()).toEqual([
			'Link kopieren',
			'Duplizieren …',
			'Folge-Ticket anlegen …',
			'In den Papierkorb …'
		]);
		expect(entry('Folge-Ticket anlegen …').getAttribute('aria-haspopup')).toBe('dialog');
		await open(trigger);
		await fireEvent.click(entry('Folge-Ticket anlegen …'));
		expect(onfollowup).toHaveBeenCalledOnce();
	});

	it('unfolds "Folge-Ticket anlegen …" in the content of the full view, no dialog (ADR-0067)', () => {
		const { entry } = renderMenu({ onfollowup: vi.fn(), inline: true });
		expect(entry('Folge-Ticket anlegen …').getAttribute('aria-haspopup')).toBeNull();
	});

	it('adds "Fälligkeit verschieben …" in the calendar, after the ways to open, and runs it', async () => {
		const onmovedue = vi.fn();
		const { trigger, menu, entries, entry } = renderMenu({
			onmovedue,
			open: {
				panel: '/kalender/tickets/ticket000000012',
				full: '/kalender/tickets/ticket000000012/voll'
			}
		});
		expect(entries()).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Fälligkeit verschieben …',
			'Link kopieren',
			'Duplizieren …',
			'In den Papierkorb …'
		]);
		const lines = within(menu).getAllByRole('separator', { hidden: true });
		expect(lines[0]?.nextElementSibling).toBe(entry('Fälligkeit verschieben …'));
		// It asks for the day in the calendar, not in a dialog.
		expect(entry('Fälligkeit verschieben …').getAttribute('aria-haspopup')).toBeNull();

		await open(trigger);
		await fireEvent.click(entry('Fälligkeit verschieben …'));
		expect(onmovedue).toHaveBeenCalledOnce();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
	});

	it('announces no dialog in the full view, where the entries unfold a question inline', () => {
		const { entry } = renderMenu({ inline: true });
		expect(entry('Duplizieren …').getAttribute('aria-haspopup')).toBeNull();
		expect(entry('In den Papierkorb …').getAttribute('aria-haspopup')).toBeNull();
	});

	it('works with the keyboard: first entry, arrow keys with wrap, Home, End and Escape', async () => {
		const { trigger, entry } = renderMenu();
		await open(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(entry('Link kopieren'));

		const steps: [string, string][] = [
			['ArrowDown', 'Duplizieren …'],
			['ArrowDown', 'In den Papierkorb …'],
			['ArrowDown', 'Link kopieren'],
			['ArrowUp', 'In den Papierkorb …'],
			['Home', 'Link kopieren'],
			['End', 'In den Papierkorb …']
		];
		for (const [key, name] of steps) {
			await fireEvent.keyDown(document.activeElement as Element, { key });
			expect(document.activeElement, key).toBe(entry(name));
		}

		const escape = await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(escape).toBe(false);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger);
	});

	it.each([
		['Duplizieren …', 'onduplicate'],
		['In den Papierkorb …', 'ondelete']
	] as const)('closes the menu before "%s" runs, the focus on the button', async (name, spy) => {
		const context = renderMenu();
		await open(context.trigger);
		await fireEvent.click(context.entry(name));

		expect(context[spy]).toHaveBeenCalledOnce();
		expect(context.trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(context.trigger);
	});

	it('copies the address of the ticket and says so in a flag', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { trigger, entry, shown, onduplicate, ondelete } = renderMenu();
		await open(trigger);
		await fireEvent.click(entry('Link kopieren'));

		await vi.waitFor(() => expect(shown).toHaveLength(1));
		expect(writeText).toHaveBeenCalledExactlyOnceWith(
			`${window.location.origin}/tickets/ticket000000012`
		);
		expect(shown[0]).toEqual({
			tone: 'success',
			title: 'Link kopiert',
			description: 'Der Link zu HAUS-12 liegt in der Zwischenablage.'
		});
		expect(onduplicate).not.toHaveBeenCalled();
		expect(ondelete).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(trigger);
	});

	it('names the address in an error flag when the browser refuses the clipboard', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('denied');
				}
			}
		});
		const { trigger, entry, shown } = renderMenu();
		await open(trigger);
		await fireEvent.click(entry('Link kopieren'));

		await vi.waitFor(() => expect(shown).toHaveLength(1));
		expect(shown[0]?.tone).toBe('error');
		expect(shown[0]?.title).toBe('Link konnte nicht kopiert werden.');
		expect(shown[0]?.description).toContain(`${window.location.origin}/tickets/ticket000000012`);
	});
});

describe('"Zum Tagesplan" in the menu "•••" (ADR-0065)', () => {
	function renderWithPlan(ticket: Record<string, unknown>) {
		const add = vi.fn(async () => ({
			item: {} as never,
			plan: { id: 'plan00000000001', date: '2031-05-14', scope: 'u:x', dismissed: [] },
			already: false
		}));
		const shown: FlagInput[] = [];
		const flags = {
			show: vi.fn((input: FlagInput) => {
				shown.push(input);
				return 'flag';
			}),
			dismiss: vi.fn()
		};
		const store = new DayPlanEntryStore(
			{ add },
			{ ensureValid: () => true, logout: vi.fn() },
			flags,
			vi.fn()
		);
		render(DayPlanEntryHarness, {
			props: { store, props: { ticket, flags, onduplicate: null, ondelete: vi.fn() } }
		});
		const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' });
		const menu = document.getElementById(
			trigger.getAttribute('aria-controls') ?? ''
		) as HTMLElement;
		const entries = () =>
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((item) => item.textContent?.trim());
		return { trigger, menu, entries, add, shown };
	}

	it('puts an open ticket into the plan of today of its area', async () => {
		const { trigger, menu, entries, add, shown } = renderWithPlan({ ...TICKET, status: 'open' });
		expect(entries()).toEqual(['Zum Tagesplan', 'Link kopieren', 'In den Papierkorb …']);
		await open(trigger);
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'Zum Tagesplan', hidden: true })
		);
		await vi.waitFor(() => expect(add).toHaveBeenCalledWith('ticket000000012'));
		await vi.waitFor(() => expect(shown[0]?.title).toBe('HAUS-12 im Tagesplan von heute.'));
	});

	it('offers nothing for a done ticket', () => {
		const { entries } = renderWithPlan({ ...TICKET, status: 'done' });
		expect(entries()).toEqual(['Link kopieren', 'In den Papierkorb …']);
	});
});
