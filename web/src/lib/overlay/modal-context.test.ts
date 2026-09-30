// The guard "kein Dialog aus einem Dialog" (ADR-0025 section 3, addendum 16): a modal marks the
// components below it; one that opens inside another modal throws in the tests (so every
// component test that reaches such a place fails) and only logs in the app.

import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NestedModalHarness from '$lib/test/NestedModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import {
	NESTED_MODAL_LOG,
	NestedModalError,
	nestedModalIsStrict,
	reportNestedModal
} from './modal-context';

useOverlayStubs();

afterEach(() => {
	vi.restoreAllMocks();
});

describe('reportNestedModal', () => {
	it('is strict in the tests, so a nested dialog fails every test that opens one', () => {
		expect(nestedModalIsStrict()).toBe(true);
	});

	it('throws when strict and names both dialogs', () => {
		expect(() => reportNestedModal('Wiederholen…', 'TASK-3 · Steuer', true)).toThrow(
			new NestedModalError(
				'Kein Dialog aus einem Dialog (ADR-0025 §3): „Wiederholen…“ öffnet in „TASK-3 · Steuer“.'
			)
		);
	});

	it('only logs in the app, so the user is never stuck, without the titles (ticket content)', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(() => reportNestedModal('Wiederholen…', 'TASK-3 · Steuer', false)).not.toThrow();
		expect(log).toHaveBeenCalledExactlyOnceWith(NESTED_MODAL_LOG);
		expect(NESTED_MODAL_LOG).toBe(
			'Kein Dialog aus einem Dialog (ADR-0025 §3): ein Modal öffnet in einem anderen.'
		);
	});
});

describe('the modal building block as guard', () => {
	it('lets a closed modal stand inside an open one', () => {
		expect(() => render(NestedModalHarness)).not.toThrow();
	});

	it('refuses a modal that is open inside an open one from the start', () => {
		expect(() => render(NestedModalHarness, { props: { innerOpen: true } })).toThrow(
			NestedModalError
		);
	});

	it('refuses a modal that opens later inside an open one', () => {
		const { component } = render(NestedModalHarness);
		expect(() => flushSync(() => component.openInner())).toThrow(
			'„Zweiter Dialog“ öffnet in „Vollansicht“'
		);
	});
});
