// One fetch at a time (testing feedback package A, item 4): the loop waits, "Jetzt abrufen" does not.

import { describe, expect, it } from 'vitest';
import { PollGate } from './gate';

function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('PollGate', () => {
	it('runs tasks one after the other', async () => {
		const gate = new PollGate();
		const order: string[] = [];
		const first = deferred();
		const a = gate.run(async () => {
			order.push('a start');
			await first.promise;
			order.push('a end');
		});
		const b = gate.run(async () => {
			order.push('b');
		});
		await Promise.resolve();
		expect(order).toEqual(['a start']);
		expect(gate.busy).toBe(true);
		first.resolve();
		await Promise.all([a, b]);
		expect(order).toEqual(['a start', 'a end', 'b']);
		expect(gate.busy).toBe(false);
	});

	it('refuses tryRun while a task runs or waits and takes it when free', async () => {
		const gate = new PollGate();
		const hold = deferred();
		const running = gate.run(() => hold.promise);
		expect(await gate.tryRun(async () => 'manual')).toBeNull();
		hold.resolve();
		await running;
		expect(await gate.tryRun(async () => 'manual')).toEqual({ value: 'manual' });
	});

	it('frees the gate after a failed task', async () => {
		const gate = new PollGate();
		await expect(gate.run(async () => Promise.reject(new Error('kaputt')))).rejects.toThrow('kaputt');
		expect(gate.busy).toBe(false);
		expect(await gate.tryRun(async () => 1)).toEqual({ value: 1 });
	});
});
