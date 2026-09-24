<script lang="ts">
	// Check mark "erledigt" of a row (E2 plan, P-3 and T-6). A control of its own next to the row
	// link, so it never opens the panel. While a request runs it is locked with aria-disabled
	// instead of disabled, so the keyboard focus stays on it.
	let {
		key,
		checked,
		pending,
		onchange
	}: { key: string; checked: boolean; pending: boolean; onchange: (done: boolean) => void } =
		$props();

	function onclick(event: MouseEvent) {
		if (pending) event.preventDefault();
	}
</script>

<input
	class="toggle"
	type="checkbox"
	aria-label={`${key} erledigt`}
	aria-disabled={pending ? 'true' : undefined}
	aria-busy={pending ? 'true' : undefined}
	{checked}
	{onclick}
	onchange={(event) => onchange(event.currentTarget.checked)}
/>

<style>
	.toggle {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--color-brand);
		cursor: pointer;
	}

	.toggle[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.6;
	}
</style>
