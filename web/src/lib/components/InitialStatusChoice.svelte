<script lang="ts">
	import {
		initialStatusOptions,
		type InitialStatusOption,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import ErrorIcon from './ErrorIcon.svelte';

	// "Folgetickets starten mit" (ADR-0022 addendum 9, decision of the user: ask with which status
	// the next tickets start): a required radio group whenever a user creates a rule ("Wiederholen…",
	// the section "Wiederholen" of "Neues Ticket", "Neue Regel"). "Offen" and, when it differs, the
	// status of the ticket ("Wie dieses Ticket: In Arbeit") first, the other statuses below a line.
	// Nothing is chosen in advance; the owner checks that an answer was given and passes the error,
	// which stands at the group like every field error (ADR-0009). The answer is stored as "Status
	// beim Anlegen" of the rule and can be changed there later.
	let {
		value = $bindable(''),
		ticketStatus = null,
		error = null
	}: {
		/** The chosen status; '' while none is chosen. */
		value: TemplateStatus | '';
		/** Status of the ticket the rule starts with; null for "Neue Regel". */
		ticketStatus?: string | null;
		/** Field error: no answer, or a refusal of the server. */
		error?: string | null;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;
	const options = $derived(initialStatusOptions(ticketStatus));
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
	<legend>Folgetickets starten mit</legend>
	<p class="hint" id={hintId}>
		Jedes neue Ticket der Serie beginnt mit diesem Status („Status beim Anlegen“). Ändern kannst du
		ihn später an der Regel.
	</p>
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
