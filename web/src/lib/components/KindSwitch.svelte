<script lang="ts">
	import { helpHref } from '$lib/settings-sections';
	import ErrorIcon from './ErrorIcon.svelte';
	import NewTabHint from './guidance/NewTabHint.svelte';

	// The switch "Laufendes Vorhaben" (ADR-0065): the kind decides what the check mark of the day plan
	// means, said in the hint below it. One building block for the fields of a ticket (it saves at once
	// there) and "Neues Ticket" (NT-1, it is part of the request there). After a change the switch shows
	// `ongoing` again, so a refusal of the owner sets it back. Name left, switch right (ADR-0029 G-5).
	// Since VH-1 a second hint says when an ongoing project fits rather than a recurrence, with the
	// way to the comparison in the help; a new tab, so nothing typed in "Neues Ticket" is lost. The owner
	// may add a hint of its own (`describedby`, "Vom Hauptticket übernommen." in "Neues Ticket", UT-2).
	let {
		ongoing,
		busy = false,
		error = null,
		disabled = false,
		describedby: extra,
		onchange
	}: {
		ongoing: boolean;
		/** A save is running. */
		busy?: boolean;
		error?: string | null;
		disabled?: boolean;
		/** ID of a further hint of the owner that describes the switch. */
		describedby?: string;
		/** The wanted kind; the owner saves it or keeps it, `ongoing` then says what it is. */
		onchange: (ongoing: boolean) => void | Promise<unknown>;
	} = $props();

	const uid = $props.id();
	const ids = { hint: `${uid}-hint`, choice: `${uid}-choice`, error: `${uid}-error` };
	const describedby = $derived(
		[ids.hint, ids.choice, ...(error ? [ids.error] : []), ...(extra ? [extra] : [])].join(' ')
	);

	async function change(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		await onchange(input.checked);
		input.checked = ongoing;
	}
</script>

<div class="kind">
	<label class="switch-row">
		<span>Laufendes Vorhaben</span>
		<input
			type="checkbox"
			role="switch"
			checked={ongoing}
			{disabled}
			aria-busy={busy ? 'true' : undefined}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedby}
			onchange={change}
		/>
	</label>
	<p class="hint" id={ids.hint}>
		{ongoing
			? 'Im Tagesplan heißt der Haken „für heute erledigt“; das Ticket bleibt offen.'
			: 'Im Tagesplan erledigt der Haken dieses Ticket.'}
	</p>
	<p class="hint" id={ids.choice}>
		Für eine Sache, an der du länger arbeitest. Musst du etwas jedes Mal einzeln erledigen, passt
		eine Wiederholung besser.
		<a href={helpHref('vorhaben-oder-wiederholung')} target="_blank" rel="noopener"
			>Vorhaben oder Wiederholung?<NewTabHint /></a
		>
	</p>
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
</div>

<style>
	.kind {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		color: var(--color-text);
		cursor: pointer;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.hint a {
		color: var(--color-brand-text);
	}
</style>
