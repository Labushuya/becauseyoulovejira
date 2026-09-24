<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { STATUSES } from '$lib/domain/status';

	// Status of the panel (E2 plan, T-7): saves at once when chosen. "Erledigt" works like the
	// check mark of the list.
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
	{#each STATUSES as status (status)}
		<option value={status}>{STATUS_LABELS[status]}</option>
	{/each}
</select>
