<script lang="ts">
	import {
		initialStatusOptions,
		type InitialStatusOption,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import ErrorIcon from './ErrorIcon.svelte';

	// "Status des Duplikats" (ADR-0045 §2): a required radio group without an answer in advance.
	// "Offen" and, when it differs, the status of the original ("Wie das Original: In Arbeit") first,
	// the other statuses below a line. The owner checks that an answer was given and passes the error,
	// which stands at the group like every field error (ADR-0009).
	// Until RG-1 a rule asked "Folgetickets starten mit" with this group as well; since then it asks
	// "Status beim Anlegen" in the select of the template (InitialStatusField, ADR-0022 addendum 17).
	let {
		value = $bindable(''),
		ticketStatus = null,
		error = null,
		legend,
		hint,
		like
	}: {
		/** The chosen status; '' while none is chosen. */
		value: TemplateStatus | '';
		/** Status of the ticket the new one is made from. */
		ticketStatus?: string | null;
		/** Field error: no answer, or a refusal of the server. */
		error?: string | null;
		/** Name of the group. */
		legend: string;
		/** What the answer means, below the name. */
		hint: string;
		/** How the answers name the ticket ("Wie das Original: …"). */
		like: string;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;
	const options = $derived(initialStatusOptions(ticketStatus, like));
	const first = $derived(options.filter((option) => option.first));
	const others = $derived(options.filter((option) => !option.first));
</script>

{#snippet radios(list: readonly InitialStatusOption[])}
	{#each list as option (option.value)}
		<label class="choice">
			<input type="radio" name={uid} value={option.value} bind:group={value} />
			{option.label}
		</label>
	{/each}
{/snippet}

<!-- The group carries the error (radios cannot); tabindex -1 lets the owner move the focus to it
     after a failed check, and Tab goes on to the first answer. -->
<fieldset
	class="initial-status"
	role="radiogroup"
	tabindex="-1"
	aria-required="true"
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={error ? `${hintId} ${errorId}` : hintId}
>
	<legend>{legend}</legend>
	<p class="hint" id={hintId}>{hint}</p>
	<div class="options">{@render radios(first)}</div>
	<div class="options others">{@render radios(others)}</div>
	{#if error}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
</fieldset>

<style>
	.initial-status {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.options {
		display: grid;
		gap: 0.375rem;
	}

	/* The other statuses below a fine line, after "Offen" and the status of the ticket. */
	.others {
		padding-top: 0.375rem;
		border-top: 1px solid var(--color-line);
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		width: fit-content;
		font-size: var(--font-size-body);
	}
</style>
