// Who can be "Zuständig" in the area of the tab and how the accounts are named (E7-5, ADR-0068): the
// members of the household of the account (from the household store, the own account first, then by
// name) and the names for initials, tooltips, groups and the sort (household members, else the people
// of the layout). The (app) layout creates the directory before the list store and connects the stores
// it reads once they exist; components take it from the context. Outside the layout (tests of single
// components) there is none, and components without one offer no field "Zuständig".

import { createContext } from 'svelte';
import type { AssigneeContext } from '$lib/domain/assignee';
import { memberLabel } from '$lib/domain/household';
import type { PersonNames } from '$lib/domain/people';
import type { AreaStore } from './area.svelte';
import type { HouseholdStore } from './household.svelte';

/** A member who can be chosen. */
export interface AssigneeChoice {
	id: string;
	/** Display name ("Konto ohne Namen" without one). */
	name: string;
	/** The signed-in account. */
	self: boolean;
}

/** What components need: whether the area offers assignees, the members and the names. */
export interface AssigneeSource {
	/** The tab shows the household: assignees are offered and shown there. */
	readonly active: boolean;
	/** The members of the household of the account, the own account first, then by name. */
	readonly members: readonly AssigneeChoice[];
	readonly context: AssigneeContext;
}

/** The signed-in account as the directory needs it (the `auth` of the app, or a test). */
export interface SelfAccount {
	readonly userId: string | null;
	readonly name: string;
}

/** The stores the directory reads; each optional, so it works before they exist. */
export interface AssigneeStores {
	area?: Pick<AreaStore, 'active'> | null;
	household?: Pick<HouseholdStore, 'household'> | null;
	people?: PersonNames | null;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export class AssigneeDirectory implements AssigneeSource, PersonNames {
	readonly #self: SelfAccount;
	#stores = $state.raw<AssigneeStores>({});

	constructor(self: SelfAccount) {
		this.#self = self;
	}

	/** Connects the stores of the layout once they exist. */
	connect(stores: AssigneeStores): void {
		this.#stores = { ...this.#stores, ...stores };
	}

	get active(): boolean {
		return (
			this.#stores.area?.active === 'household' &&
			(this.#stores.household?.household ?? null) !== null
		);
	}

	#members = $derived.by((): AssigneeChoice[] => {
		const state = this.#stores.household?.household ?? null;
		if (state === null) return [];
		const self = this.#self.userId;
		const members = state.members.map((member) => ({
			id: member.user,
			name: memberLabel(member),
			self: member.user === self
		}));
		return members.sort((a, b) => {
			if (a.self !== b.self) return a.self ? -1 : 1;
			return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
		});
	});

	get members(): readonly AssigneeChoice[] {
		return this.#members;
	}

	/** Name of an account: a member of the household, else a visible account of the layout. */
	nameOf(id: string): string | null {
		const member = this.#stores.household?.household?.members.find((entry) => entry.user === id);
		const name = member?.name.trim() ?? '';
		if (name !== '') return name;
		return this.#stores.people?.nameOf(id) ?? null;
	}

	get context(): AssigneeContext {
		return { selfId: this.#self.userId, selfName: this.#self.name, names: this };
	}
}

/** A fixed source for tests and components outside the layout. */
export function fixedAssignees(
	members: readonly AssigneeChoice[],
	selfId: string | null,
	active = true
): AssigneeSource {
	const self = members.find((member) => member.id === selfId);
	return {
		active,
		members,
		context: {
			selfId,
			selfName: self?.name ?? '',
			names: { nameOf: (id) => members.find((member) => member.id === id)?.name ?? null }
		}
	};
}

const [getAssignees, setAssignees, hasAssignees] = createContext<AssigneeDirectory>();

/** The directory of the (app) layout, or null outside it. */
export function findAssignees(): AssigneeSource | null {
	return hasAssignees() ? getAssignees() : null;
}

export { setAssignees };
