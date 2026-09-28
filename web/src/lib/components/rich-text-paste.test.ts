// Pasting into the editor (plan editor RT-5): the clipboard of Word 365, Google Docs and
// LibreOffice ends as Markdown with headings, formatting, lists and safe links, without colours,
// fonts, images or handlers; plain text with Markdown is read as Markdown, Ctrl+Shift+V (plain)
// keeps it as text. jsdom has no ClipboardEvent: prosemirror-stubs.ts brings one, and the paste
// event carries a small clipboard of its own.

import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import RichTextEditorHarness from '$lib/test/RichTextEditorHarness.svelte';

useOverlayStubs();
useProseMirrorStubs();

const FIXTURES = join(import.meta.dirname, '..', 'test', 'paste-fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

async function setup(initial = '') {
	const view = render(RichTextEditorHarness, { props: { initial } });
	const element = await screen.findByRole('textbox', { name: 'Beschreibung' }, { timeout: 5000 });
	const editor = (element as HTMLElement & { editor: Editor }).editor;
	editor.commands.focus('end');
	return { element, editor, value: () => view.component.current() };
}

/** A paste event as the browser sends it, with only the given clipboard types. */
async function paste(element: HTMLElement, data: Record<string, string>) {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types: Object.keys(data),
			getData: (type: string) => data[type] ?? ''
		}
	});
	element.dispatchEvent(event);
	await tick();
}

describe('pasting into the editor', () => {
	it('turns Word 365 into Markdown with headings, formatting, lists and the safe link', async () => {
		const { element, value } = await setup();
		await paste(element, { 'text/html': fixture('word-365.html'), 'text/plain': 'Umzug planen' });
		expect(value()).toBe(
			[
				'# Umzug planen',
				'',
				'Bitte **bis Freitag** erledigen, *ohne Ausnahme* und ++gründlich++. Rot und bunt bleibt nur Text.',
				'',
				'- Kartons besorgen',
				'  - Beim Baumarkt fragen',
				'- Helfer **anrufen**',
				'',
				'1. Zählerstände notieren',
				'2. Schlüssel abgeben',
				'',
				'Mehr unter [der Checkliste](https://example.com/umzug) und nicht hier.'
			].join('\n')
		);
		expect(element.querySelector('img')).toBeNull();
	});

	it('turns Google Docs into Markdown without the bold wrapper and without the image', async () => {
		const { element, value } = await setup();
		await paste(element, { 'text/html': fixture('google-docs.html'), 'text/plain': 'x' });
		expect(value()).toBe(
			[
				'## Einkauf für das Fest',
				'',
				'Bitte **rechtzeitig** bestellen, *kühl* lagern und ++nichts vergessen++, ~~Sekt~~ gestrichen.',
				'',
				'- Brot',
				'- Käse',
				'',
				'1. Tisch decken',
				'',
				'[++Einladung++](https://example.com/fest) ansehen.'
			].join('\n')
		);
		expect(element.querySelector('img')).toBeNull();
	});

	it('turns LibreOffice into Markdown and makes a table plain paragraphs', async () => {
		const { element, value } = await setup();
		await paste(element, { 'text/html': fixture('libreoffice.html'), 'text/plain': 'x' });
		expect(value()).toBe(
			[
				'### Werkstatt',
				'',
				'**Reifen** wechseln, *Öl* prüfen, ++Termin++ bestätigen und ~~Politur~~ auslassen.',
				'',
				'- Winterreifen',
				'- Wagenheber',
				'  - Kurbel',
				'',
				'3. Rechnung ablegen',
				'',
				'Kontakt: [werkstatt@example.com](mailto:werkstatt@example.com)',
				'',
				'Zelle'
			].join('\n')
		);
	});

	it('creates no script, handler, input or image from hostile HTML', async () => {
		const { element, value } = await setup();
		const hostile =
			'<p>a <img src=x onerror="globalThis.pwned=1"> <b onclick="globalThis.pwned=2">b</b>' +
			'<script>globalThis.pwned=3</script> <a href="javascript:alert(1)">c</a> ' +
			'<input type="text" value="d"> <u onmouseover="x()">e</u></p>';
		await paste(element, { 'text/html': hostile, 'text/plain': 'a b c e' });
		expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
		expect(
			element.querySelector('img, script, input[type="text"], [onclick], [onmouseover]')
		).toBeNull();
		expect(value()).toBe('a **b** c ++e++');
	});

	it('reads plain text with Markdown as Markdown', async () => {
		const { element, value, editor } = await setup();
		await paste(element, { 'text/plain': '## Liste\n\n- [ ] Brot\n- [x] Milch' });
		expect(editor.getHTML()).toContain('<h2>Liste</h2>');
		expect(value()).toBe('## Liste\n\n- [ ] Brot\n- [x] Milch');
	});

	it('keeps plain text without Markdown and pastes as plain text with Ctrl+Shift+V', async () => {
		const { element, value, editor } = await setup();
		await paste(element, { 'text/plain': 'Nur ein Satz.' });
		expect(value()).toBe('Nur ein Satz.');

		editor.commands.setContent('<p></p>');
		editor.view.pasteText('**nicht fett**');
		await tick();
		expect(editor.getHTML()).toBe('<p>**nicht fett**</p>');
	});
});
