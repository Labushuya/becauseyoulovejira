// Modal of a second tab of the same browser (ADR-0035 section 6; plan start-fenster, SF-3): first
// focus on "Hier weiterarbeiten", countdown of 5 s, then window.close(); Escape and "Hier
// weiterarbeiten" keep the tab, "Tab schließen" closes at once, and a refused close says what to
// do. jsdom has no showModal; the shared overlay stubs stand in.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import DuplicateTabNotice from './DuplicateTabNotice.svelte';

useOverlayStubs();

async function show(closes = false) {
	const onkeep = vi.fn();
	let closed = false;
	const closeTab = vi.fn(() => {
		closed = closes;
	});
	render(DuplicateTabNotice, { props: { onkeep, closeTab, isClosed: () => closed } });
	await tick();
	await tick();
	return { onkeep, closeTab };
}

const dialog = () => screen.getByRole('dialog', { hidden: true, name: 'Die App ist schon offen' });

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('DuplicateTabNotice', () => {
	it('is a named modal with the reason and the focus on "Hier weiterarbeiten"', async () => {
		await show();
		expect(dialog()).toBeTruthy();
		expect(dialog().textContent).toContain(
			'becauseyoulovejira ist in einem anderen Tab dieses Browsers geöffnet. Dort erscheint ein Hinweis.'
		);
		expect(dialog().textContent).toContain('Dieser Tab schließt sich in 5 s.');
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Hier weiterarbeiten' })
		);
		expect(dialog().getAttribute('aria-describedby')).toBeTruthy();
	});

	it('counts down and closes the tab after 5 s', async () => {
		const { closeTab, onkeep } = await show(true);
		await vi.advanceTimersByTimeAsync(4000);
		expect(dialog().textContent).toContain('Dieser Tab schließt sich in 1 s.');
		expect(closeTab).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(closeTab).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(300);
		expect(dialog().textContent).not.toContain('Du kannst diesen Tab jetzt schließen.');
		expect(onkeep).not.toHaveBeenCalled();
	});

	it('says what to do when the browser refuses to close the tab', async () => {
		const { closeTab } = await show(false);
		await vi.advanceTimersByTimeAsync(5300);
		expect(closeTab).toHaveBeenCalledOnce();
		expect(dialog().textContent).toContain('Du kannst diesen Tab jetzt schließen.');
		expect(dialog().textContent).not.toContain('schließt sich in');
	});

	it('"Tab schließen" closes at once', async () => {
		const { closeTab } = await show(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Tab schließen' }));
		expect(closeTab).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(closeTab).toHaveBeenCalledOnce();
	});

	it('"Hier weiterarbeiten" keeps the tab and stops the countdown', async () => {
		const { closeTab, onkeep } = await show();
		await fireEvent.click(screen.getByRole('button', { name: 'Hier weiterarbeiten' }));
		expect(onkeep).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(closeTab).not.toHaveBeenCalled();
	});

	it('Escape keeps the tab as well', async () => {
		const { closeTab, onkeep } = await show();
		await fireEvent.keyDown(dialog(), { key: 'Escape' });
		expect(onkeep).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(closeTab).not.toHaveBeenCalled();
	});
});
