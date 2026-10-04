// The area of the tab (E7-3, ADR-0059 §1 and §2): "Privat" or the household of the account, like a
// virtual desktop. The (app) layout creates the store before every other store and gives it the
// client of the app (`apply` sets data/area.ts), so lists, counts, choices and subscriptions ask only
// for the area, and new records land in it. The choice is remembered per device and account in
// localStorage; it applies at once when the app opens and is checked against the household of the
// account as soon as the household store knows it. Without a household there is no choice: the area
// is "Privat", and instead of the switch the header shows "Privat" with a "+" to a household (only
// once the household store knows there is none, `known`).
//
// Every change calls `changed` with its cause, so the layout loads the stores of the area again (no
// page reload) and says what happened: the switch, a link into the other area ("Zum Bereich …
// gewechselt"), or a household that is gone.

import { createContext } from 'svelte';
import {
	AREA_TEXTS,
	PRIVATE_CHOICE,
	areaChoiceValue,
	areaStorageKey,
	householdOfScope,
	isAreaScope,
	parseAreaChoice,
	privateScope,
	resolveChoice,
	scopeOfChoice,
	type AreaChoice,
	type AreaKind
} from '$lib/domain/area';
import type { StorageSource } from './first-steps.svelte';

/** The household of the account as far as the area needs it. */
export interface AreaHousehold {
	id: string;
	name: string;
}

/** Why the area changed: the switch, a link into the other area, or the household of the account. */
export type AreaChangeCause = 'switch' | 'link' | 'household';

function sameChoice(a: AreaChoice, b: AreaChoice): boolean {
	return (
		a.kind === b.kind &&
		(a.kind === 'private' || (b.kind === 'household' && a.household === b.household))
	);
}

export class AreaStore {
	readonly #storage: StorageSource;
	readonly #apply: (scope: string | null) => void;
	readonly #changed: (cause: AreaChangeCause) => void;
	#userId = $state<string | null>(null);
	#choice = $state.raw<AreaChoice>(PRIVATE_CHOICE);
	#household = $state.raw<AreaHousehold | null>(null);
	#known = $state(false);
	#key = $derived(this.#scopeOf(this.#choice) ?? '');

	/**
	 * `apply` sets the area of the client (null: none), `changed` loads the stores again after a
	 * change; `storage` keeps the choice of this device.
	 */
	constructor(
		storage: StorageSource,
		apply: (scope: string | null) => void,
		changed: (cause: AreaChangeCause) => void = () => undefined
	) {
		this.#storage = storage;
		this.#apply = apply;
		this.#changed = changed;
	}

	/**
	 * Starts for the signed-in account: the remembered choice of this device applies at once, a
	 * household only until the household store says the account is not (any more) a member.
	 */
	begin(userId: string | null | undefined): void {
		this.#userId = typeof userId === 'string' && userId !== '' ? userId : null;
		let remembered: AreaChoice | null = null;
		if (this.#userId !== null) {
			try {
				remembered = parseAreaChoice(this.#storage()?.getItem(areaStorageKey(this.#userId)));
			} catch {
				remembered = null;
			}
		}
		this.#choice = remembered ?? PRIVATE_CHOICE;
		this.#apply(this.#scopeOf(this.#choice));
	}

	/** Scope of a choice for the account, null without an account (or with an ID of another form). */
	#scopeOf(choice: AreaChoice): string | null {
		if (this.#userId === null) return null;
		const scope = scopeOfChoice(choice, this.#userId);
		return isAreaScope(scope) ? scope : null;
	}

	/** Scope of the area (`u:<account>` or `h:<household>`), '' without an account. */
	get key(): string {
		return this.#key;
	}

	get active(): AreaKind {
		return this.#choice.kind;
	}

	/** The household of the account, null without one or while it is not known. */
	get household(): AreaHousehold | null {
		return this.#household;
	}

	/** Whether there is a choice: the account is a member of a household (criterion of the switch). */
	get visible(): boolean {
		return this.#household !== null;
	}

	/**
	 * Whether the household store said yet if the account has a household; false while it loads (or
	 * could not load), so a member never sees the "+" for a household for a moment.
	 */
	get known(): boolean {
		return this.#known;
	}

	/** Name of the active area: "Privat" or the name of the household. */
	get name(): string {
		return this.#choice.kind === 'private'
			? AREA_TEXTS.private
			: (this.#household?.name ?? 'Haushalt');
	}

	/**
	 * The household of the account as the household store knows it (null: none). A chosen household
	 * the account is not a member of gives way to "Privat". Returns true if the area changed.
	 */
	followHousehold(household: AreaHousehold | null): boolean {
		this.#household = household;
		this.#known = true;
		const resolved = resolveChoice(this.#choice, household?.id ?? null);
		if (sameChoice(resolved, this.#choice)) return false;
		this.#set(resolved, 'household');
		return true;
	}

	/** The switch: "Privat" or the household. Returns true if the area changed. */
	select(kind: AreaKind): boolean {
		if (kind === 'household') {
			const household = this.#household;
			if (household === null) return false;
			return this.#switchTo({ kind: 'household', household: household.id }, 'switch');
		}
		return this.#switchTo(PRIVATE_CHOICE, 'switch');
	}

	/**
	 * A record of another area was opened (link, flag, calendar, ADR-0054): the area follows when it
	 * is "Privat" of the account or its household. Returns true if the area changed.
	 */
	showScope(scope: string): boolean {
		const userId = this.#userId;
		if (userId === null || scope === this.#key) return false;
		if (scope === privateScope(userId)) return this.#switchTo(PRIVATE_CHOICE, 'link');
		const household = householdOfScope(scope);
		if (household !== '' && household === this.#household?.id) {
			return this.#switchTo({ kind: 'household', household }, 'link');
		}
		return false;
	}

	#switchTo(choice: AreaChoice, cause: AreaChangeCause): boolean {
		if (sameChoice(choice, this.#choice)) return false;
		this.#set(choice, cause);
		return true;
	}

	#set(choice: AreaChoice, cause: AreaChangeCause): void {
		const userId = this.#userId;
		this.#choice = choice;
		if (userId === null) return;
		try {
			this.#storage()?.setItem(areaStorageKey(userId), areaChoiceValue(choice));
		} catch {
			// Without storage the choice lasts for this page.
		}
		this.#apply(this.#scopeOf(choice));
		this.#changed(cause);
	}
}

const [getAreaStore, setAreaStore, hasAreaStore] = createContext<AreaStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findAreaStore(): AreaStore | null {
	return hasAreaStore() ? getAreaStore() : null;
}

export { getAreaStore, setAreaStore };
