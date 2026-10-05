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
		show('/?gruppe=status&sort=titel');

		await fireEvent.click(choice('Nach Status'));
		expect(mocks.goto).not.toHaveBeenCalled();

		await fireEvent.click(choice('Keine'));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/?sort=titel', {
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

describe('group popover: second level (plan OR-3)', () => {
	const NAVIGATION = { keepFocus: true, noScroll: true };

	function second() {
		return screen.getByRole('group', { hidden: true, name: 'Danach gruppieren' });
	}

	function secondChoice(name: string) {
		return within(second()).getByRole<HTMLInputElement>('radio', { hidden: true, name });
	}

	it('locks the second level with a hint while there is no first one', () => {
		show();
		const fieldset = second() as HTMLFieldSetElement;
		expect(fieldset.disabled).toBe(true);
		const hint = document.getElementById(String(fieldset.getAttribute('aria-describedby')));
		expect(hint?.textContent).toBe('Erst eine erste Ebene wählen.');
		// The first level keeps its seven choices; the second is a fieldset of its own.
		expect(within(field()).getAllByRole('radio', { hidden: true })).toHaveLength(7);
	});

	it('offers "Keine" and every grouping except the first level', () => {
		show('/?gruppe=projekt');
		expect((second() as HTMLFieldSetElement).disabled).toBe(false);
		expect(
			within(second())
				.getAllByRole('radio', { hidden: true })
				.map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual([
			'Keine',
			'Nach Status',
			'Nach Priorität',
			'Nach Fälligkeit',
			'Nach Quelle',
			'Nach Wiederholung'
		]);
		expect(secondChoice('Keine').checked).toBe(true);
	});

	it('sets "untergruppe" and names both levels on the button', async () => {
		show('/?status=open&gruppe=projekt');
		await fireEvent.click(secondChoice('Nach Status'));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/?status=open&gruppe=projekt&untergruppe=status',
			{ keepFocus: true, noScroll: true }
		);

		document.body.innerHTML = '';
		show('/?gruppe=faellig&untergruppe=prio');
		const button = screen.getByRole('button', { name: 'Gruppiert: Fälligkeit › Priorität' });
		expect(button.classList.contains('active')).toBe(true);
		expect(secondChoice('Nach Priorität').checked).toBe(true);
	});

	it('clears the second level with "Keine", with the first "Keine" and when it becomes the first', async () => {
		show('/?gruppe=projekt&untergruppe=status');
		await fireEvent.click(secondChoice('Keine'));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?gruppe=projekt', NAVIGATION);

		await fireEvent.click(choice('Nach Status'));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?gruppe=status', NAVIGATION);

		await fireEvent.click(choice('Nach Priorität'));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?gruppe=prio&untergruppe=status', NAVIGATION);

		await fireEvent.click(choice('Keine'));
		expect(mocks.goto).toHaveBeenLastCalledWith('/', NAVIGATION);
	});

	it('does not navigate for the current second level', async () => {
		show('/?gruppe=projekt&untergruppe=status');
		await fireEvent.click(secondChoice('Nach Status'));
		expect(mocks.goto).not.toHaveBeenCalled();
	});
});

describe('group popover: "Nach Zuständigkeit" (E7-5, ADR-0068 §3)', () => {
	function showIn(path: string, household: boolean) {
		mocks.page.url = new URL(path, 'http://localhost:3000');
		return render(GroupPopover, { props: { household } });
	}

	const labels = () =>
		within(field())
			.getAllByRole('radio', { hidden: true })
			.map((radio) => radio.closest('label')?.textContent?.trim());

	it('is offered in a household and writes the address', async () => {
		showIn('/', true);
		expect(labels()).toContain('Nach Zuständigkeit');

		await fireEvent.click(choice('Nach Zuständigkeit'));
		expect(mocks.goto).toHaveBeenLastCalledWith('/?gruppe=zustaendig', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('is not offered in the private area unless the address uses it', () => {
		showIn('/', false);
		expect(labels()).not.toContain('Nach Zuständigkeit');

		document.body.innerHTML = '';
		showIn('/?gruppe=zustaendig', false);
		expect(choice('Nach Zuständigkeit').checked).toBe(true);
		expect(screen.getByRole('button', { name: 'Gruppiert: Zuständigkeit' })).toBeTruthy();
	});
});
