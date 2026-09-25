<script lang="ts">
	// Due date as a native date field (E2 plan, T-7): Enter or leaving the field saves, Escape
	// restores the saved value, the icon button "Fälligkeit entfernen" clears it (an icon instead of
	// text, so the row fits the 480 px panel). An incomplete date in the browser
	// (validity.badInput) is rejected instead of being saved as "no due date".
	let {
		id,
		value,
		saving = false,
		error = null,
		errorId,
		onedit,
		oninput,
		onsave,
		oncancel,
		onreject,
		onclear
	}: {
		id: string;
		/** `YYYY-MM-DD` or '' without a due date. */
		value: string;
		saving?: boolean;
		error?: string | null;
		errorId: string;
		onedit: () => void;
		oninput: (value: string) => void;
		onsave: () => void;
		oncancel: () => void;
		onreject: () => void;
		onclear: () => void;
	} = $props();

	let input = $state<HTMLInputElement>();

	function commit() {
		if (input?.validity.badInput) onreject();
		else onsave();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			oncancel();
			if (input) input.value = value;
		}
	}
</script>

<div class="due-input">
	<input
		{id}
		type="date"
		{value}
		readonly={saving}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
		bind:this={input}
		onfocus={onedit}
		oninput={(event) => oninput(event.currentTarget.value)}
		onblur={commit}
		{onkeydown}
	/>
	{#if value !== ''}
		<button
			class="button-icon clear"
			type="button"
			aria-label="Fälligkeit entfernen"
			title="Fälligkeit entfernen"
			disabled={saving}
			onclick={onclear}
		>
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" />
			</svg>
		</button>
	{/if}
</div>

<style>
	.due-input {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
	}

	input {
		max-width: 100%;
	}

	.clear {
		flex: none;
	}

	.clear svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
</style>
