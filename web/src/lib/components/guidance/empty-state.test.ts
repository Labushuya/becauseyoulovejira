// Component tests of the empty state and the lozenge (ADR-0026 section 2, plan EH-2).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import EmptyState from './EmptyState.svelte';
import Lozenge from './Lozenge.svelte';

const button = (label: string, className: string) =>
	createRawSnippet(() => ({
		render: () => `<button class="${className}" type="button">${label}</button>`
	}));

describe('empty state', () => {
	it('shows heading, description and at most one primary action', () => {
		const { container } = render(EmptyState, {
			props: {
				title: 'Noch kein Kanal verbunden',
				description: 'Verbinde einen Kalender.',
				icon: 'channels',
				headingLevel: 4,
				primary: button('Kanal hinzufügen', 'button-primary'),
				secondary: button('Später', 'button-subtle')
			}
		});

		expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('Noch kein Kanal verbunden');
		expect(screen.getByText('Verbinde einen Kalender.')).toBeTruthy();
		expect(container.querySelectorAll('.button-primary')).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Später' })).toBeTruthy();
		const icon = container.querySelector('svg');
		expect(icon?.getAttribute('aria-hidden')).toBe('true');
		expect(icon?.getAttribute('width')).toBe('48');
	});

	it.each(['wide', 'narrow'] as const)('centres the size %s with an icon', (size) => {
		const { container } = render(EmptyState, {
			props: { title: 'Leer', icon: 'inbox', size }
		});
		expect(container.querySelector('.empty-state')?.classList.contains(size)).toBe(true);
		expect(container.querySelector('svg')).toBeTruthy();
	});

	it('shows no icon in the compact size, and a level 3 heading by default', () => {
		const { container } = render(EmptyState, {
			props: { title: 'Noch keine Kommentare', icon: 'comments', size: 'compact' }
		});
		expect(container.querySelector('svg')).toBeNull();
		expect(screen.getByRole('heading', { level: 3 })).toBeTruthy();
	});

	it('has exactly one snippet for a primary action', () => {
		const source = readFileSync(join(import.meta.dirname, 'EmptyState.svelte'), 'utf8');
		expect(source.match(/@render primary\?\.\(\)/g)).toHaveLength(1);
	});
});

describe('lozenge', () => {
	it.each(['neutral', 'brand', 'danger', 'muted'] as const)(
		'shows the tone %s with icon and text',
		(tone) => {
			const { container } = render(Lozenge, {
				props: { label: 'Eingerichtet', icon: 'check', tone, id: `l-${tone}` }
			});
			const lozenge = container.querySelector('.lozenge');
			expect(lozenge?.getAttribute('data-tone')).toBe(tone);
			expect(lozenge?.id).toBe(`l-${tone}`);
			expect(lozenge?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
			expect(lozenge?.textContent?.trim()).toBe('Eingerichtet');
		}
	);

	it('is not interactive', () => {
		const { container } = render(Lozenge, { props: { label: 'Pausiert', icon: 'pause' } });
		expect(container.querySelector('button, a, [tabindex]')).toBeNull();
		expect(container.querySelector('.lozenge')?.getAttribute('data-tone')).toBe('neutral');
	});
});
