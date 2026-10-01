// Backups that need attention (ADR-0046, ADR-0035): one quiet info flag with "Ansehen" when the
// server says so, never two at once, none without a warning.

import { describe, expect, it, vi } from 'vitest';
import { BackupAttention } from './backup-attention';
import type { FlagInput } from './flags.svelte';

function setup(answers: boolean[]) {
	const flags = {
		show: vi.fn((input: FlagInput) => `flag-${flags.show.mock.calls.length}-${input.tone}`),
		dismiss: vi.fn()
	};
	const open = vi.fn();
	const check = vi.fn(async () => answers.shift() ?? false);
	return { attention: new BackupAttention({ check, flags, open }), flags, open, check };
}

describe('BackupAttention', () => {
	it('shows nothing without a warning', async () => {
		const { attention, flags, check } = setup([false]);
		await attention.announce();
		expect(check).toHaveBeenCalledTimes(1);
		expect(flags.show).not.toHaveBeenCalled();
	});

	it('shows one info flag that opens the page', async () => {
		const { attention, flags, open } = setup([true]);
		await attention.announce();
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({
				tone: 'info',
				title: 'Die Sicherung braucht deine Aufmerksamkeit.',
				action: expect.objectContaining({ label: 'Ansehen' })
			})
		);
		flags.show.mock.calls[0]?.[0].action?.run();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('replaces its own flag when the app is opened again', async () => {
		const { attention, flags } = setup([true, true]);
		await attention.announce();
		await attention.announce();
		expect(flags.dismiss).toHaveBeenCalledWith('flag-1-info');
		expect(flags.show).toHaveBeenCalledTimes(2);
	});
});
