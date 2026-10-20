// Flags bottom left (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): the named section with
// both live regions from the start, icon and text, the action, the ×, the focus that never moves,
// and the pauses for pointer, focus and a hidden tab. Since FL-1 (addendum 18) an open modal stops
// nothing: the flags move into the topmost open modal and back, with one pair of live regions.
// Layout, animation and the screen reader itself are browser cases (BYL-E6-018, BYL-E6-1668 to
// BYL-E6-1671).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLAG_DURATION_MS, FlagStore } from '$lib/stores/flags.svelte';
import FlagModalHarness from '$lib/test/FlagModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FlagGroup from './FlagGroup.svelte';
import source from './FlagGroup.svelte?raw';

useOverlayStubs();

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

	it('runs on while a modal dialog is open (FL-1, decision D2)', async () => {
		vi.useFakeTimers();
		const { store, section } = show();
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		dialog.setAttribute('open', '');
		store.show({ tone: 'success', title: 'Gespeichert.' });
		await tick();
		expect(store.paused).toBe(false);
		vi.advanceTimersByTime(FLAG_DURATION_MS);
		await tick();
		expect(within(section).queryByRole('listitem')).toBeNull();
		dialog.remove();
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

// FL-1 (ADR-0025 addendum 18): while a modal is open, the flags render in the topmost one, as a
// direct child of its <dialog> outside of its frame, visible and clickable, and come back to the
// layout when it closes. FlagModalHarness stands in for the app layout with two modals.
describe('flags in front of modals (FL-1)', () => {
	const FULL_VIEW = 'TASK-1 · Fenster putzen';

	function showWithModals() {
		const store = new FlagStore();
		render(FlagModalHarness, { props: { store } });
		return store;
	}

	/** Every output of the flags in the document; exactly one is expected each time. */
	function onlyOutput(): HTMLElement {
		const outputs = screen.queryAllByRole('region', { name: 'Benachrichtigungen' });
		expect(outputs).toHaveLength(1);
		expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
		expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
		return outputs[0] as HTMLElement;
	}

	function dialogNamed(name: string): HTMLDialogElement {
		return screen.getByRole<HTMLDialogElement>('dialog', { hidden: true, name });
	}

	async function openFullView(): Promise<HTMLDialogElement> {
		await fireEvent.click(screen.getByRole('button', { name: 'Vollansicht öffnen' }));
		await tick();
		const dialog = dialogNamed(FULL_VIEW);
		expect(dialog.open).toBe(true);
		return dialog;
	}

	it('shows a flag in the open modal, outside its frame, with a clickable action and one pair of live regions', async () => {
		const store = showWithModals();
		const dialog = await openFullView();
		const run = vi.fn();
		store.show({
			tone: 'info',
			title: 'Nur dieses Ticket geändert.',
			action: { label: 'Auch für künftige Tickets übernehmen', run }
		});
		await tick();

		const output = onlyOutput();
		expect(output.parentElement).toBe(dialog);
		const frame = dialog.querySelector('.frame') as HTMLElement;
		expect(frame.contains(output)).toBe(false);
		// After the content of the modal: the keyboard reaches the flags after it.
		expect(frame.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(output.closest('[inert]')).toBeNull();
		expect(within(output).getByRole('listitem').textContent).toContain(
			'Nur dieses Ticket geändert.'
		);
		expect(within(output).getByRole('status').textContent).toContain('Nur dieses Ticket geändert.');

		await fireEvent.click(
			within(output).getByRole('button', { name: 'Auch für künftige Tickets übernehmen' })
		);
		expect(run).toHaveBeenCalledOnce();
		expect(within(output).queryByRole('listitem')).toBeNull();
		// A click on a flag is no click on the veil: the modal stays.
		expect(dialog.open).toBe(true);
	});

	it('moves flags into the modal and back without duplicates, a new entrance, a new clock or a second announcement', async () => {
		vi.useFakeTimers();
		const store = showWithModals();
		store.show({
			tone: 'success',
			title: 'TASK-2 erledigt.',
			action: { label: 'Rückgängig', run: vi.fn() }
		});
		await tick();
		const layout = onlyOutput();
		expect(within(layout).getByRole('listitem').classList.contains('arrived')).toBe(true);
		expect(within(layout).getByRole('status').textContent).toContain('TASK-2 erledigt.');
		vi.advanceTimersByTime(3000);

		const dialog = await openFullView();
		const inModal = onlyOutput();
		expect(inModal.parentElement).toBe(dialog);
		const moved = within(inModal).getByRole('listitem');
		expect(moved.textContent).toContain('TASK-2 erledigt.');
		expect(moved.classList.contains('arrived')).toBe(false);
		// The layout announced it already; the modal does not say it again.
		expect(within(inModal).getByRole('status').textContent).toBe('');
		vi.advanceTimersByTime(3000);
		await tick();
		expect(within(inModal).queryByRole('listitem')).not.toBeNull();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		await tick();
		const back = onlyOutput();
		expect(back.closest('dialog')).toBeNull();
		expect(within(back).getAllByRole('listitem')).toHaveLength(1);
		expect(within(back).getByRole('status').textContent).toBe('');

		// 8 s in all since the flag appeared: the time ran on in the modal and was not restarted.
		vi.advanceTimersByTime(FLAG_DURATION_MS - 6000 - 1);
		await tick();
		expect(within(back).queryByRole('listitem')).not.toBeNull();
		vi.advanceTimersByTime(1);
		await tick();
		expect(within(back).queryByRole('listitem')).toBeNull();
	});

	it('hands a message to the layout that the closing modal had no time to announce', async () => {
		const store = showWithModals();
		const dialog = await openFullView();
		// The result and the closing in one step, as a form in a modal does.
		store.show({ tone: 'success', title: 'Vorlage gespeichert.' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		await tick();
		const output = onlyOutput();
		expect(output.closest('dialog')).toBeNull();
		expect(within(output).getByRole('status').textContent).toContain('Vorlage gespeichert.');
	});

	it('runs in the modal as everywhere: 8 s, held by pointer, focus and a hidden tab (decision D2)', async () => {
		vi.useFakeTimers();
		const store = showWithModals();
		await openFullView();
		store.show({
			tone: 'success',
			title: 'Angepinnter Kommentar ersetzt.',
			action: { label: 'Rückgängig', run: vi.fn() }
		});
		await tick();
		const output = onlyOutput();
		expect(store.paused).toBe(false);

		await fireEvent.pointerEnter(output);
		vi.advanceTimersByTime(FLAG_DURATION_MS * 2);
		await tick();
		expect(within(output).queryByRole('listitem')).not.toBeNull();
		await fireEvent.pointerLeave(output);

		within(output).getByRole('button', { name: 'Rückgängig' }).focus();
		vi.advanceTimersByTime(FLAG_DURATION_MS * 2);
		await tick();
		expect(within(output).queryByRole('listitem')).not.toBeNull();
		(document.activeElement as HTMLElement).blur();

		// The group of the layout watches the tab while the flags are in the modal.
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		vi.advanceTimersByTime(FLAG_DURATION_MS * 2);
		await tick();
		expect(within(output).queryByRole('listitem')).not.toBeNull();
		hidden.mockReturnValue(false);
		document.dispatchEvent(new Event('visibilitychange'));
		hidden.mockRestore();
		expect(store.paused).toBe(false);

		vi.advanceTimersByTime(FLAG_DURATION_MS);
		await tick();
		expect(within(output).queryByRole('listitem')).toBeNull();
	});

	it('stays with the topmost of two open modals and goes back down as they close', async () => {
		const store = showWithModals();
		store.show({
			tone: 'info',
			title: 'HAUS-3 ist dir zugewiesen.',
			action: { label: 'Öffnen', run: vi.fn() }
		});
		const full = await openFullView();
		await fireEvent.click(screen.getByRole('button', { name: 'Zweiten Dialog öffnen' }));
		await tick();
		const second = dialogNamed('Zweiter Dialog');
		expect(second.open).toBe(true);

		let output = onlyOutput();
		expect(output.parentElement).toBe(second);
		expect(full.contains(output)).toBe(false);
		expect(within(output).getByRole('listitem').textContent).toContain('HAUS-3');

		await fireEvent.click(within(second).getByRole('button', { name: 'Schließen' }));
		await tick();
		output = onlyOutput();
		expect(output.parentElement).toBe(full);

		await fireEvent.click(within(full).getByRole('button', { name: 'Schließen' }));
		await tick();
		output = onlyOutput();
		expect(output.closest('dialog')).toBeNull();
		expect(within(output).getAllByRole('listitem')).toHaveLength(1);
	});
});

// MO-1b (ADR-0073 addendum): in the phone frame the flags stand above the bottom bar, and at the top
// of the screen while a sheet or a page is open, so they cover neither its footer nor its buttons.
// Where they stand is a rule of the CSS behind the breakpoint and the switch (the place itself is
// measured by the smoke test, tests/mobile/phone-frame.spec.mjs); here the mark of the output in a
// modal and the rules.
describe('flags in the phone frame (MO-1b)', () => {
	it('marks the output in a modal, not the one of the layout', async () => {
		const store = new FlagStore();
		render(FlagModalHarness, { props: { store } });
		store.show({ tone: 'info', title: 'Link kopiert' });
		await tick();
		expect(screen.getByRole('region', { name: 'Benachrichtigungen' }).classList).not.toContain(
			'in-modal'
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Zweiten Dialog öffnen' }));
		await tick();
		const output = screen.getByRole('region', { name: 'Benachrichtigungen' });
		expect(output.closest('dialog')).not.toBeNull();
		expect(output.classList).toContain('in-modal');
	});

	it('moves them to the top below the status bar only in the frame, in a modal and beside a sheet', () => {
		const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
		const phone = /@media \(max-width: 39\.99rem\) \{([\s\S]*?)\n\t\}\n/.exec(style)?.[1] ?? '';
		expect(phone).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.flags \{\s*bottom: calc\(1rem \+ var\(--bottom-bar-height\) \+ var\(--safe-bottom\)\);/
		);
		const top = /([^{}]+)\{\s*top: calc\(0\.5rem \+ var\(--safe-top\)\);\s*bottom: auto;\s*\}/.exec(
			phone
		);
		expect(top?.[1]).toMatch(/:global\(:root\[data-mobile-layout='on'\]\) \.flags\.in-modal/);
		expect(top?.[1]).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]:has\(\[data-sheet\]:popover-open\)\) \.flags/
		);
		// Outside the block they stay bottom left, as on the PC.
		expect(/\.flags \{([^}]*)\}/.exec(style)?.[1]).toMatch(/bottom:\s*1rem;[\s\S]*left:\s*1rem/);
	});
});
