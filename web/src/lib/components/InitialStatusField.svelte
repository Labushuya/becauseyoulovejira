<script lang="ts" module>
	/** Name of the field, the same in every place a rule is created or edited. */
	export const INITIAL_STATUS_LABEL = 'Status beim Anlegen';
	/** Text of the empty option while nothing is chosen (a new rule). */
	export const INITIAL_STATUS_PLACEHOLDER = 'Bitte wählen';
</script>

<script lang="ts">
	import {
		TEMPLATE_STATUSES,
		initialStatusLabels,
		isTemplateStatus,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import { STATUS_LABELS } from '$lib/domain/labels';
	import Field from './form/Field.svelte';
	import StatusSelect from './StatusSelect.svelte';

	// "Status beim Anlegen" of a rule (ADR-0022 addenda 8, 9 and 17; RG-1): one control wherever it is
	// chosen, the select of every status of an open ticket in their usual order, in a Field. Editing
	// a rule (rule panel, template at the ticket) shows its stored value. Creating one ("Neue Regel",
	// "Wiederholen…", the section "Wiederholen" of "Neues Ticket") asks it as a required choice
	// without an answer in advance (decision of the user, ADR-0022 addendum 9): the select stands on
	// the empty option "Bitte wählen" until the user chooses, and the owner passes the error of a
	// missing answer, which stands at the field like every field error (ADR-0009). With a ticket the
	// status of the ticket is named ("In Arbeit (wie dieses Ticket)").
	let {
		value,
		ask = false,
		ticketStatus = null,
		error = null,
		id,
		busy = false,
		onchoose
	}: {
		/** The chosen status; '' while none is chosen (only with `ask`). */
		value: TemplateStatus | '';
		/** A rule is created: a required choice without an answer in advance. */
		ask?: boolean;
		/** Status of the ticket the rule starts with; null for none. */
		ticketStatus?: string | null;
		/** Field error: no answer, or a refusal of the server. */
		error?: string | null;
		/** ID of the select; generated when missing. */
		id?: string;
		/** A save is running. */
		busy?: boolean;
		onchoose: (status: TemplateStatus) => void;
	} = $props();

	const hint = $derived(
		ask
			? 'Jedes neue Ticket der Serie beginnt mit diesem Status. Ändern kannst du ihn später an der Regel.'
			: `So startet jedes neue Ticket der Serie, Standard „${STATUS_LABELS.open}“.`
	);
	const labels = $derived(initialStatusLabels(ticketStatus));
</script>

<Field label={INITIAL_STATUS_LABEL} {id} {hint} error={error ?? ''} width="auto">
	{#snippet control(field)}
		<StatusSelect
			{field}
			{value}
			statuses={TEMPLATE_STATUSES}
			{labels}
			placeholder={ask ? INITIAL_STATUS_PLACEHOLDER : undefined}
			required={ask}
			{busy}
			onchoose={(chosen) => {
				if (isTemplateStatus(chosen)) onchoose(chosen);
			}}
		/>
	{/snippet}
</Field>
