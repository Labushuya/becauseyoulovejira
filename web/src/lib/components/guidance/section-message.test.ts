// Component tests of the section message (ADR-0026 section 2, plan EH-2): tones with icon and
// hidden prefix, roles only with `live`, title as heading, compact variant, actions, and red only
// for the tone "error".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import SectionMessage, { TONE_PREFIX, type SectionMessageTone } from './SectionMessage.svelte';

const text = (html: string) => createRawSnippet(() => ({ render: () => `<span>${html}</span>` }));

function show(props: Record<string, unknown>) {
	const { container } = render(SectionMessage, {
		props: { tone: 'info', children: text('Der Text.'), ...props } as never
	});
	return container.querySelector<HTMLElement>('.section-message')!;
}

describe('section message', () => {
	it.each([
		['info', 'Hinweis:'],
		['success', 'Erledigt:'],
		['warning', 'Achtung:'],
		['error', 'Fehler:']
	] as [SectionMessageTone, string][])(
		'shows the tone %s with a decorative icon and the hidden prefix %s',
		(tone, prefix) => {
			const message = show({ tone });

			expect(message.getAttribute('data-tone')).toBe(tone);
			expect(message.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
			const hidden = message.querySelector('.visually-hidden');
			expect(hidden?.textContent).toBe(prefix);
			expect(TONE_PREFIX[tone]).toBe(prefix);
			expect(message.textContent).toMatch(/Der Text\./);
		}
	);

	it('has no role without live, so static hints are not announced', () => {
		const message = show({ tone: 'warning' });
		expect(message.hasAttribute('role')).toBe(false);
		expect(screen.queryByRole('status')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it.each([
		['info', 'status'],
		['success', 'status'],
		['warning', 'status'],
		['error', 'alert']
	] as [SectionMessageTone, string][])('announces the live tone %s as %s', (tone, role) => {
		show({ tone, live: true });
		expect(screen.getByRole(role).textContent).toMatch(/Der Text\./);
	});

	it('shows the title as a heading of the chosen level with the prefix inside', () => {
		show({ tone: 'warning', title: 'Keine Stichwörter', headingLevel: 4 });

		const heading = screen.getByRole('heading', { level: 4 });
		expect(heading.textContent?.trim()).toBe('Achtung: Keine Stichwörter');
		expect(screen.getByText('Der Text.')).toBeTruthy();
	});

	it('drops surface and title in the compact variant', () => {
		const message = show({ tone: 'info', title: 'Hinweis', compact: true });

		expect(message.classList.contains('compact')).toBe(true);
		expect(screen.queryByRole('heading')).toBeNull();
		expect(message.querySelector('svg')?.getAttribute('width')).toBe('14');
	});

	it('renders its actions', () => {
		const actions = createRawSnippet(() => ({
			render: () => '<button type="button">Erneut versuchen</button>'
		}));
		show({ tone: 'error', live: true, actions });
		expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
	});

	it('uses the danger tokens only for the tone "error" and no yellow', () => {
		const source = readFileSync(join(import.meta.dirname, 'SectionMessage.svelte'), 'utf8');
		const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
		const rules = [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)];
		for (const [, selector, body] of rules) {
			if (/--color-danger/.test(body ?? '')) expect(selector?.trim()).toBe('.error');
		}
		expect(style).not.toMatch(/yellow|#f[0-9a-f]{2}0|amber/i);
	});
});
