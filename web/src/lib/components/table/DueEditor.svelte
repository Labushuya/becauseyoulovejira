<script lang="ts">
	import { isCalendarDate, type CalendarDate } from '$lib/domain/berlin-date';
	import ErrorIcon from '../ErrorIcon.svelte';

	// Due date of a row in its popover (plan BI-3): the date field of the browser, Enter or
	// "Übernehmen" saves, "Leeren" removes the date, Escape closes without saving (the Popover). A
	// wrong date stays at the field; a refusal of the server comes as a flag from the store.
	let {
		key,
		value,
		onsave,
		close
	}: {
		/** Key of the ticket, for the name of the field. */
		key: string;
		value: CalendarDate | null;
		/** Saves the date (null clears it); resolves to false when the server refused. */
		onsave: (due: CalendarDate | null) => Promise<boolean>;
		close: () => void;
	} = $props();

	const uid = $props.id();
	const ids = { input: `${uid}-date`, error: `${uid}-error` };

	// svelte-ignore state_referenced_locally
	let date = $state<string>(value ?? '');
	let error = $state<string | null>(null);
	let saving = $state(false);

	async function save(next: CalendarDate | null) {
		if (saving) return;
		if (next === value) {
			close();
			return;
		}
		saving = true;
		const ok = await onsave(next);
		saving = false;
		if (ok) close();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (date === '') {
			void save(null);
			return;
		}
		if (!isCalendarDate(date)) {
			error = 'Bitte ein gültiges Datum wählen.';
			return;
		}
		error = null;
		void save(date);
	}
</script>

<form class="due-editor" onsubmit={submit} novalidate>
	<label for={ids.input}>Fälligkeit von {key}</label>
	<input
		id={ids.input}
		type="date"
		bind:value={date}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? ids.error : undefined}
		aria-busy={saving ? 'true' : undefined}
	/>
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<div class="buttons">
		<button
			class="button-subtle"
			type="button"
			disabled={value === null}
			onclick={() => void save(null)}
		>
			Leeren
		</button>
		<button class="button-primary" type="submit" aria-disabled={saving}>Übernehmen</button>
	</div>
</form>

<style>
	.due-editor {
		display: grid;
		gap: 0.5rem;
		padding: 0.25rem;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
</style>
