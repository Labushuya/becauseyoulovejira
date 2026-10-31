// The question at the first start of the phone view (package "Einschalten", ADR-0074 addendum
// "Zustimmung je Gerät"): a modal named by the question, described by the announcement and what the
// answer means; the focus on "Nein" as on the safe button of a confirmation; "Ja, merken" and "Nein"
// answer, Escape and × leave it without an answer.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { OFFLINE_CONSENT_TEXTS } from '$lib/domain/offline-consent';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import OfflineConsentDialog from './OfflineConsentDialog.svelte';

useOverlayStubs();

function show() {
	const onanswer = vi.fn();
	const ondismiss = vi.fn();
	const { unmount } = render(OfflineConsentDialog, { onanswer, ondismiss });
	return { onanswer, ondismiss, unmount };
}

describe('the question about keeping changes without a connection', () => {
	it('is a dialog named by the question and described by the announcement and the meaning', async () => {
		show();
		await tick();
		const dialog = screen.getByRole('dialog', { name: OFFLINE_CONSENT_TEXTS.title });
		const described = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
		const text = described?.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(text).toContain(OFFLINE_CONSENT_TEXTS.announcement);
		expect(text).toContain(OFFLINE_CONSENT_TEXTS.explanation);
		expect(
			within(dialog)
				.getAllByRole('button')
				.map((button) => button.textContent?.trim() || button.getAttribute('aria-label'))
		).toEqual(['Schließen', 'Nein', 'Ja, merken']);
		for (const button of within(dialog).getAllByRole('button')) {
			expect(button.getAttribute('type')).toBe('button');
		}
	});

	it('starts with the focus on "Nein"', async () => {
		show();
		await tick();
		await tick();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nein' }));
	});

	it('answers "yes" with "Ja, merken" and "no" with "Nein"', async () => {
		const first = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Ja, merken' }));
		expect(first.onanswer).toHaveBeenCalledExactlyOnceWith('yes');
		expect(first.ondismiss).not.toHaveBeenCalled();
		first.unmount();

		const second = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Nein' }));
		expect(second.onanswer).toHaveBeenCalledExactlyOnceWith('no');
		expect(second.ondismiss).not.toHaveBeenCalled();
	});

	it('leaves it without an answer on Escape and on ×, so the next start asks again', async () => {
		const first = show();
		await tick();
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(first.ondismiss).toHaveBeenCalledOnce();
		expect(first.onanswer).not.toHaveBeenCalled();
		first.unmount();

		const second = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(second.ondismiss).toHaveBeenCalledOnce();
		expect(second.onanswer).not.toHaveBeenCalled();
	});
});
