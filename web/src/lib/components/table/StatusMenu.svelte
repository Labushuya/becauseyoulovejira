<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { STATUSES, type Status } from '$lib/domain/status';
	import StatusPill from '../StatusPill.svelte';
	import EditableCell from './EditableCell.svelte';
	import MenuChoice from './MenuChoice.svelte';

	// The status of a ticket as a menu (plan BI-3, ADR-0036 §6): the pill is the button, the menu
	// offers every status with the current one checked. A choice closes the menu first (the focus goes
	// back to the button), then `onchoose` saves; the caller decides what "Erledigt" means (the store
	// sends it through setDone with "Rückgängig"). The cell "Status" of the ticket table and, since
	// UT-1 (ADR-0033 addendum UT-1), every sub-task in the section "Unteraufgaben" use it.
	let {
		ticketKey,
		status,
		busy = false,
		onchoose
	}: {
		/** Key of the ticket, for the names: "Status von HAUS-12: Offen, ändern". */
		ticketKey: string;
		status: Status;
		/** A save of this ticket runs. */
		busy?: boolean;
		onchoose: (status: Status) => void;
	} = $props();
</script>

<EditableCell
	kind="menu"
	label={`Status von ${ticketKey}`}
	buttonLabel={`Status von ${ticketKey}: ${STATUS_LABELS[status]}, ändern`}
	{busy}
>
	{#snippet value()}<StatusPill {status} />{/snippet}
	{#snippet editor({ close })}
		{#each STATUSES as value (value)}
			<MenuChoice
				checked={value === status}
				text={STATUS_LABELS[value]}
				onchoose={() => {
					close();
					onchoose(value);
				}}
			/>
		{/each}
	{/snippet}
</EditableCell>
