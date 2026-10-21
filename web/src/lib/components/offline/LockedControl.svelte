<script lang="ts">
	// A field of a ticket "＋" created that needs the server while it does not have the ticket yet
	// (OF-4a round 2, A6): "gesperrt statt weg" (ui-bausteine.md). It stays at its place with its value,
	// reachable with Tab, marked `aria-disabled` with the reason as its description and title; a click
	// does nothing. The panel and the full view say the same above the fields (`createdHint`).
	let {
		id,
		label,
		value,
		reason
	}: {
		/** The ID the label of the field points at. */
		id?: string;
		/** The name of the field, e.g. "Priorität". */
		label: string;
		/** The value as text, e.g. "Mittel". */
		value: string;
		/** Why it is locked. */
		reason: string;
	} = $props();

	const uid = $props.id();
</script>

<span class="locked-control">
	<button
		{id}
		class="button-secondary button-small"
		type="button"
		aria-disabled="true"
		aria-label={`${label}: ${value}`}
		aria-describedby={`${uid}-reason`}
		title={reason}
	>
		{value}
	</button>
	<span class="visually-hidden" id={`${uid}-reason`}>{reason}</span>
</span>

<style>
	.locked-control {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
	}
</style>
