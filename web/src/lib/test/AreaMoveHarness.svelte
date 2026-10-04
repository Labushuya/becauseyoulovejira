<script lang="ts">
	import { areaMover, type MoveTarget } from '$lib/area-move-entry';
	import AreaMoveDialog from '$lib/components/AreaMoveDialog.svelte';
	import TicketActions from '$lib/components/TicketActions.svelte';
	import { setAreaMoveStore, type AreaMoveStore } from '$lib/stores/area-move.svelte';
	import { setAreaStore, type AreaStore } from '$lib/stores/area.svelte';
	import { SILENT_FLAGS } from '$lib/stores/flags.svelte';
	import { setHouseholdStore, type HouseholdStore } from '$lib/stores/household.svelte';

	// Tests: the menu of a ticket and the dialog of a move with the stores of the (app) layout in the
	// context (E7-4, ADR-0061); `bulk` shows the entry of the bulk action for several records.
	let {
		area,
		household,
		moves,
		ticket,
		bulk = null
	}: {
		area: AreaStore;
		household: HouseholdStore;
		moves: AreaMoveStore;
		ticket: { id: string; key: string; owner?: string };
		bulk?: MoveTarget | null;
	} = $props();
	// svelte-ignore state_referenced_locally
	setAreaStore(area);
	// svelte-ignore state_referenced_locally
	setHouseholdStore(household);
	// svelte-ignore state_referenced_locally
	setAreaMoveStore(moves);
	const mover = areaMover();
	const bulkEntry = $derived(bulk === null ? null : mover.entry(bulk));
</script>

<TicketActions {ticket} flags={SILENT_FLAGS} ondelete={() => undefined} />
<p data-testid="bulk">{bulkEntry?.label ?? 'kein Eintrag'}</p>
{#if moves.request !== null && moves.request.inline !== true}
	<AreaMoveDialog store={moves} />
{/if}
