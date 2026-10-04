// The dialog of the charms (ADR-0062): a small button with the current charm or "Charm wählen", a
// popover with a search, "Kein Charm" and the catalog in groups as a listbox; search, keys, choice,
// "Kein Charm", the error of the server at the button, 44 px targets on touch screens. The symbol
// before a title (CharmIcon) is decorative, with a hidden name and a tooltip.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { CHARMS, CHARM_GROUP_LABELS } from '$lib/domain/charms';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import CharmIcon from './CharmIcon.svelte';
import CharmPicker from './CharmPicker.svelte';
import pickerSource from './CharmPicker.svelte?raw';

useOverlayStubs();

function show(props: Record<string, unknown> = {}) {
	const onchoose = vi.fn();
	render(CharmPicker, { props: { value: null, onchoose, ...props } });
	return { onchoose };
}

async function open(name = 'Charm wählen') {
	const button = screen.getByRole('button', { name });
	await fireEvent.click(button);
	await tick();
	await tick();
	return button;
}

const listbox = () => screen.getByRole('listbox', { hidden: true });
const options = () => within(listbox()).getAllByRole('option', { hidden: true });
const option = (key: string) =>
	listbox().querySelector<HTMLButtonElement>(`[data-charm-option="${key}"]`) as HTMLButtonElement;
const search = () => screen.getByRole('searchbox', { hidden: true }) as HTMLInputElement;

async function key(target: Element, name: string) {
	await fireEvent.keyDown(target, { key: name });
	await tick();
}

describe('button of the charm', () => {
	it('says "Charm wählen" without a charm and opens a dialog with the focus in the search', async () => {
		show();
		const button = await open();
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(button.textContent?.trim()).toBe('Charm wählen');
		expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-label')).toBe(
			'Charm wählen'
		);
		expect(document.activeElement).toBe(search());
		expect(search().getAttribute('aria-label')).toBe('Charm suchen');
	});

	it('names the current charm with its symbol, visibly and for screen readers', () => {
		show({ value: 'geburtstag' });
		const button = screen.getByRole('button', { name: 'Charm: Geburtstag' });
		expect(button.textContent?.trim()).toBe('Geburtstag');
		const svg = button.querySelector('svg');
		expect(svg?.getAttribute('aria-hidden')).toBe('true');
		expect(button.querySelector('[data-charm="geburtstag"]')).not.toBeNull();
	});

	it('shows the error of the server below the button and links it', () => {
		show({ error: 'Diesen Charm gibt es nicht.', errorId: 'charm-error' });
		const button = screen.getByRole('button', { name: 'Charm wählen' });
		expect(button.getAttribute('aria-describedby')).toBe('charm-error');
		expect(document.getElementById('charm-error')?.textContent).toContain(
			'Diesen Charm gibt es nicht.'
		);
	});
});

describe('dialog', () => {
	it('offers "Kein Charm" first, then every charm of the catalog in its group', async () => {
		show();
		await open();
		const all = options();
		expect(all).toHaveLength(CHARMS.length + 1);
		expect(all[0]?.textContent?.trim()).toBe('Kein Charm');
		expect(all[0]?.getAttribute('aria-selected')).toBe('true');
		const groups = within(listbox()).getAllByRole('group', { hidden: true });
		expect(
			groups.map(
				(group) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent
			)
		).toEqual(Object.values(CHARM_GROUP_LABELS));
		// Every option names its charm; the symbol is decoration.
		const birthday = option('geburtstag');
		expect(birthday.textContent?.trim()).toBe('Geburtstag');
		expect(birthday.getAttribute('title')).toBe('Geburtstag');
		expect(birthday.getAttribute('aria-selected')).toBe('false');
		expect(birthday.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('filters by name, search word and group with or without umlauts and says how many', async () => {
		show();
		await open();
		await fireEvent.input(search(), { target: { value: 'torte' } });
		await tick();
		expect(options().map((entry) => entry.getAttribute('data-charm-option'))).toEqual([
			'none',
			'geburtstag'
		]);
		expect(screen.getByRole('status', { hidden: true }).textContent).toBe('1 Charm gefunden.');
		expect(search().getAttribute('aria-describedby')).toBe(
			screen.getByRole('status', { hidden: true }).id
		);

		await fireEvent.input(search(), { target: { value: 'muell' } });
		await tick();
		expect(options().map((entry) => entry.getAttribute('data-charm-option'))).toContain('muell');

		await fireEvent.input(search(), { target: { value: 'Finanzen' } });
		await tick();
		expect(screen.getByRole('status', { hidden: true }).textContent).toBe('4 Charms gefunden.');

		await fireEvent.input(search(), { target: { value: 'einhorn' } });
		await tick();
		expect(options()).toHaveLength(1);
		expect(screen.getByRole('status', { hidden: true }).textContent).toBe(
			'Kein Charm passt zu „einhorn“.'
		);
	});

	it('chooses the first match with Enter in the search and gives the focus back to the button', async () => {
		const { onchoose } = show();
		const button = await open();
		await fireEvent.input(search(), { target: { value: 'flugzeug' } });
		await tick();
		await key(search(), 'Enter');
		expect(onchoose).toHaveBeenCalledWith('flugzeug');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
	});

	it('moves through the grid with the arrow keys and chooses with a click on the focused option', async () => {
		const { onchoose } = show();
		await open();
		await key(search(), 'ArrowDown');
		expect(document.activeElement).toBe(option('none'));
		await key(option('none'), 'ArrowDown');
		expect(document.activeElement).toBe(option('einkaufen'));
		await key(option('einkaufen'), 'ArrowRight');
		expect(document.activeElement).toBe(option('paket'));
		await key(option('paket'), 'ArrowDown');
		expect(document.activeElement).toBe(option('putzen'));
		await key(option('putzen'), 'ArrowLeft');
		expect(document.activeElement).toBe(option('muell'));
		await key(option('muell'), 'End');
		expect(document.activeElement).toBe(option(CHARMS.at(-1)?.key ?? ''));
		await key(document.activeElement as Element, 'Home');
		expect(document.activeElement).toBe(option('none'));
		// Up from the first row goes back to the search.
		await key(option('none'), 'ArrowUp');
		expect(document.activeElement).toBe(search());
		// One stop of Tab in the grid: the option with the focus.
		await key(search(), 'ArrowDown');
		await key(option('none'), 'ArrowRight');
		expect(listbox().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
		expect(option('einkaufen').tabIndex).toBe(0);
		// Enter and Space on a button click it.
		await fireEvent.click(option('einkaufen'));
		expect(onchoose).toHaveBeenCalledWith('einkaufen');
	});

	it('goes on in the search with a letter typed in the grid', async () => {
		show();
		await open();
		await key(search(), 'ArrowDown');
		await key(option('none'), 'z');
		expect(document.activeElement).toBe(search());
		expect(search().value).toBe('z');
	});

	it('starts at the current charm and removes it with "Kein Charm"', async () => {
		const { onchoose } = show({ value: 'zug' });
		await open('Charm: Zug');
		expect(option('zug').getAttribute('aria-selected')).toBe('true');
		expect(option('zug').tabIndex).toBe(0);
		await key(search(), 'ArrowDown');
		expect(document.activeElement).toBe(option('zug'));
		await fireEvent.click(option('none'));
		expect(onchoose).toHaveBeenCalledWith(null);
	});

	it('changes nothing when the same charm is chosen again or the dialog closes with Escape', async () => {
		const { onchoose } = show({ value: 'zug' });
		const button = await open('Charm: Zug');
		await fireEvent.click(option('zug'));
		expect(onchoose).not.toHaveBeenCalled();
		await open('Charm: Zug');
		await key(search(), 'Escape');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
		expect(onchoose).not.toHaveBeenCalled();
	});

	it('names the option under the pointer below the grid', async () => {
		show();
		await open();
		await fireEvent.pointerEnter(option('koffer'));
		expect(listbox().parentElement?.querySelector('.pointed')?.textContent).toBe('Koffer');
	});

	it('gives every option 44 px on touch screens and uses the search field of the app', () => {
		expect(pickerSource).toMatch(
			/@media \(pointer: coarse\)\s*\{[\s\S]*?\.option\s*\{[^}]*height:\s*var\(--control-height-touch\)/
		);
		expect(pickerSource).toContain('class="search-field"');
		expect(pickerSource).toContain('button-secondary button-small');
	});
});

describe('symbol before a title', () => {
	it('is decorative with a hidden name and a tooltip, in currentColor', () => {
		render(CharmIcon, { props: { charm: 'haustier' } });
		const mark = document.querySelector('[data-charm="haustier"]') as HTMLElement;
		expect(mark.getAttribute('title')).toBe('Charm: Haustier');
		expect(mark.textContent?.trim()).toBe('Charm: Haustier');
		const svg = mark.querySelector('svg');
		expect(svg?.getAttribute('aria-hidden')).toBe('true');
		expect(svg?.getAttribute('stroke')).toBe('currentColor');
		expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
		expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(svg?.querySelector('circle')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	it('leaves the name out where the place names it, and shows nothing without a known charm', () => {
		const { unmount } = render(CharmIcon, { props: { charm: 'zug', named: false } });
		expect(document.querySelector('[data-charm="zug"]')?.textContent?.trim()).toBe('');
		unmount();
		render(CharmIcon, { props: { charm: 'einhorn' } });
		expect(document.querySelector('.charm-mark')).toBeNull();
	});
});
