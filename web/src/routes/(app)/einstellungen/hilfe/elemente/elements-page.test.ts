// The overview of the form controls (UI-1, ADR-0060): every kind of control of the app in its
// states, each with a name, on one page that saves nothing. The look itself is checked by hand
// (manual case of the test manifest); here the page has every sample and links them correctly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

function nameOf(control: Element): string {
	const labelled = control.getAttribute('aria-labelledby');
	if (labelled !== null) return document.getElementById(labelled)?.textContent?.trim() ?? '';
	const labels = (control as HTMLInputElement).labels;
	if (labels !== null && labels.length > 0) return labels[0]?.textContent?.trim() ?? '';
	return control.getAttribute('aria-label') ?? '';
}

describe('overview of the form controls (UI-1)', () => {
	it('shows the four groups of samples', () => {
		render(Page);
		expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
			'Textfelder',
			'Auswahllisten und Textbereiche',
			'Kästchen, Optionsfelder und Schalter',
			'Knöpfe'
		]);
	});

	it('gives every control a name', () => {
		const { container } = render(Page);
		const controls = [...container.querySelectorAll('input, select, textarea')];
		expect(controls.length).toBeGreaterThan(25);
		for (const control of controls) expect(nameOf(control), control.outerHTML).not.toBe('');
	});

	it('has every type of field the app uses, in each state', () => {
		const { container } = render(Page);
		const types = new Set(
			[...container.querySelectorAll('input')].map((input) => input.getAttribute('type'))
		);
		for (const type of [
			'text',
			'password',
			'email',
			'url',
			'number',
			'date',
			'time',
			'search',
			'checkbox',
			'radio'
		]) {
			expect(types, type).toContain(type);
		}
		expect(screen.getByRole('textbox', { name: 'Gesperrt' })).toHaveProperty('disabled', true);
		expect(screen.getByRole('textbox', { name: 'Nur lesen' })).toHaveProperty('readOnly', true);
		expect(screen.getByRole('textbox', { name: 'Normal' }).getAttribute('placeholder')).not.toBe(
			null
		);
		const invalid = screen.getByRole('textbox', { name: 'Ungültig' });
		expect(invalid.getAttribute('aria-invalid')).toBe('true');
		expect(invalid.getAttribute('aria-describedby')).toMatch(/-error/);
		expect(screen.getByRole('combobox', { name: 'Auswahlliste, ungültig' })).toBeTruthy();
		expect(screen.getByRole('combobox', { name: 'Auswahlliste, gesperrt' })).toHaveProperty(
			'disabled',
			true
		);
		expect(screen.getByRole('textbox', { name: 'Textbereich, nur lesen' }).tagName).toBe(
			'TEXTAREA'
		);
	});

	it('shows checkboxes, radios and switches in their states', () => {
		render(Page);
		const boxes = within(screen.getByRole('group', { name: 'Kästchen' }));
		expect(boxes.getByRole('checkbox', { name: 'Gewählt' })).toHaveProperty('checked', true);
		expect(boxes.getByRole('checkbox', { name: 'Teilweise gewählt' })).toHaveProperty(
			'indeterminate',
			true
		);
		expect(boxes.getByRole('checkbox', { name: 'Gesperrt' })).toHaveProperty('disabled', true);
		const radios = within(screen.getByRole('group', { name: 'Optionsfelder' }));
		expect(radios.getByRole('radio', { name: '30 Tage' })).toHaveProperty('checked', true);
		expect(radios.getByRole('radio', { name: 'Gesperrt' })).toHaveProperty('disabled', true);
		const switches = within(screen.getByRole('group', { name: 'Schalter' }));
		expect(switches.getByRole('switch', { name: 'Eingeschaltet' })).toHaveProperty('checked', true);
		expect(switches.getByRole('switch', { name: 'Ausgeschaltet' })).toHaveProperty(
			'checked',
			false
		);
		expect(switches.getByRole('switch', { name: 'Gesperrt' })).toHaveProperty('disabled', true);
	});

	it('shows the shared buttons, small, locked and busy, and no red one', () => {
		const { container } = render(Page);
		for (const variant of ['button-primary', 'button-secondary', 'button-subtle', 'button-icon']) {
			expect(container.querySelector(`.${variant}`), variant).not.toBeNull();
		}
		expect(container.querySelectorAll('.button-small')).toHaveLength(3);
		expect(container.querySelectorAll('[aria-disabled="true"]').length).toBeGreaterThan(1);
		expect(container.querySelector('button[aria-busy="true"]')?.textContent?.trim()).toBe(
			'Läuft …'
		);
		expect(screen.getByRole('button', { name: 'Symbolknopf' })).toBeTruthy();
		expect(screen.getByText(/nicht rot; Rot steht nur für echte Fehler/)).toBeTruthy();
	});

	it('saves and sends nothing: no store, no data layer, no server', () => {
		const source = readFileSync(join(import.meta.dirname, '+page.svelte'), 'utf8');
		expect(source).not.toMatch(/\$lib\/(stores|data)\/|pocketbase|fetch\(|localStorage/);
	});
});
