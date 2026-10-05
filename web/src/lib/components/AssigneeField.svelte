<script lang="ts">
	import { NOBODY_LABEL, assigneeName, type AssigneeContext } from '$lib/domain/assignee';
	import type { AssigneeChoice } from '$lib/stores/assignees.svelte';
	import AssigneeBadge from './AssigneeBadge.svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// "Zuständig" of a ticket of the household (E7-5, ADR-0068 §1): a native select with "Niemand" and
	// the members (the own account first), saved at once like the priority, and "Ich übernehme" as one
	// click while the ticket is not the own one. Every member may change it; the server checks the
	// membership. An assignee who is no member any more (only until the server clears him) stays
	// selectable with his name, so the select never shows another value than the ticket has.
	let {
		id,
		value,
		members,
		context,
		busy = false,
		error = null,
		errorId,
		describedBy,
		onchoose
	}: {
		id: string;
		/** The account, '' for nobody. */
		value: string;
		members: readonly AssigneeChoice[];
		context: AssigneeContext;
		/** A save is running; the controls stay usable, so the keyboard focus stays. */
		busy?: boolean;
		error?: string | null;
		errorId: string;
		/** Further IDs that describe the select (the label of the grid). */
		describedBy?: string;
		onchoose: (value: string) => void;
	} = $props();

	const selfId = $derived(context.selfId);
	const selfIsMember = $derived(members.some((member) => member.id === selfId));
	const unknown = $derived(value !== '' && !members.some((member) => member.id === value));
	const describedby = $derived(
		[error ? errorId : '', describedBy ?? ''].filter((part) => part !== '').join(' ') || undefined
	);
</script>

<div class="assignee-field">
	<div class="row">
		<AssigneeBadge assignee={value} {context} />
		<select
			{id}
			{value}
			aria-busy={busy ? 'true' : undefined}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedby}
			onchange={(event) => onchoose(event.currentTarget.value)}
		>
			<option value="">{NOBODY_LABEL}</option>
			{#each members as member (member.id)}
				<option value={member.id}>{member.self ? `${member.name} (ich)` : member.name}</option>
			{/each}
			{#if unknown}
				<option {value}>{assigneeName(value, context)}</option>
			{/if}
		</select>
		{#if selfId !== null && selfIsMember && value !== selfId}
			<button
				class="button-secondary button-small"
				type="button"
				aria-busy={busy ? 'true' : undefined}
				onclick={() => onchoose(selfId)}>Ich übernehme</button
			>
		{/if}
	</div>
	{#if error}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
</div>

<style>
	.assignee-field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.row select {
		width: fit-content;
		max-width: 100%;
	}
</style>
