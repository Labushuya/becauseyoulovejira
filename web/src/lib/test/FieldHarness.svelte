<script lang="ts">
	import type { Snippet } from 'svelte';
	import Field from '$lib/components/form/Field.svelte';

	// Tests of Field (UI-1): one field with a native control of the chosen kind; extra attributes of
	// the control (disabled, readonly, required) show that the caller keeps them next to the spread.
	let {
		label = 'Name',
		hint,
		error = '',
		id,
		describedBy,
		width,
		kind = 'input',
		disabled = false,
		readonly = false
	}: {
		label?: string;
		hint?: string | Snippet;
		error?: string;
		id?: string;
		describedBy?: string;
		width?: 'full' | 'auto';
		kind?: 'input' | 'select' | 'textarea';
		disabled?: boolean;
		readonly?: boolean;
	} = $props();

	let value = $state('');
</script>

<Field {label} {hint} {error} {id} {describedBy} {width}>
	{#snippet control(field)}
		{#if kind === 'select'}
			<select {...field} {disabled} bind:value>
				<option value="">Keins</option>
				<option value="a">Haus</option>
			</select>
		{:else if kind === 'textarea'}
			<textarea {...field} {disabled} {readonly} bind:value></textarea>
		{:else}
			<input {...field} type="text" {disabled} {readonly} required bind:value />
		{/if}
	{/snippet}
</Field>
