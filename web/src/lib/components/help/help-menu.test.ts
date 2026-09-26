// Help menu, modal "Tastaturkürzel" and the list of shortcuts (plan EH-9): the menu "?" names its
// three entries (no dead one), "Tastaturkürzel" asks for the modal and returns the focus first, the
// links lead to the help and the channels; the modal shows "Überall" and "Liste" from the one source
// and leads to the whole help; the list renders keys as <kbd> in a description list.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { SHORTCUTS, keysText, shortcutsOf } from '$lib/domain/shortcuts';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import HelpMenu from './HelpMenu.svelte';
import ShortcutList from './ShortcutList.svelte';
import ShortcutsModal from './ShortcutsModal.svelte';

useOverlayStubs();

async function openMenu() {
	const onshortcuts = vi.fn();
	render(HelpMenu, { props: { onshortcuts } });
	const button = screen.getByRole('button', { name: 'Hilfe' });
	await fireEvent.click(button);
	await tick();
	return { onshortcuts, button };
}

/** Keys of every description row, without whitespace (the markup spreads them over lines). */
function rowTexts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('dt')].map((term) =>
		(term.textContent ?? '').replace(/\s+/g, '')
	);
}

describe('help menu (EH-9)', () => {
	it('is a menu "Hilfe" with three entries', async () => {
		const { button } = await openMenu();

		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		expect(button.getAttribute('title')).toBeNull();
		expect(screen.getByRole('menu', { hidden: true }).getAttribute('aria-label')).toBe('Hilfe');
		const items = screen.getAllByRole('menuitem', { hidden: true });
		expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Tastaturkürzel ?',
			'Hilfe öffnen',
			'Kanäle einrichten'
		]);
		expect(document.activeElement).toBe(items[0]);
	});

	it('names the key of "Tastaturkürzel" and asks for the modal after closing the menu', async () => {
		const { onshortcuts, button } = await openMenu();
		const item = screen.getByRole('menuitem', { hidden: true, name: /Tastaturkürzel/ });
		expect(item.getAttribute('aria-keyshortcuts')).toBe('?');
		expect(item.getAttribute('aria-haspopup')).toBe('dialog');

		await fireEvent.click(item);

		expect(onshortcuts).toHaveBeenCalledOnce();
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
	});

	it('links the help and the channels', async () => {
		const { button } = await openMenu();
		const help = screen.getByRole('menuitem', { hidden: true, name: 'Hilfe öffnen' });
		expect(help.getAttribute('href')).toBe('/einstellungen/hilfe');
		expect(
			screen.getByRole('menuitem', { hidden: true, name: 'Kanäle einrichten' }).getAttribute('href')
		).toBe('/einstellungen/kanaele');

		help.addEventListener('click', (event) => event.preventDefault());
		await fireEvent.click(help);
		expect(button.getAttribute('aria-expanded')).toBe('false');
	});
});

describe('help menu with the tour (EH-13)', () => {
	it('offers "Kurze Einführung" only with a tour and starts it after closing the menu', async () => {
		const onshortcuts = vi.fn();
		const ontour = vi.fn();
		render(HelpMenu, { props: { onshortcuts, ontour } });
		const button = screen.getByRole('button', { name: 'Hilfe' });
		await fireEvent.click(button);
		await tick();

		const items = screen.getAllByRole('menuitem', { hidden: true });
		expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Tastaturkürzel ?',
			'Hilfe öffnen',
			'Kanäle einrichten',
			'Kurze Einführung'
		]);
		await fireEvent.click(screen.getByRole('menuitem', { hidden: true, name: 'Kurze Einführung' }));
		expect(ontour).toHaveBeenCalledOnce();
		expect(button.getAttribute('aria-expanded')).toBe('false');
		// The tour returns the focus to the element that had it: the button.
		expect(document.activeElement).toBe(button);
	});
});

describe('modal "Tastaturkürzel" (EH-9)', () => {
	it('shows the keys "Überall" and "Liste" and leads to the whole help', async () => {
		const onclose = vi.fn();
		render(ShortcutsModal, { props: { onclose } });
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'Tastaturkürzel' });
		const headings = within(dialog)
			.getAllByRole('heading', { level: 3 })
			.map((heading) => heading.textContent?.trim());
		expect(headings).toEqual(['Überall', 'Liste']);
		expect(rowTexts(dialog)).toContain('coderStrg+K');
		expect(rowTexts(dialog)).toContain('?');
		expect(dialog.querySelectorAll('dt')).toHaveLength(
			shortcutsOf('everywhere').length + shortcutsOf('list').length
		);

		const whole = within(dialog).getByRole('link', { name: 'Ganze Hilfe' });
		expect(whole.getAttribute('href')).toBe('/einstellungen/hilfe#tastaturkuerzel');
		whole.addEventListener('click', (event) => event.preventDefault());
		await fireEvent.click(whole);
		expect(onclose).toHaveBeenCalledOnce();

		// × in the header and "Schließen" in the footer; the footer comes last.
		const closers = within(dialog).getAllByRole('button', { name: 'Schließen' });
		expect(closers).toHaveLength(2);
		await fireEvent.click(closers[1] as HTMLElement);
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});

describe('shortcut list (EH-9)', () => {
	it('lists every shortcut in its context with the keys as kbd', () => {
		const { container } = render(ShortcutList);

		const headings = screen
			.getAllByRole('heading', { level: 3 })
			.map((heading) => heading.textContent?.trim());
		expect(headings).toEqual(['Überall', 'Liste', 'Panel', 'Dialoge']);
		expect(container.querySelectorAll('table')).toHaveLength(0);
		expect(container.querySelectorAll('dl')).toHaveLength(4);
		expect(container.querySelectorAll('dd')).toHaveLength(SHORTCUTS.length);
		const quick = SHORTCUTS[0];
		expect(quick && keysText(quick)).toBe('c oder Strg+K');
		expect(
			[...container.querySelectorAll('dt')][0]?.querySelectorAll('kbd').length
		).toBeGreaterThanOrEqual(3);
		for (const region of screen.getAllByRole('region')) {
			expect(region.getAttribute('aria-labelledby')).toBeTruthy();
		}
	});

	it('uses the given heading level', () => {
		render(ShortcutList, { props: { contexts: ['panel'], headingLevel: 4 } });
		expect(screen.getByRole('heading', { level: 4 }).textContent?.trim()).toBe('Panel');
	});
});
