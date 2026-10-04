// Component tests of Field (UI-1, ADR-0060): the label names the control, error and hint describe
// it (the error first), the control is invalid only with an error, and the control of the caller
// keeps its own attributes and states. The look of the control is static in base.css
// (no-own-form-styles.test.ts); here only the layout of the field.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import FieldHarness from '$lib/test/FieldHarness.svelte';

function describedTexts(control: HTMLElement): string[] {
	return (control.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent?.trim() ?? `missing ${id}`);
}

describe('Field', () => {
	it('names the control by its label, with a generated or a given id', () => {
		const { unmount } = render(FieldHarness, { props: { label: 'Name des Haushalts' } });
		const control = screen.getByRole('textbox', { name: 'Name des Haushalts' });
		expect(control.id).not.toBe('');
		expect(document.querySelector(`label[for="${control.id}"]`)?.textContent).toBe(
			'Name des Haushalts'
		);
		unmount();

		render(FieldHarness, { props: { label: 'Code', id: 'eigene-id' } });
		expect(screen.getByRole('textbox', { name: 'Code' }).id).toBe('eigene-id');
	});

	it('describes the control by its hint and is valid without an error', () => {
		render(FieldHarness, { props: { label: 'Name', hint: 'So sehen dich die anderen.' } });
		const control = screen.getByRole('textbox', { name: 'Name' });
		expect(describedTexts(control)).toEqual(['So sehen dich die anderen.']);
		expect(control.hasAttribute('aria-invalid')).toBe(false);
		expect(document.querySelector('.field-error')).toBeNull();
	});

	it('shows an error with its icon, marks the control invalid and names the error first', () => {
		render(FieldHarness, {
			props: { label: 'Name', hint: 'Höchstens 100 Zeichen.', error: 'Bitte einen Namen eingeben.' }
		});
		const control = screen.getByRole('textbox', { name: 'Name' });
		expect(control.getAttribute('aria-invalid')).toBe('true');
		expect(describedTexts(control)).toEqual([
			'Bitte einen Namen eingeben.',
			'Höchstens 100 Zeichen.'
		]);
		const error = document.querySelector('.field-error');
		expect(error?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		// The error stands between the control and the hint.
		const order = [...(control.parentElement?.children ?? [])].map(
			(element) =>
				element.tagName.toLowerCase() + (element.className ? `.${element.className}` : '')
		);
		expect(order.findIndex((entry) => entry.startsWith('input'))).toBeLessThan(
			order.findIndex((entry) => entry.includes('field-error'))
		);
		expect(order.findIndex((entry) => entry.includes('field-error'))).toBeLessThan(
			order.findIndex((entry) => entry.includes('hint'))
		);
	});

	it('leaves aria-describedby out without hint and error and appends further ids', () => {
		const { unmount } = render(FieldHarness, { props: { label: 'Name' } });
		expect(screen.getByRole('textbox', { name: 'Name' }).hasAttribute('aria-describedby')).toBe(
			false
		);
		unmount();

		render(FieldHarness, { props: { label: 'Name', hint: 'Hinweis', describedBy: 'weiteres' } });
		expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby')).toMatch(
			/-hint weiteres$/
		);
	});

	it('takes a hint with links as a snippet', () => {
		const hint = createRawSnippet(() => ({
			render: () => '<span>Mehr in der <a href="/einstellungen/hilfe">Hilfe</a>.</span>'
		}));
		render(FieldHarness, { props: { label: 'Name', hint } });
		const control = screen.getByRole('textbox', { name: 'Name' });
		expect(describedTexts(control)).toEqual(['Mehr in der Hilfe.']);
		expect(screen.getByRole('link', { name: 'Hilfe' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe'
		);
	});

	it.each([
		['select', 'combobox'],
		['textarea', 'textbox']
	] as const)('links a %s the same way', (kind, role) => {
		render(FieldHarness, { props: { label: 'Projekt', kind, error: 'Bitte wählen.' } });
		const control = screen.getByRole(role, { name: 'Projekt' });
		expect(control.tagName.toLowerCase()).toBe(kind);
		expect(control.getAttribute('aria-invalid')).toBe('true');
		expect(describedTexts(control)).toEqual(['Bitte wählen.']);
	});

	it('keeps the states the caller gives its control: locked, read-only, required', () => {
		const { unmount } = render(FieldHarness, { props: { label: 'Name', disabled: true } });
		const locked = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
		expect(locked.disabled).toBe(true);
		expect(locked.required).toBe(true);
		unmount();

		render(FieldHarness, { props: { label: 'Code', readonly: true } });
		expect((screen.getByRole('textbox', { name: 'Code' }) as HTMLInputElement).readOnly).toBe(true);
	});

	it('gives a control of its own width the class "auto"', () => {
		const { container, unmount } = render(FieldHarness, {
			props: { label: 'Datum', width: 'auto' }
		});
		expect(container.querySelector('.field')?.classList.contains('auto')).toBe(true);
		unmount();
		const full = render(FieldHarness, { props: { label: 'Name' } });
		expect(full.container.querySelector('.field')?.classList.contains('auto')).toBe(false);
	});

	it('lays the field out from the tokens: label, hint, gap and the width of forms', () => {
		const source = readFileSync(join(import.meta.dirname, 'Field.svelte'), 'utf8');
		const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
		expect(style).toMatch(/\.label \{[^}]*font-size:\s*var\(--font-size-control\)/);
		expect(style).toMatch(/\.label \{[^}]*color:\s*var\(--color-text-muted\)/);
		expect(style).toMatch(/\.hint \{[^}]*font-size:\s*var\(--font-size-small\)/);
		expect(style).toMatch(/\.field \{[^}]*max-width:\s*32rem/);
		expect(style).toMatch(/\.field \{[^}]*gap:\s*0\.25rem/);
		// The field gives the control no look of its own (base.css draws it).
		expect(style).not.toMatch(/\b(?:input|select|textarea)\b/);
	});
});
