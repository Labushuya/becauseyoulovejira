<script lang="ts">
	// Due date as a native date field (E2 plan, T-7): Enter or leaving the field saves, Escape
	// restores the saved value, "Entfernen" clears it. An incomplete date in the browser
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
		<button class="clear" type="button" disabled={saving} onclick={onclear}>
			Entfernen<span class="visually-hidden">: Fälligkeit</span>
		</button>
	{/if}
</div>

<style>
	.due-input {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.clear {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
