// Whether a modal dialog is open in the document (round 2 of the package "Einschalten", E-1): the
// question of the first start of the phone view waits for it. An open <dialog> and an element with
// role "dialog" and aria-modal count, one holding the given mark (the question) does not; unwatched
// the store reads the document at once, watched it follows opening, closing and removing, and stops
// with its cleanup. Since NA-1 (F-1) an open popover counts as well, followed by its toggle event.

import { afterEach, describe, expect, it } from 'vitest';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { OpenDialogs, dialogOpen } from './open-dialogs.svelte';

/** The records of the MutationObserver arrive as a microtask. */
const observed = () => Promise.resolve();

/** An open <dialog> in the body. */
function openDialog(): HTMLDialogElement {
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	document.body.append(dialog);
	return dialog;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('open dialogs of the document (Einschalten round 2, E-1)', () => {
	it('counts an open <dialog> and an element that says it is a modal dialog, nothing else', () => {
		expect(dialogOpen(document)).toBe(false);
		const closed = document.createElement('dialog');
		const panel = document.createElement('div');
		panel.setAttribute('role', 'dialog');
		document.body.append(closed, panel);
		expect(dialogOpen(document)).toBe(false);
		panel.setAttribute('aria-modal', 'true');
		expect(dialogOpen(document)).toBe(true);
		panel.remove();
		closed.setAttribute('open', '');
		expect(dialogOpen(document)).toBe(true);
	});

	it('reads the document at once while nobody watches', () => {
		const dialogs = new OpenDialogs(document);
		expect(dialogs.open).toBe(false);
		const dialog = openDialog();
		expect(dialogs.open).toBe(true);
		dialog.remove();
		expect(dialogs.open).toBe(false);
	});

	it('follows opening, closing and removing while watched, and stops with the cleanup', async () => {
		const dialogs = new OpenDialogs(document);
		const stop = dialogs.watch();
		expect(dialogs.open).toBe(false);

		const dialog = openDialog();
		await observed();
		expect(dialogs.open).toBe(true);
		dialog.removeAttribute('open');
		await observed();
		expect(dialogs.open).toBe(false);
		dialog.setAttribute('open', '');
		await observed();
		expect(dialogs.open).toBe(true);
		// Removed while open, as when its owner drops it.
		dialog.remove();
		await observed();
		expect(dialogs.open).toBe(false);

		stop();
		openDialog();
		// Unwatched again: read at once.
		expect(dialogs.open).toBe(true);
	});

	it('leaves out a dialog that holds the mark it is told, such as the question itself', async () => {
		const own = document.createElement('dialog');
		const text = document.createElement('div');
		text.setAttribute('data-offline-consent', '');
		own.append(text);
		own.setAttribute('open', '');
		document.body.append(own);
		expect(dialogOpen(document, 'data-offline-consent')).toBe(false);
		expect(dialogOpen(document)).toBe(true);

		const dialogs = new OpenDialogs(document, 'data-offline-consent');
		expect(dialogs.open).toBe(false);
		const stop = dialogs.watch();
		expect(dialogs.open).toBe(false);
		const other = openDialog();
		await observed();
		expect(dialogs.open).toBe(true);
		other.remove();
		await observed();
		expect(dialogs.open).toBe(false);
		stop();
	});

	it('starts with what is open when the watch begins', () => {
		openDialog();
		const dialogs = new OpenDialogs(document);
		const stop = dialogs.watch();
		expect(dialogs.open).toBe(true);
		stop();
	});
});

// NA-1 (F-1 of the review of round 2): a menu, a picker or a sheet of the phone frame is a popover
// (Popover.svelte), and showModal of the question would close it. It counts as open like for the global
// keys (domain/keyboard.ts, `:popover-open`). Opening and closing it changes no attribute, so the watch
// follows its toggle event.
describe('open popovers of the document (NA-1, F-1)', () => {
	useOverlayStubs();

	/** A closed popover in the body. */
	function popover(): HTMLElement {
		const element = document.createElement('div');
		element.setAttribute('popover', 'auto');
		document.body.append(element);
		return element;
	}

	it('counts an open popover, not a closed one', () => {
		const element = popover();
		expect(dialogOpen(document)).toBe(false);
		element.showPopover();
		expect(dialogOpen(document)).toBe(true);
		element.hidePopover();
		expect(dialogOpen(document)).toBe(false);
	});

	it('follows a popover that opens and closes while watched, by its toggle event', async () => {
		const element = popover();
		const dialogs = new OpenDialogs(document);
		const stop = dialogs.watch();
		expect(dialogs.open).toBe(false);
		element.showPopover();
		await observed();
		expect(dialogs.open).toBe(true);
		element.hidePopover();
		await observed();
		expect(dialogs.open).toBe(false);
		stop();
		// Unwatched again: read at once.
		element.showPopover();
		expect(dialogs.open).toBe(true);
		element.hidePopover();
	});

	it('leaves out a popover that holds the mark it is told', () => {
		const element = popover();
		const text = document.createElement('div');
		text.setAttribute('data-offline-consent', '');
		element.append(text);
		element.showPopover();
		expect(dialogOpen(document, 'data-offline-consent')).toBe(false);
		expect(dialogOpen(document)).toBe(true);
		element.hidePopover();
	});
});
