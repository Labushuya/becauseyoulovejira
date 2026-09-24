// Guards the assumptions of all web tests (OF-16): browser builds of Svelte/SvelteKit,
// a DOM with localStorage (jsdom) and the SvelteKit aliases.

import { browser } from '$app/environment';
import { STATUSES } from '$lib/domain/status';
import { describe, expect, it } from 'vitest';

describe('web test environment', () => {
	it('resolves the browser builds of Svelte and SvelteKit', () => {
		expect(browser).toBe(true);
	});

	it('provides a DOM with localStorage', () => {
		const input = document.createElement('input');
		document.body.append(input);
		input.focus();
		expect(document.activeElement).toBe(input);

		localStorage.setItem('byl-test-key', 'value');
		expect(localStorage.getItem('byl-test-key')).toBe('value');
		localStorage.removeItem('byl-test-key');
		input.remove();
	});

	it('resolves the $lib alias', () => {
		expect(STATUSES).toContain('open');
	});
});
