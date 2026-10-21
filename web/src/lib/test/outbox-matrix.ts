// The shared helpers of the scenario matrices of the outbox (OF-3b, OF-4a, OF-4b; split into three files
// in round 2 of OF-4b, K-6): offline/outbox-matrix.test.ts ("Verwerfen" of changes), offline/
// outbox-matrix-create.test.ts (the class "Anlegen") and offline/outbox-matrix-comments.test.ts (the
// class "Kommentare"). A random source with a fixed seed, what a run reports, and the drain of the
// outbox once the connection is back. Like the oracles, nothing here reads the code it checks: only what
// the dialog shows of an action (its state and what it waits for) and the harness of
// $lib/test/outbox-fake.ts.

import { vi } from 'vitest';
import type { CalendarDate } from '$lib/domain/berlin-date';
import type { KeptAction } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Harness } from './outbox-fake';

/** A due date the user sets. */
export const D1: CalendarDate = '2026-10-22';
/** Values someone else sets: never one the user picks, so a conflict is a real one. */
export const FOREIGN = { status: 'waiting' as Status, due: '2026-11-30' as CalendarDate };

/** What a run checks: the invariants I1 to I4 and that nothing hangs (C1 to C4 count under I3). */
export const CHECKS = ['i1', 'i2', 'i3', 'i4', 'hang'] as const;

/** What a run found broken, per check. */
export interface Outcome {
	i1: string[];
	i2: string[];
	i3: string[];
	i4: string[];
	hang: string[];
}

/** A small random source with a fixed seed (mulberry32), so the drawn runs are always the same. */
export function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function pick<T>(random: () => number, list: readonly T[]): T {
	return list[Math.floor(random() * list.length)] as T;
}

export function times<T>(count: number, make: () => T): T[] {
	return Array.from({ length: count }, make);
}

/** Waits for a decision of the user, as the dialog shows it: a conflict, a refusal, older than 48 h. */
export function decides(action: KeptAction): boolean {
	return action.state === 'conflict' || action.state === 'refused' || action.state === 'expired';
}

/**
 * Whether the outbox rests: every action waits for a decision of the user or for an action before it
 * that is still there. Nothing moves then until the user decides; an action that waits for its time
 * (after a 5xx, the next lookup of a creation) or is under way does not rest.
 */
export function resting(actions: readonly KeptAction[]): boolean {
	const present = new Set(actions.map((action) => action.op));
	return actions.every(
		(action) =>
			decides(action) ||
			(action.state === 'queued' && action.dependsOn.some((op) => present.has(op)))
	);
}

/**
 * Lets the clock run in steps of a minute and a second until the outbox rests (K-6), at most `rounds`
 * of them: six cover the lookup 5 minutes after the last request of a creation (OF-4a round 2, A5).
 */
export async function drain(h: Harness, rounds: number): Promise<void> {
	for (let round = 0; round < rounds && !resting(h.outbox.actions); round++) {
		await vi.advanceTimersByTimeAsync(61_000);
	}
}
