// Static checks for ADR-0025 sections 2 and 3 (plan UI-Konsistenz, package UI-4): every modal
// dialog goes through the modal building block. No component but Modal.svelte has its own
// <dialog>, showModal() or ::backdrop, the dialogs use the sizes of the plan, and buttons come
// from the shared classes of base.css instead of a local ".secondary".

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const MODAL = join('lib', 'components', 'overlay', 'Modal.svelte');

function components(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return components(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/** Source without comments, so a comment may still name what the code must not do. */
function code(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = components(SRC_DIR).map((path) => [relative(SRC_DIR, path), path] as const);

const OWN_DIALOG = /<dialog\b|\.showModal\s*\(|::backdrop/;
const LOCAL_SECONDARY =
	/(?<![\w-])\.secondary\b|class="(?:[^"]*\s)?secondary(?:\s[^"]*)?"|class:secondary\b/;

/** Size of each dialog (plan UI-4): M for forms, L for the selection views, S for questions. */
const SIZES: Readonly<Record<string, 's' | 'm' | 'l'>> = {
	'overlay/ConfirmDialog.svelte': 's',
	'QuickCapture.svelte': 'm',
	'ClipboardImport.svelte': 'm',
	'BulkConvertDialog.svelte': 'm',
	'RecurrenceDialog.svelte': 'm',
	'FileImportDialog.svelte': 'l',
	'WhatsAppImport.svelte': 'l',
	'MailboxPicker.svelte': 'l',
	'channels/ChannelEditModal.svelte': 'm',
	'channels/ChannelSetup.svelte': 'l',
	'channels/ProtonGuide.svelte': 'm',
	'help/ShortcutsModal.svelte': 'm'
};

describe('dialogs on the modal building block', () => {
	it('finds the components', () => {
		expect(files.some(([name]) => name === MODAL)).toBe(true);
		expect(files.length).toBeGreaterThan(50);
	});

	it.each(files.filter(([name]) => name !== MODAL))(
		'%s has no own dialog or veil',
		(_name, path) => {
			expect(code(path)).not.toMatch(OWN_DIALOG);
		}
	);

	it.each(Object.entries(SIZES))('%s is a modal of size %s', (file, size) => {
		const source = code(join(SRC_DIR, 'lib', 'components', file));
		expect(source).toMatch(/import Modal from '\.\.?\/(?:overlay\/)?Modal\.svelte';/);
		expect(source).toMatch(new RegExp(`<Modal\\b[^>]*\\ssize="${size}"`));
	});

	it.each([
		['<dialog class="x">', true],
		['element.showModal();', true],
		['.x::backdrop {', true],
		['<Modal open size="m">', false],
		['aria-haspopup="dialog"', false]
	])('recognizes an own dialog in %s', (sample, found) => {
		expect(OWN_DIALOG.test(sample)).toBe(found);
	});
});

describe('shared buttons', () => {
	it.each(files)('%s has no local ".secondary"', (_name, path) => {
		expect(code(path)).not.toMatch(LOCAL_SECONDARY);
	});

	it.each(files)('%s names every icon button', (_name, path) => {
		const tags =
			code(path).match(/<(?:button|a)\b[^>]*class="[^"]*\bbutton-icon\b[^"]*"[^>]*>/g) ?? [];
		for (const tag of tags) expect(tag).toMatch(/\saria-label=/);
	});

	it.each([
		['<button class="secondary" type="button">', true],
		['<a class="secondary small" href="/">', true],
		['\t.secondary {', true],
		['<button class="button-secondary">', false],
		['.button-secondary:hover', false]
	])('recognizes a local secondary in %s', (sample, found) => {
		expect(LOCAL_SECONDARY.test(sample)).toBe(found);
	});
});
