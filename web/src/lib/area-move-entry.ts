// The entry "In den Haushalt verschieben …" or "Ins Private verschieben …" of a menu (E7-4, ADR-0060):
// only for an account in a household and only with the right for every record (domain/area-move.ts
// moveDirection); it opens the dialog of the layout with the preview of the server. Menus of tickets,
// projects, rules and entries of the inbox and the bulk action of the table "Aufgaben" use it. Outside
// the (app) layout (tests of single components) there is no entry.

import { auth } from '$lib/auth.svelte';
import {
	MOVE_TEXTS,
	moveDirection,
	type MoveDirection,
	type MoveKind
} from '$lib/domain/area-move';
import { meOf } from '$lib/domain/household';
import { findAreaMoveStore } from '$lib/stores/area-move.svelte';
import { findAreaStore } from '$lib/stores/area.svelte';
import { findHouseholdStore } from '$lib/stores/household.svelte';

/** What a menu would move: records of one kind with their creator, and how the dialog names them. */
export interface MoveTarget {
	kind: MoveKind;
	records: readonly { id: string; owner?: string }[];
	label: string;
}

/** The entry of the menu: its text and what it does. */
export interface MoveEntry {
	label: string;
	run: () => void;
}

export interface AreaMover {
	/** The entry for `target`, or null when the account may not move it. `inline`: the full view. */
	entry(target: MoveTarget, options?: { inline?: boolean }): MoveEntry | null;
}

/** The mover of the (app) layout; call it while a component starts (it reads the context). */
export function areaMover(): AreaMover {
	const area = findAreaStore();
	const household = findHouseholdStore();
	const store = findAreaMoveStore();
	return {
		entry(target, options = {}) {
			if (area === null || household === null || store === null) return null;
			const state = household.household;
			if (household.state !== 'ready' || state === null || target.records.length === 0) {
				return null;
			}
			const membership = meOf(state);
			let to: MoveDirection | null = null;
			for (const record of target.records) {
				const direction = moveDirection({
					area: area.active,
					membership,
					userId: auth.userId,
					owner: record.owner
				});
				if (direction === null || (to !== null && direction !== to)) return null;
				to = direction;
			}
			if (to === null) return null;
			const direction = to;
			return {
				label: MOVE_TEXTS.action[direction],
				run: () =>
					store.open({
						kind: target.kind,
						ids: target.records.map((record) => record.id),
						to: direction,
						label: target.label,
						...(options.inline === true && { inline: true })
					})
			};
		}
	};
}
