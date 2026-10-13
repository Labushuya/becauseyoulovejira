// The question of one place (VH-1): an action runs at once for tasks, after "Abschließen" for an
// open ongoing project, never after "Abbrechen"; a new question answers an open one.

import { describe, expect, it, vi } from 'vitest';
import { OngoingFinishAsk } from './ongoing-finish.svelte';

const project = { key: 'HAUS-7', title: 'Spanisch lernen', status: 'open', kind: 'ongoing' };
const task = { key: 'HAUS-8', title: 'Fenster putzen', status: 'open', kind: 'task' };

describe('OngoingFinishAsk (VH-1)', () => {
	it('runs the action of a task at once, without a question, and gives its result back', () => {
		const ask = new OngoingFinishAsk();
		const action = vi.fn(() => 'erledigt');
		expect(ask.run([task], action)).toBe('erledigt');
		expect(action).toHaveBeenCalledTimes(1);
		expect(ask.question).toBeNull();
	});

	it('asks for an open ongoing project and runs the action only after "Abschließen"', async () => {
		const ask = new OngoingFinishAsk();
		const action = vi.fn(async () => true);
		const result = ask.run([project], action);
		expect(action).not.toHaveBeenCalled();
		expect(ask.question).toEqual({
			projects: [{ key: 'HAUS-7', title: 'Spanisch lernen' }],
			total: 1
		});
		ask.accept();
		expect(ask.question).toBeNull();
		await expect(result).resolves.toBe(true);
		expect(action).toHaveBeenCalledTimes(1);
	});

	it('runs nothing after "Abbrechen"', async () => {
		const ask = new OngoingFinishAsk();
		const action = vi.fn(() => true);
		const result = ask.run([task, project], action);
		expect(ask.question?.total).toBe(2);
		ask.cancel();
		await expect(result).resolves.toBeNull();
		expect(action).not.toHaveBeenCalled();
		expect(ask.question).toBeNull();
	});

	it('answers an open question with "Abbrechen" when a new one comes, and counts a bulk action', async () => {
		const ask = new OngoingFinishAsk();
		const first = vi.fn();
		const second = vi.fn();
		const before = ask.run([project], first);
		const after = ask.run([project, task], second, 5);
		await expect(before).resolves.toBeNull();
		expect(ask.question?.total).toBe(5);
		ask.accept();
		await after;
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});
