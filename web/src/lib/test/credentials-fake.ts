// Fake data layer of the access data of the channels (BW-3, ADR-0075) for component tests: the
// state of the variables as the server answers it, "Setzen" and "Entfernen" that answer like the
// route (the value is only seen by the spy), and the hint until the next restart. The store gets a
// session that stays valid.

import { vi } from 'vitest';
import type { CredentialAnswer, CredentialChange } from '$lib/data/credentials';
import type { CredentialStatus, CredentialVariable } from '$lib/domain/credentials';
import { CredentialsStore, type CredentialsData } from '$lib/stores/credentials.svelte';

export const okAnswer = <T>(value: T): CredentialAnswer<T> => ({ kind: 'ok', value });

/** A variable of the state; set and without channels unless given. */
export function variableOf(
	name: string,
	overrides: Partial<CredentialVariable> = {}
): CredentialVariable {
	return { name, set: true, blocked: false, channels: [], ...overrides };
}

/**
 * A data layer with spies on `variables`: "Setzen" and "Entfernen" change the state and set the
 * mark of the restart, as the server does; `notice` answers that mark.
 */
export function fakeCredentialsData(variables: CredentialVariable[] = [], restartNeeded = false) {
	const state = new Map(variables.map((variable) => [variable.name, { ...variable }]));
	let needed = restartNeeded;
	const status = (): CredentialStatus => ({
		variables: [...state.values()].map((variable) => ({ ...variable })),
		restartNeeded: needed
	});
	const change = (name: string, set: boolean): CredentialAnswer<CredentialChange> => {
		const known = state.get(name);
		state.set(name, { name, set, blocked: false, channels: known?.channels ?? [] });
		needed = true;
		return okAnswer({ name, set, restartNeeded: true });
	};
	return {
		status: vi.fn<CredentialsData['status']>(async () => okAnswer(status())),
		set: vi.fn<CredentialsData['set']>(async (name) => change(name, true)),
		remove: vi.fn<CredentialsData['remove']>(async (name) => change(name, false)),
		notice: vi.fn<CredentialsData['notice']>(async () => okAnswer(needed)),
		/** The server restarted: the mark in its memory is gone. */
		restarted: () => {
			needed = false;
		}
	} satisfies CredentialsData & { restarted: () => void };
}

export type FakeCredentialsData = ReturnType<typeof fakeCredentialsData>;

/** The store on a fake data layer with a valid session. */
export function credentialsStoreOf(
	data: CredentialsData = fakeCredentialsData()
): CredentialsStore {
	return new CredentialsStore(data, { ensureValid: () => true, logout: vi.fn() });
}
