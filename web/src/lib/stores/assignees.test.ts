// The directory of assignees (E7-5, ADR-0068): active only while the tab shows a household, the
// members with the own account first and the others by name, and the names of members, else of the
// visible accounts of the layout.

import { describe, expect, it } from 'vitest';
import type { HouseholdState } from '$lib/domain/household';
import { AssigneeDirectory, fixedAssignees } from './assignees.svelte';

const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const CLARA = 'clar00000000003';

function member(user: string, name: string) {
	return { id: `m${user}`, user, name, role: 'member', rights: [], self: user === SELF };
}

function household(): HouseholdState {
	return {
		members: [member(CLARA, 'Clara Beispiel'), member(BERT, ''), member(SELF, 'Anna Beispiel')]
	} as unknown as HouseholdState;
}

describe('AssigneeDirectory', () => {
	it('offers the members of the household, the own account first', () => {
		const directory = new AssigneeDirectory({ userId: SELF, name: 'Anna Beispiel' });
		expect(directory.active).toBe(false);
		expect(directory.members).toEqual([]);

		directory.connect({
			area: { active: 'household' },
			household: { household: household() },
			people: { nameOf: (id) => (id === 'gone00000000009' ? 'Dora Beispiel' : null) }
		});

		expect(directory.active).toBe(true);
		expect(directory.members).toEqual([
			{ id: SELF, name: 'Anna Beispiel', self: true },
			{ id: CLARA, name: 'Clara Beispiel', self: false },
			{ id: BERT, name: 'Konto ohne Namen', self: false }
		]);
		expect(directory.nameOf(CLARA)).toBe('Clara Beispiel');
		expect(directory.nameOf('gone00000000009')).toBe('Dora Beispiel');
		expect(directory.nameOf('none00000000010')).toBeNull();
		expect(directory.context.selfId).toBe(SELF);
		expect(directory.context.selfName).toBe('Anna Beispiel');
	});

	it('is not active in the private area or without a household', () => {
		const directory = new AssigneeDirectory({ userId: SELF, name: '' });
		directory.connect({ area: { active: 'private' }, household: { household: household() } });
		expect(directory.active).toBe(false);
		directory.connect({ area: { active: 'household' }, household: { household: null } });
		expect(directory.active).toBe(false);
	});

	it('gives tests a fixed source', () => {
		const source = fixedAssignees([{ id: BERT, name: 'Bert Beispiel', self: false }], SELF, false);
		expect(source.active).toBe(false);
		expect(source.context.names?.nameOf(BERT)).toBe('Bert Beispiel');
		expect(source.context.selfName).toBe('');
	});
});
