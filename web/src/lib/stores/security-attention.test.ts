// Failed sign-ins that need attention (ADR-0055 §8, ADR-0035): one quiet info flag with "Ansehen"
// from ten failures within 24 hours, once per newest failure on this device, none on a failure of
// the question or for an account that may not ask.

import { describe, expect, it, vi } from 'vitest';
import type { SecurityNotice } from '$lib/domain/security';
import type { FlagInput } from './flags.svelte';
import { SEEN_KEY, SecurityAttention } from './security-attention';

function setup(answers: (SecurityNotice | null)[]) {
	const flags = {
		show: vi.fn((input: FlagInput) => `flag-${flags.show.mock.calls.length}-${input.tone}`),
		dismiss: vi.fn()
	};
	const open = vi.fn();
	const stored = new Map<string, string>();
	const storage = {
		getItem: vi.fn((key: string) => stored.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => void stored.set(key, value))
	};
	const check = vi.fn(async () => answers.shift() ?? null);
	return { attention: new SecurityAttention({ check, flags, open, storage }), flags, open, stored };
}

const notice = (count: number, last: string): SecurityNotice => ({
	attention: count >= 10,
	count,
	last
});

describe('SecurityAttention', () => {
	it('shows nothing below ten failures, nor when the question fails', async () => {
		const { attention, flags } = setup([notice(9, '2026-10-03 09:00:00.000Z'), null]);
		await attention.announce();
		await attention.announce();
		expect(flags.show).not.toHaveBeenCalled();
	});

	it('shows one info flag that opens the protocol, once per newest failure', async () => {
		const { attention, flags, open, stored } = setup([
			notice(12, '2026-10-03 09:00:00.000Z'),
			notice(12, '2026-10-03 09:00:00.000Z'),
			notice(13, '2026-10-03 09:30:00.000Z')
		]);
		await attention.announce();
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({
				tone: 'info',
				title: '12 fehlgeschlagene Anmeldeversuche in den letzten 24 Stunden.',
				action: expect.objectContaining({ label: 'Ansehen' })
			})
		);
		expect(stored.get(SEEN_KEY)).toBe('2026-10-03 09:00:00.000Z');
		flags.show.mock.calls[0]?.[0].action?.run();
		expect(open).toHaveBeenCalledOnce();
		// The same newest failure again: no second flag.
		await attention.announce();
		expect(flags.show).toHaveBeenCalledOnce();
		// A newer one: the flag comes again and replaces the old one.
		await attention.announce();
		expect(flags.dismiss).toHaveBeenCalledWith('flag-1-info');
		expect(flags.show.mock.calls[1]?.[0].title).toBe(
			'13 fehlgeschlagene Anmeldeversuche in den letzten 24 Stunden.'
		);
	});
});
