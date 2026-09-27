// Modal building block (ADR-0025 section 3; plan UI-Konsistenz, package UI-3): focus on opening
// and back, Escape on keydown (twice while busy), ×, footer, veil with and without unsaved
// input, selecting and releasing outside, the question "Änderungen verwerfen?", ARIA. jsdom has
// no showModal; the shared stubs stand in. Top layer, inert, scroll lock and animation are
// browser cases (BYL-E6-012).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ModalHarness from '$lib/test/ModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import source from './Modal.svelte?raw';

useOverlayStubs();

function dialog(name = 'Projekt bearbeiten') {
	return screen.getByRole<HTMLDialogElement>('dialog', { hidden: true, name });
}

/** Closed, the dialog has no content and so no name; this finds it anyway. */
function isOpen(): boolean | undefined {
	return document.querySelector('dialog')?.open;
}

function nameField() {
	return within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Name' });
}

async function openModal(props: Record<string, unknown> = {}) {
	const onreason = vi.fn();
	const view = render(ModalHarness, { props: { onreason, ...props } });
	const opener = screen.getByRole('button', { name: 'Öffnen' });
	opener.focus();
	await fireEvent.click(opener);
	await tick();
	await tick();
	return { onreason, opener, view };
}

async function clickVeil(press: Element = dialog(), release: Element = dialog()) {
	await fireEvent.pointerDown(press);
	await fireEvent.click(release);
}

describe('modal: opening', () => {
	it('opens as a named modal dialog with header, × and footer', async () => {
		await openModal();

		expect(dialog().open).toBe(true);
		expect(dialog().getAttribute('aria-labelledby')).toBe(
			screen.getByRole('heading', { level: 2, name: 'Projekt bearbeiten' }).id
		);
		expect(dialog().getAttribute('aria-busy')).toBe('false');
		expect(dialog().hasAttribute('data-overlay')).toBe(true);
		expect(within(dialog()).getByRole('button', { name: 'Schließen' })).toBeTruthy();
		expect(within(dialog()).getByRole('button', { name: 'Speichern' })).toBeTruthy();
	});

	it('puts the focus on the first control of the content, not on the ×', async () => {
		await openModal();

		expect(document.activeElement).toBe(nameField());
	});

	it('falls back to the × when there is nothing else to focus', async () => {
		await openModal({ withFooter: false });

		expect(document.activeElement).toBe(
			within(dialog('Hinweis')).getByRole('button', { name: 'Schließen' })
		);
	});

	it('renders the content only while open', () => {
		render(ModalHarness);

		const element = document.querySelector('dialog');
		expect(element?.open).toBe(false);
		expect(element?.childElementCount).toBe(0);
	});
});

describe('modal: closing without unsaved input', () => {
	it.each([
		['Escape', 'escape'],
		['×', 'close-button'],
		['Abbrechen', 'cancel'],
		['the veil', 'blanket']
	])('closes with %s and returns the focus to the opener', async (way, reason) => {
		const { onreason, opener } = await openModal();

		if (way === 'Escape') {
			const kept = await fireEvent.keyDown(nameField(), { key: 'Escape' });
			expect(kept).toBe(false);
		} else if (way === 'the veil') {
			await clickVeil();
		} else {
			const name = way === '×' ? 'Schließen' : way;
			await fireEvent.click(within(dialog()).getByRole('button', { name }));
		}
		await tick();

		expect(onreason).toHaveBeenCalledExactlyOnceWith(reason);
		expect(isOpen()).toBe(false);
		expect(document.activeElement).toBe(opener);
	});

	it('falls back to the heading of the view when the opener is gone (UI-6), never to the body', async () => {
		const { opener } = await openModal();
		opener.remove();
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Schließen' }));
		await tick();
		// Without a heading of the view the focus stays where the browser puts it.
		expect(document.activeElement).not.toBe(opener);

		document.body.innerHTML = '';
		const view = document.createElement('h2');
		view.tabIndex = -1;
		view.dataset.viewHeading = '';
		view.textContent = 'Aufgaben';
		document.body.append(view);
		const second = await openModal();
		second.opener.remove();
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Schließen' }));
		await tick();
		expect(document.activeElement).toBe(view);
	});

	it('keeps Escape to itself, so a panel behind does not close as well', async () => {
		await openModal();
		const outer = vi.fn();
		document.addEventListener('keydown', outer);

		await fireEvent.keyDown(nameField(), { key: 'Escape' });

		document.removeEventListener('keydown', outer);
		expect(outer).not.toHaveBeenCalled();
	});

	it('leaves an Escape an inner element consumed to it', async () => {
		const { onreason } = await openModal();
		nameField().addEventListener('keydown', (event) => event.preventDefault());

		await fireEvent.keyDown(nameField(), { key: 'Escape' });

		expect(onreason).not.toHaveBeenCalled();
		expect(dialog().open).toBe(true);
	});

	it('does not close when a selection starts inside and ends on the veil', async () => {
		const { onreason } = await openModal();

		await clickVeil(nameField(), dialog());
		await clickVeil(dialog(), nameField());

		expect(onreason).not.toHaveBeenCalled();
		expect(dialog().open).toBe(true);
	});

	it('follows a close request of the browser (cancel event) under the same rules', async () => {
		const { onreason } = await openModal();

		const event = new Event('cancel', { cancelable: true });
		dialog().dispatchEvent(event);
		await tick();

		expect(event.defaultPrevented).toBe(true);
		expect(onreason).toHaveBeenCalledExactlyOnceWith('escape');
	});
});

describe('modal: busy', () => {
	it('ignores Escape twice, ×, Abbrechen and the veil and sets aria-busy', async () => {
		const { onreason, view } = await openModal();
		await view.rerender({ busy: true });

		await fireEvent.keyDown(nameField(), { key: 'Escape' });
		await fireEvent.keyDown(nameField(), { key: 'Escape' });
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Schließen' }));
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
		await clickVeil();

		expect(onreason).not.toHaveBeenCalled();
		expect(dialog().open).toBe(true);
		expect(dialog().getAttribute('aria-busy')).toBe('true');
		expect(
			within(dialog()).getByRole('button', { name: 'Schließen' }).getAttribute('aria-disabled')
		).toBe('true');
	});

	it('shows itself again when the browser closes it anyway', async () => {
		const { onreason, view } = await openModal();
		await view.rerender({ busy: true });

		dialog().close();
		await tick();

		expect(dialog().open).toBe(true);
		expect(onreason).not.toHaveBeenCalled();
	});
});

describe('modal: unsaved input', () => {
	function question() {
		return within(dialog()).getByRole('group', {
			name: 'Änderungen verwerfen? Der nicht gespeicherte Text geht verloren.'
		});
	}

	it('asks in place of the footer on Escape, × and Abbrechen, focus on "Weiter bearbeiten"', async () => {
		const { onreason } = await openModal({ dirty: true });

		for (const act of [
			() => fireEvent.keyDown(nameField(), { key: 'Escape' }),
			() => fireEvent.click(within(dialog()).getByRole('button', { name: 'Schließen' })),
			() => fireEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }))
		]) {
			nameField().focus();
			await act();
			await tick();

			expect(question()).toBeTruthy();
			expect(within(dialog()).queryByRole('button', { name: 'Speichern' })).toBeNull();
			expect(document.activeElement).toBe(
				within(dialog()).getByRole('button', { name: 'Weiter bearbeiten' })
			);

			await fireEvent.click(within(dialog()).getByRole('button', { name: 'Weiter bearbeiten' }));
			await tick();
			expect(document.activeElement).toBe(nameField());
		}
		expect(onreason).not.toHaveBeenCalled();
	});

	it('reads Escape during the question as "Weiter bearbeiten"', async () => {
		const { onreason } = await openModal({ dirty: true });
		await fireEvent.keyDown(nameField(), { key: 'Escape' });
		await tick();

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		await tick();

		expect(within(dialog()).queryByRole('group', { name: /Änderungen verwerfen/ })).toBeNull();
		expect(dialog().open).toBe(true);
		expect(onreason).not.toHaveBeenCalled();
	});

	it('closes after "Verwerfen" with the way the user chose', async () => {
		const { onreason } = await openModal({ dirty: true });
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Schließen' }));
		await tick();

		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Verwerfen' }));
		await tick();

		expect(onreason).toHaveBeenCalledExactlyOnceWith('close-button');
		expect(isOpen()).toBe(false);
	});

	it('ignores a click on the veil', async () => {
		const { onreason } = await openModal({ dirty: true });

		await clickVeil();

		expect(onreason).not.toHaveBeenCalled();
		expect(within(dialog()).queryByRole('group', { name: /Änderungen verwerfen/ })).toBeNull();
	});
});

describe('modal source', () => {
	it('uses the size, blanket, radius and motion tokens (ADR-0025 section 2)', () => {
		for (const token of [
			'--overlay-width-s',
			'--overlay-width-m',
			'--overlay-width-l',
			'--overlay-width-xl',
			'--overlay-max-height',
			'--color-blanket',
			'--radius-overlay',
			'--motion-medium'
		]) {
			expect(source, token).toContain(`var(${token})`);
		}
		expect(source).not.toMatch(/gradient|danger/);
	});

	it('is thick glass from S to L and an opaque full view (ADR-0029 section 1)', () => {
		const rule = (selector: string) =>
			new RegExp(`${selector.replace(/[.()]/g, '\\$&')} \\{([^}]*)\\}`).exec(source)?.[1] ?? '';
		const base = rule('.modal');
		expect(base).toMatch(/background:\s*var\(--color-surface\)/);
		expect(base).toMatch(/box-shadow:\s*var\(--shadow-modal\)/);
		expect(base).not.toMatch(/backdrop-filter/);
		const glass = rule('.modal:not(.size-xl)');
		expect(glass).toMatch(/background:\s*var\(--material-thick\)/);
		expect(glass).toMatch(/backdrop-filter:\s*var\(--glass-filter-thick\)/);
		expect(glass).toMatch(/border-color:\s*var\(--color-separator\)/);
		expect(glass).toMatch(/inset 0 1px 0 var\(--glass-edge\),\s*var\(--shadow-modal\)/);
		// The blanket stays a plain veil without blur (ADR-0029 section 8).
		expect(rule('.modal::backdrop')).not.toMatch(/filter/);
	});
});
