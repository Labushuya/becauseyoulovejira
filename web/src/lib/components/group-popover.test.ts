// Component tests for the popover "Gruppieren" (E3 plan, T-7, T-8 and package 13; since UI-2 on
// the popover building block of ADR-0025): popover attributes, button label, radio choices in a
// fieldset, the choice as URL change, closing on a pointer click and on Enter, opening with the
// focus on the chosen grouping and Escape. The shared stubs stand in for the popover API of
// jsdom; the position in the browsers is on the browser checklist (BYL-E6-007).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import GroupPopover from './GroupPopover.svelte';
import source from './GroupPopover.svelte?raw';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

function show(path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	return render(GroupPopover);
}

function field() {
	return screen.getByRole('group', { hidden: true, name: 'Gruppieren' });
}

function choice(name: string) {
	return within(field()).getByRole<HTMLInputElement>('radio', { hidden: true, name });
}

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
});

describe('group popover', () => {
	it('is a button with popovertarget and aria-controls for a native popover', () => {
		show();

		const button = screen.getByRole('button', { name: 'Gruppieren' });
		const target = button.getAttribute('popovertarget');
		expect(target).toBeTruthy();
		expect(button.getAttribute('aria-controls')).toBe(target);
		const popover = document.getElementById(String(target));
		expect(popover?.getAttribute('popover')).toBe('auto');
		expect(popover?.contains(field())).toBe(true);
		expect(field().tagName).toBe('FIELDSET');
	});

	it('offers "Keine" and the six groupings as radios, the current one checked', () => {
		show('/?gruppe=projekt');

		expect(
			within(field())
				.getAllByRole('radio', { hidden: true })
				.map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual([
			'Keine',
			'Nach Status',
			'Nach Priorität',
			'Nach Projekt',
			'Nach Fälligkeit',
			'Nach Quelle',
			'Nach Wiederholung'
		]);
		expect(choice('Nach Projekt').checked).toBe(true);
		expect(choice('Keine').checked).toBe(false);
	});

	it.each([
		['/', 'Gruppieren'],
		['/?gruppe=status', 'Gruppiert: Status'],
		['/?gruppe=prio', 'Gruppiert: Priorität'],
		['/?gruppe=projekt', 'Gruppiert: Projekt'],
		['/?gruppe=faellig', 'Gruppiert: Fälligkeit'],
		['/?gruppe=quelle', 'Gruppiert: Quelle'],
		['/?gruppe=wiederholung', 'Gruppiert: Wiederholung']
	])('names the active grouping on the button (%s)', (path, label) => {
		show(path);

		const button = screen.getByRole('button', { name: label });
		expect(button.classList.contains('active')).toBe(path !== '/');
	});

	it('sets the parameter "gruppe" and keeps the others', async () => {
		show('/tickets/abc123def456ghi?status=open&sort=titel');

		await fireEvent.click(choice('Nach Fälligkeit'));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/tickets/abc123def456ghi?status=open&sort=titel&gruppe=faellig',
			{ keepFocus: true, noScroll: true }
		);
	});

	it('removes the parameter with "Keine" and does not navigate for the current choice', async () => {
		show('/?gruppe=status&erledigte=1');

		await fireEvent.click(choice('Nach Status'));
		expect(mocks.goto).not.toHaveBeenCalled();

		await fireEvent.click(choice('Keine'));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/?erledigte=1', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('returns the focus to the button after a pointer click or Enter, not after arrow keys', async () => {
		show();
		const button = screen.getByRole('button', { name: 'Gruppieren' });

		choice('Nach Status').focus();
		await fireEvent.click(choice('Nach Status'), { detail: 0 });
		expect(document.activeElement).toBe(choice('Nach Status'));

		await fireEvent.click(choice('Nach Priorität'), { detail: 1 });
		expect(document.activeElement).toBe(button);

		choice('Nach Projekt').focus();
		await fireEvent.keyDown(choice('Nach Projekt'), { key: 'Enter' });
		expect(document.activeElement).toBe(button);
	});

	it('uses no error colour and no shadows (ADR-0010 section 3)', () => {
		expect(source).not.toMatch(/danger|box-shadow|gradient|backdrop-filter/);
	});

	it('opens as a panel with the focus on the chosen grouping and closes with Escape (UI-2)', async () => {
		show('/?gruppe=faellig');
		const button = screen.getByRole('button', { name: 'Gruppiert: Fälligkeit' });
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		expect(button.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(button);
		await tick();

		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(choice('Nach Fälligkeit'));

		await fireEvent.keyDown(choice('Nach Fälligkeit'), { key: 'Escape' });

		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('uses the building block, right-aligned, instead of CSS anchor positioning (UI-2)', () => {
		expect(source).toMatch(/<Popover[\s\S]*placement="bottom-end"/);
		expect(source).not.toMatch(/anchor-name|position-anchor|popover="auto"/);
	});
});
