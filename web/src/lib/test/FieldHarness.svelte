<script lang="ts">
	import type { Snippet } from 'svelte';
	import Field from '$lib/components/form/Field.svelte';
	import type { ProblemEntry } from '$lib/domain/problems';

	// Tests of Field (UI-1): one field with a native control of the chosen kind; extra attributes of
	// the control (disabled, readonly, required) show that the caller keeps them next to the spread.
	// `problem` is the failed save behind an error (FP-1, ADR-0071).
	let {
		label = 'Name',
		hint,
		error = '',
		problem = null,
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
		problem?: ProblemEntry | null;
		id?: string;
		describedBy?: string;
		width?: 'full' | 'auto';
		kind?: 'input' | 'select' | 'textarea';
		disabled?: boolean;
		readonly?: boolean;
	} = $props();

	let value = $state('');
</script>

<Field {label} {hint} {error} {problem} {id} {describedBy} {width}>
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
