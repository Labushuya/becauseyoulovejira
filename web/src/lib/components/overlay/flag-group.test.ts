// Flags bottom left (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): the named section with
// both live regions from the start, icon and text, the action, the ×, the focus that never moves,
// and the pauses for pointer, focus, a hidden tab and an open modal dialog. Layout, animation and
// the screen reader itself are browser cases (BYL-E6-018).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLAG_DURATION_MS, FlagStore } from '$lib/stores/flags.svelte';
import FlagGroup from './FlagGroup.svelte';
import source from './FlagGroup.svelte?raw';

afterEach(() => {
	vi.useRealTimers();
});

function show() {
	const store = new FlagStore();
	render(FlagGroup, { props: { store } });
	const section = screen.getByRole('region', { name: 'Benachrichtigungen' });
	return { store, section };
}

describe('flag group', () => {
	it('is a named section with both live regions before the first flag', () => {
		const { section } = show();
		expect(within(section).getByRole('status')).toBeTruthy();
		expect(within(section).getByRole('alert')).toBeTruthy();
		expect(within(section).queryByRole('listitem')).toBeNull();
	});

	it('shows a flag with icon and title, announces it and keeps the focus', async () => {
		const { store, section } = show();
		const outside = document.createElement('button');
		document.body.append(outside);
		outside.focus();

		store.show({ tone: 'success', title: 'Projekt „Haus“ angelegt.', description: 'Code HAUS.' });
		await tick();
		const flag = within(section).getByRole('listitem');
		expect(flag.textContent).toContain('Projekt „Haus“ angelegt.');
		expect(flag.textContent).toContain('Code HAUS.');
		expect(flag.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(within(section).getByRole('status').textContent).toContain(
			'Projekt „Haus“ angelegt. Code HAUS.'
		);
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});

	it('puts errors into the assertive region, with icon and a hidden "Fehler:"', async () => {
		const { store, section } = show();
		store.show({ tone: 'error', title: 'TASK-3 konnte nicht geändert werden.' });
		await tick();
		expect(within(section).getByRole('alert').textContent).toContain(
			'TASK-3 konnte nicht geändert werden.'
		);
		const flag = within(section).getByRole('listitem');
		expect(flag.classList.contains('tone-error')).toBe(true);
		expect(flag.textContent).toMatch(/Fehler: TASK-3 konnte nicht geändert werden\./);
	});

	it('runs the one action and closes; × closes without it', async () => {
		const { store, section } = show();
		const run = vi.fn();
		store.show({ tone: 'success', title: 'Erster.' });
		store.show({
			tone: 'success',
			title: 'TASK-3 erledigt.',
			action: { label: 'Rückgängig', run }
		});
		await tick();
		const [newest] = within(section).getAllByRole('listitem');
		expect(newest?.textContent).toContain('TASK-3 erledigt.');
		const undo = within(newest as HTMLElement).getByRole('button', { name: 'Rückgängig' });
		expect(
			document.getElementById(undo.getAttribute('aria-describedby') ?? '')?.textContent
		).toMatch(/TASK-3 erledigt\./);
		await fireEvent.click(undo);
		expect(run).toHaveBeenCalledOnce();
		expect(within(section).getAllByRole('listitem')).toHaveLength(1);

		await fireEvent.click(
			within(section).getByRole('button', { name: 'Benachrichtigung schließen' })
		);
		expect(within(section).queryByRole('listitem')).toBeNull();
	});

	it('leaves after 8 s, but not while the pointer or the focus is on it', async () => {
		vi.useFakeTimers();
		const { store, section } = show();
		store.show({ tone: 'success', title: 'Gespeichert.' });
		await tick();

		await fireEvent.pointerEnter(section);
		vi.advanceTimersByTime(FLAG_DURATION_MS * 2);
		await tick();
		expect(within(section).queryByRole('listitem')).not.toBeNull();
		await fireEvent.pointerLeave(section);

		within(section).getByRole('button', { name: 'Benachrichtigung schließen' }).focus();
		vi.advanceTimersByTime(FLAG_DURATION_MS * 2);
		await tick();
		expect(within(section).queryByRole('listitem')).not.toBeNull();
		(document.activeElement as HTMLElement).blur();
		expect(store.paused).toBe(false);

		vi.advanceTimersByTime(FLAG_DURATION_MS);
		await tick();
		expect(within(section).queryByRole('listitem')).toBeNull();
	});

	it('pauses while the tab is hidden', async () => {
		const { store } = show();
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(store.paused).toBe(true);
		hidden.mockReturnValue(false);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(store.paused).toBe(false);
		hidden.mockRestore();
	});

	it('pauses while a modal dialog is open', async () => {
		const { store } = show();
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		dialog.setAttribute('open', '');
		await vi.waitFor(() => expect(store.paused).toBe(true));
		dialog.removeAttribute('open');
		await vi.waitFor(() => expect(store.paused).toBe(false));
		dialog.setAttribute('open', '');
		await vi.waitFor(() => expect(store.paused).toBe(true));
		dialog.remove();
		await vi.waitFor(() => expect(store.paused).toBe(false));
	});

	it('is thick glass with the neutral shadow, no red besides errors and a named × (ADR-0029)', () => {
		const flag = /\.flag \{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(flag).toMatch(/background:\s*var\(--material-thick\)/);
		expect(flag).toMatch(/backdrop-filter:\s*var\(--glass-filter-thick\)/);
		expect(flag).toMatch(/border:\s*1px solid var\(--color-separator\)/);
		expect(flag).toMatch(/border-left:\s*3px solid var\(--color-brand\)/);
		expect(flag).toMatch(/inset 0 1px 0 var\(--glass-edge\),\s*var\(--shadow-popover\)/);
		expect(source).not.toMatch(/gradient/);
		expect(source.match(/--color-danger/g)).toHaveLength(2);
		expect(source).toMatch(/aria-label="Benachrichtigung schließen"/);
		expect(source).toMatch(/data-overlay/);
	});
});
