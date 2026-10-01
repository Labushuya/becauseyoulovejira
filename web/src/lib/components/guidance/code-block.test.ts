// Component tests of the code block and the external link (ADR-0026 section 6, plan EH-4): copy
// with success and refusal, status, names, placeholders, masking, and links only to https pages
// with "(öffnet in neuem Tab)" after a space.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECRET_MASK } from '$lib/guidance/command';
import CodeBlock from './CodeBlock.svelte';
import ExternalLink from './ExternalLink.svelte';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const TEMPLATE = 'setx BYL_TELEGRAM_TOKEN "{{token}}"';
const PLACEHOLDERS = { token: { label: 'Bot-Token', secret: true } };

describe('code block', () => {
	it('is a figure with caption and a named region that scrolls with the keyboard', () => {
		render(CodeBlock, { props: { code: '/newbot', label: 'Befehl an BotFather' } });
		const region = screen.getByRole('region', { name: 'Befehl an BotFather' });
		expect(region.tagName).toBe('PRE');
		expect(region.getAttribute('tabindex')).toBe('0');
		expect(region.textContent).toBe('/newbot');
		expect(screen.getByRole('figure')).toBeTruthy();
		expect(screen.getByText('Befehl an BotFather').closest('figcaption')).not.toBeNull();
	});

	it('marks placeholders and announces them as such', () => {
		render(CodeBlock, {
			props: { code: TEMPLATE, label: 'Befehl', placeholders: PLACEHOLDERS }
		});
		const placeholder = document.querySelector('.placeholder');
		expect(placeholder?.textContent).toBe('Platzhalter: ‹Bot-Token›');
		expect(placeholder?.querySelector('.visually-hidden')?.textContent).toBe('Platzhalter: ');
	});

	it('masks a secret value but copies the real one', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		render(CodeBlock, {
			props: {
				code: TEMPLATE,
				label: 'Befehl',
				placeholders: PLACEHOLDERS,
				values: { token: '123:ABC' }
			}
		});
		const region = screen.getByRole('region', { name: 'Befehl' });
		expect(region.textContent).toBe(`setx BYL_TELEGRAM_TOKEN "${SECRET_MASK}"`);
		expect(region.textContent).not.toContain('123:ABC');
		await fireEvent.click(screen.getByRole('button', { name: 'Befehl kopieren' }));
		expect(writeText).toHaveBeenCalledWith('setx BYL_TELEGRAM_TOKEN "123:ABC"');
	});

	it('says "Kopiert" for 2 seconds and announces the copy as status', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		render(CodeBlock, { props: { code: '/newbot', label: 'Befehl an BotFather' } });
		const button = screen.getByRole('button', { name: 'Befehl an BotFather kopieren' });
		expect(button.textContent?.trim()).toBe('Kopieren');

		await fireEvent.click(button);
		await vi.waitFor(() => expect(button.textContent?.trim()).toBe('Kopiert'));
		expect(button.querySelector('svg')).not.toBeNull();
		expect(screen.getByRole('status').textContent).toBe('Befehl an BotFather kopiert.');

		await vi.advanceTimersByTimeAsync(2000);
		expect(button.textContent?.trim()).toBe('Kopieren');
		expect(screen.getByRole('status').textContent).toBe('');
	});

	it('selects the code and names Ctrl+C when the browser refuses', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('denied');
				}
			}
		});
		render(CodeBlock, { props: { code: '/newbot', label: 'Befehl an BotFather' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Befehl an BotFather kopieren' }));
		await vi.waitFor(() =>
			expect(screen.getByText(/Der Code ist markiert: mit Strg\+C kopieren/)).toBeTruthy()
		);
		expect(window.getSelection()?.toString()).toBe('/newbot');
		expect(
			screen.getByRole('button', { name: 'Befehl an BotFather kopieren' }).textContent?.trim()
		).toBe('Kopieren');
	});

	it('works without a clipboard API', async () => {
		vi.stubGlobal('navigator', {});
		render(CodeBlock, { props: { code: '/newbot', label: 'Befehl' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Befehl kopieren' }));
		await vi.waitFor(() => expect(screen.getByText(/mit Strg\+C kopieren/)).toBeTruthy());
	});

	it('can go without "Kopieren" and wrap long lines', () => {
		render(CodeBlock, {
			props: { code: 'Zahnarzt anrufen @HAUS', label: 'Beispiel', copyable: false, wrap: true }
		});
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.getByRole('region', { name: 'Beispiel' }).classList.contains('wrap')).toBe(true);
	});
});

describe('external link', () => {
	const text = createRawSnippet(() => ({ render: () => '<span>myaccount.google.com</span>' }));

	it('opens an https page in a new tab without opener and says so', () => {
		render(ExternalLink, { props: { href: 'https://myaccount.google.com', children: text } });
		const link = screen.getByRole('link', {
			name: 'myaccount.google.com (öffnet in neuem Tab)'
		});
		expect(link.getAttribute('href')).toBe('https://myaccount.google.com');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('keeps the space before "(öffnet in neuem Tab)" (ADR-0026, addendum of 2026-10-01)', () => {
		render(ExternalLink, { props: { href: 'https://myaccount.google.com', children: text } });
		const link = screen.getByRole('link');
		// Svelte 5 removes white space at the start of an element's markup, so the space is a text
		// node of the link before the hidden part, not a part of it.
		const hidden = link.querySelector('.visually-hidden');
		expect(hidden?.textContent).toBe('(öffnet in neuem Tab)');
		expect(hidden?.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
		expect(hidden?.previousSibling?.textContent).toBe(' ');
		expect(link.textContent).toBe('myaccount.google.com (öffnet in neuem Tab)');
	});

	it.each(['http://example.com', 'javascript:alert(1)', '/eingang'])('does not link %s', (href) => {
		render(ExternalLink, { props: { href, children: text } });
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByText('myaccount.google.com')).toBeTruthy();
	});
});
