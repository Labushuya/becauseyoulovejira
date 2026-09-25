// Component tests for the area switch (CLAUDE.md section 7, E2 plan P-5 and package 2).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AreaSwitch from './AreaSwitch.svelte';

function household() {
	return screen.getByRole('button', { name: 'Haushalt' });
}

function personal() {
	return screen.getByRole('button', { name: 'Privat' });
}

describe('area switch', () => {
	it('is a group named "Bereich" with "Privat" active', () => {
		render(AreaSwitch);

		const group = screen.getByRole('group', { name: 'Bereich' });
		expect(group.contains(personal())).toBe(true);
		expect(group.contains(household())).toBe(true);
		expect(personal().getAttribute('aria-pressed')).toBe('true');
	});

	it('shows "Haushalt" as unavailable, linked to the visible note "Demnächst"', () => {
		render(AreaSwitch);

		expect(household().getAttribute('aria-disabled')).toBe('true');
		expect(household().getAttribute('aria-pressed')).toBeNull();
		const hintId = household().getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(hintId)?.textContent).toBe('Demnächst');
		expect(screen.getByText('Demnächst')).toBeTruthy();
	});

	it('shows "Demnächst" as a lozenge inside "Haushalt", not as a third entry', () => {
		render(AreaSwitch);

		const group = screen.getByRole('group', { name: 'Bereich' });
		const lozenge = screen.getByText('Demnächst');
		expect(household().contains(lozenge)).toBe(true);
		expect(lozenge.classList.contains('soon')).toBe(true);
		expect(Array.from(group.children).map((child) => child.tagName)).toEqual(['BUTTON', 'BUTTON']);
	});

	it('keeps both buttons reachable by keyboard', () => {
		render(AreaSwitch);

		for (const button of [personal(), household()]) {
			expect(button).toHaveProperty('disabled', false);
			expect(button.tabIndex).toBe(0);
			button.focus();
			expect(document.activeElement).toBe(button);
		}
	});

	it('does nothing when "Haushalt" is clicked or activated with the keyboard', async () => {
		const { container } = render(AreaSwitch);
		const before = container.innerHTML;

		await fireEvent.click(household());
		household().focus();
		await fireEvent.keyDown(household(), { key: 'Enter' });
		await fireEvent.keyDown(household(), { key: ' ' });

		expect(container.innerHTML).toBe(before);
		expect(personal().getAttribute('aria-pressed')).toBe('true');
		expect(document.activeElement).toBe(household());
	});

	it('gives every instance its own hint id', () => {
		render(AreaSwitch);
		render(AreaSwitch);

		const ids = screen
			.getAllByRole('button', { name: 'Haushalt' })
			.map((button) => button.getAttribute('aria-describedby'));
		expect(new Set(ids).size).toBe(2);
	});
});
