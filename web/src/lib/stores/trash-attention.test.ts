// Tickets of the trash that wait for a decision (ADR-0047, ADR-0035): one quiet info flag with
// "Ansehen" while some exist, never two at once, none without them or on a failure. Only tickets
// with dependencies whose retention ran out count.

import { describe, expect, it, vi } from 'vitest';
import { waitingCount, type TrashItem } from '$lib/domain/trash';
import type { FlagInput } from './flags.svelte';
import { TrashAttention } from './trash-attention';

function setup(answers: (number | Error)[]) {
	const flags = {
		show: vi.fn((input: FlagInput) => `flag-${flags.show.mock.calls.length}-${input.tone}`),
		dismiss: vi.fn()
	};
	const open = vi.fn();
	const waiting = vi.fn(async () => {
		const answer = answers.shift() ?? 0;
		if (answer instanceof Error) throw answer;
		return answer;
	});
	return { attention: new TrashAttention({ waiting, flags, open }), flags, open };
}

describe('TrashAttention', () => {
	it('shows nothing while no ticket waits, nor on a failure', async () => {
		const { attention, flags } = setup([0, new Error('offline')]);
		await attention.announce();
		await attention.announce();
		expect(flags.show).not.toHaveBeenCalled();
	});

	it('shows one info flag that opens the trash, and replaces it when the app opens again', async () => {
		const { attention, flags, open } = setup([2, 1]);
		await attention.announce();
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({
				tone: 'info',
				title: '2 Tickets im Papierkorb warten auf eine Entscheidung.',
				action: expect.objectContaining({ label: 'Ansehen' })
			})
		);
		flags.show.mock.calls[0]?.[0].action?.run();
		expect(open).toHaveBeenCalledOnce();
		await attention.announce();
		expect(flags.dismiss).toHaveBeenCalledWith('flag-1-info');
		expect(flags.show.mock.calls[1]?.[0].title).toBe(
			'1 Ticket im Papierkorb wartet auf eine Entscheidung.'
		);
	});

	it('counts only blocked tickets whose retention ran out', () => {
		const item = (dependencies: number, daysLeft: number | null) =>
			({ dependencies, daysLeft }) as TrashItem;
		expect(waitingCount([item(2, 0), item(0, 0), item(1, 3), item(1, null), item(1, 0)])).toBe(2);
	});
});
