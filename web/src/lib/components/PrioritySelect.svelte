<script lang="ts">
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import { PRIORITIES } from '$lib/domain/status';

	// Priority of the panel and the new ticket form (E2 plan, T-7 and T-8), from urgent to low.
	let {
		id,
		value,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		onchoose
	}: {
		id: string;
		value: string;
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		errorId: string;
		onchoose: (value: string) => void;
	} = $props();

	const ORDER = [...PRIORITIES].reverse();
</script>

<select
	{id}
	{value}
	aria-busy={busy ? 'true' : undefined}
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={error ? errorId : undefined}
	{disabled}
	onchange={(event) => onchoose(event.currentTarget.value)}
>
	{#each ORDER as priority (priority)}
		<option value={priority}>{PRIORITY_LABELS[priority]}</option>
	{/each}
</select>
