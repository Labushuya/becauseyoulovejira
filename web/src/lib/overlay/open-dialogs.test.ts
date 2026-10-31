// Whether a modal dialog is open in the document (round 2 of the package "Einschalten", E-1): the
// question of the first start of the phone view waits for it. An open <dialog> and an element with
// role "dialog" and aria-modal count, one holding the given mark (the question) does not; unwatched
// the store reads the document at once, watched it follows opening, closing and removing, and stops
// with its cleanup.

import { afterEach, describe, expect, it } from 'vitest';
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
