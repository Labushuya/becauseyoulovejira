// The quick entry as the sheet of "＋" in the phone frame (MO-5, ADR-0073 addendum MO-5) in jsdom
// with a controlled matchMedia: the line has the focus, capitalises sentences and says "done" on
// the Enter key; the footer holds only "In den Eingang" and "Ticket anlegen" side by side (the ×
// closes); the help names no keys and is folded; the result stands right below the line, which
// stays ready (and keeps the focus) for the next one; typed text counts as unsaved. "Erste Schritte"
// offers the quick entry without its key. The counter-checks: on a PC with the switch on and on a
// phone with the switch off the dialog stays as before. Places, sizes and the keyboard are checked
// statically here and in a browser by tests/mobile/phone-frame.spec.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { QuickEntry } from '$lib/domain/quick-syntax';
import type { CaptureTarget } from '$lib/domain/templates';
import type { ProjectRef } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { QUICK_CAPTURE_CONTEXT } from '$lib/quick-capture-context';
import type { CaptureSaveResult } from '$lib/stores/capture';
import { FirstStepsStore, localStore } from '$lib/stores/first-steps.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { hasUnsavedInput } from '$lib/unsaved-input';
import FirstSteps from './FirstSteps.svelte';
import QuickCapture from './QuickCapture.svelte';

useOverlayStubs();

const LIB = join(import.meta.dirname, '..');
const HOUSE: ProjectRef = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false
};

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
});

/** The quick entry with a fake save: a ticket gets HAUS-2, the inbox an entry. */
async function renderQuick() {
	const onsave = vi.fn(
		async (_entry: QuickEntry, target: CaptureTarget): Promise<CaptureSaveResult> =>
			target === 'ticket'
				? { ok: true, target, id: 'tick00000000001', message: 'Ticket HAUS-2 angelegt.' }
				: { ok: true, target, id: 'item00000000001', message: '„Idee“ liegt im Eingang.' }
	);
	const onclose = vi.fn();
	const resultHref = (target: CaptureTarget, id: string) =>
		`/${target === 'ticket' ? 'tagesplan/tickets' : 'eingang'}/${id}` as ResolvedPathname;
	render(QuickCapture, { props: { projects: [HOUSE], tags: [], onsave, onclose, resultHref } });
	await tick();
	const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Schnellerfassung' });
	const input = screen.getByLabelText<HTMLInputElement>('Titel mit Kurzsyntax');
	return { onsave, onclose, dialog, input };
}

/** The names of the buttons in the footer of the dialog. */
function footerButtons(dialog: HTMLElement): string[] {
	const foot = dialog.querySelector<HTMLElement>('.foot');
	expect(foot).not.toBeNull();
	return within(foot as HTMLElement)
		.getAllByRole('button')
		.map((button) => button.textContent?.trim() ?? '');
}

/** A press of the pointer on the element; whether something kept the focus where it was. */
function pressKeepsFocus(element: HTMLElement): boolean {
	const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
	element.dispatchEvent(event);
	return event.defaultPrevented;
}

/** Whether `first` comes before `second` in the document. */
function before(first: Node, second: Node): boolean {
	return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('the quick entry as the sheet of "＋" in the phone frame (MO-5)', () => {
	it('opens as a sheet with the focus in the line, capitalising sentences and "done" on the Enter key', async () => {
		useWindow(true, true);
		const { dialog, input } = await renderQuick();
		expect(dialog.classList.contains('sheet')).toBe(true);
		expect(document.activeElement).toBe(input);
		expect(input.getAttribute('autocapitalize')).toBe('sentences');
		expect(input.getAttribute('enterkeyhint')).toBe('done');
	});

	it('offers "In den Eingang" and "Ticket anlegen" side by side, without "Abbrechen"; the × closes', async () => {
		useWindow(true, true);
		const { dialog, onclose } = await renderQuick();
		expect(footerButtons(dialog)).toEqual(['In den Eingang', 'Ticket anlegen']);
		expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		const create = screen.getByRole('button', { name: 'Ticket anlegen' });
		expect(create.classList.contains('button-primary')).toBe(true);
		expect(create.classList.contains('capture-save')).toBe(true);
		expect(
			screen.getByRole('button', { name: 'In den Eingang' }).classList.contains('capture-save')
		).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('names no keys and folds the help on the short syntax', async () => {
		useWindow(true, true);
		const { dialog, input } = await renderQuick();
		expect(dialog.textContent).not.toMatch(/Alt\+Enter|Enter legt/);
		const help = dialog.querySelector('details');
		expect(help).not.toBeNull();
		expect(help?.open).toBe(false);
		expect(help?.querySelector('summary')?.textContent?.trim()).toBe('Hilfe zur Kurzsyntax');
		expect(help?.textContent).toMatch(/Beispiel: „Zahnarzt anrufen @HAUS !hoch #anruf“/);
		const link = within(help as HTMLElement).getByRole('link', { name: /^Mehr zur Kurzsyntax/ });
		expect(link.getAttribute('href')).toBe('/einstellungen/hilfe#kurzsyntax');
		expect(link.getAttribute('target')).toBe('_blank');
		// The line is still described by the example inside the folded help.
		const hintId = input.getAttribute('aria-describedby')?.split(' ')[1] ?? '';
		expect(help?.contains(document.getElementById(hintId))).toBe(true);
	});

	it('shows the result right below the line and keeps the line ready for the next one', async () => {
		useWindow(true, true);
		const { onsave, input } = await renderQuick();
		await fireEvent.input(input, { target: { value: 'Milch @HAUS' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onsave.mock.calls[0]?.[1]).toBe('ticket');
		const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(link.getAttribute('href')).toBe('/tagesplan/tickets/tick00000000001');
		expect(link.closest('[aria-live="polite"]')?.textContent).toMatch(/Ticket HAUS-2 angelegt\./);
		expect(before(link, screen.getByRole('combobox', { name: 'Projekt' }))).toBe(true);
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);

		// "In den Eingang" without Alt: one tap.
		await fireEvent.input(input, { target: { value: 'Idee' } });
		await fireEvent.click(screen.getByRole('button', { name: 'In den Eingang' }));
		expect(onsave.mock.calls[1]?.[1]).toBe('inbox');
		expect(await screen.findByRole('link', { name: 'Eintrag ansehen' })).toBeTruthy();
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
	});

	it('shows a failure right below the line as well', async () => {
		useWindow(true, true);
		const { input } = await renderQuick();
		await fireEvent.input(input, { target: { value: '@HAUS' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		const empty = screen.getByText('Der Titel darf nicht leer sein.');
		expect(before(empty, screen.getByRole('combobox', { name: 'Projekt' }))).toBe(true);
	});

	it('keeps the focus in the line while a button that saves is pressed, so the keyboard stays open', async () => {
		useWindow(true, true);
		await renderQuick();
		expect(pressKeepsFocus(screen.getByRole('button', { name: 'Ticket anlegen' }))).toBe(true);
		expect(pressKeepsFocus(screen.getByRole('button', { name: 'In den Eingang' }))).toBe(true);
		expect(pressKeepsFocus(screen.getByRole('button', { name: 'Schließen' }))).toBe(false);
	});

	it('keeps typed text: it counts as unsaved for leaving the page, and the × asks first', async () => {
		useWindow(true, true);
		const { input, onclose } = await renderQuick();
		expect(hasUnsavedInput()).toBe(false);
		await fireEvent.input(input, { target: { value: 'Zahnarzt anrufen' } });
		expect(hasUnsavedInput()).toBe(true);

		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(screen.getByRole('group', { name: /Änderungen verwerfen\?/ })).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
		expect(input.value).toBe('Zahnarzt anrufen');

		await fireEvent.keyDown(input, { key: 'Enter' });
		await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(hasUnsavedInput()).toBe(false);
	});
});

describe('the quick entry stays the dialog of today without the frame (MO-5)', () => {
	it.each([
		['on a PC with the switch on', false, true],
		['on a phone with the switch off', true, false]
	])(
		'keeps "Abbrechen", the keys in the hint and the result after it %s',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { dialog, input } = await renderQuick();
			expect(dialog.classList.contains('sheet')).toBe(false);
			expect(footerButtons(dialog)).toEqual(['Abbrechen', 'In den Eingang', 'Ticket anlegen']);
			const hint = screen.getByText(
				/^Enter legt ein Ticket an, Alt\+Enter legt es in den Eingang\./
			);
			expect(hint.textContent?.replace(/\s+/g, ' ')).toMatch(
				/Beispiel: „Zahnarzt anrufen @HAUS !hoch #anruf“ \(Priorität !niedrig, !mittel, !hoch, !dringend oder !1 bis !4\)\./
			);
			expect(dialog.querySelector('details')).toBeNull();
			expect(input.hasAttribute('autocapitalize')).toBe(false);
			expect(pressKeepsFocus(screen.getByRole('button', { name: 'Ticket anlegen' }))).toBe(false);
			expect(pressKeepsFocus(screen.getByRole('button', { name: 'In den Eingang' }))).toBe(false);

			await fireEvent.input(input, { target: { value: 'Milch' } });
			await fireEvent.keyDown(input, { key: 'Enter' });
			const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
			expect(before(hint, link)).toBe(true);
			expect(before(screen.getByRole('combobox', { name: 'Projekt' }), link)).toBe(true);
			expect(footerButtons(dialog)).toEqual(['Schließen', 'In den Eingang', 'Ticket anlegen']);
		}
	);
});

describe('"Erste Schritte" offers the quick entry without its key in the frame (MO-5)', () => {
	function showSteps() {
		const quick = vi.fn();
		render(FirstSteps, {
			props: { store: new FirstStepsStore(localStore) },
			context: new Map([[QUICK_CAPTURE_CONTEXT, quick]])
		});
		const steps = within(screen.getByRole('region', { name: 'Erste Schritte' }));
		return { quick, open: steps.getByRole('button', { name: /^Öffnen/ }) };
	}

	it('says "Öffnen" without "c" in the phone frame and opens the quick entry', async () => {
		useWindow(true, true);
		const { quick, open } = showSteps();
		expect(open.textContent?.trim()).toBe('Öffnen');
		expect(open.querySelector('kbd')).toBeNull();
		await fireEvent.click(open);
		expect(quick).toHaveBeenCalledOnce();
	});

	it.each([
		['on a PC with the switch on', false, true],
		['on a phone with the switch off', true, false]
	])('keeps the key "c" %s', (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		const { open } = showSteps();
		expect(open.querySelector('kbd')?.textContent).toBe('c');
	});
});

/** The rules of the frame in the style of a component, from the media query of the phone on. */
function frameRules(file: string): string {
	const source = readFileSync(join(LIB, file), 'utf8');
	const start = source.indexOf('@media (max-width: 39.99rem)');
	expect(start, `${file} has a block of the phone frame`).toBeGreaterThan(-1);
	return source.slice(start);
}

describe('the rules of the sheet of "＋" in the phone frame (static)', () => {
	it('lets the two buttons share the footer and gives the help and "Ticket ansehen" 44 px', () => {
		const css = frameRules('components/QuickCapture.svelte');
		expect(css).toMatch(/\.capture-save \{\s*flex: 1 1 0;\s*white-space: nowrap;/);
		expect(css).toMatch(
			/\.capture-help summary \{[^}]*line-height: var\(--control-height-touch\);/
		);
		expect(css).toMatch(/\.result a \{[^}]*min-height: var\(--control-height-touch\);/);
		// Only there: before the block the dialog has no rules of its own for them.
		const source = readFileSync(join(LIB, 'components/QuickCapture.svelte'), 'utf8');
		const outside = source.slice(0, source.length - css.length);
		expect(outside).not.toMatch(/\.capture-save \{|\.capture-help summary/);
	});
});
