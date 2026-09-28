<script lang="ts">
	import { ticketCount, type FieldAction } from '$lib/domain/bulk';
	import type { TagRef } from '$lib/domain/ticket';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import TagPicker from './TagPicker.svelte';

	// "Tags …" of the bulk actions (plan BI-2, ADR-0036 §3): add tags with the tag input of the
	// ticket (comma, Enter, Backspace like everywhere; new names become new tags), or remove tags
	// that the chosen tickets carry, chosen by checkboxes. Modal M; a typed name that is not taken
	// yet counts as unsaved input.
	let {
		count,
		tags,
		present,
		oncreatetag,
		onapply,
		onclose
	}: {
		/** Number of chosen tickets. */
		count: number;
		/** Every tag (the catalog). */
		tags: readonly TagRef[];
		/** Tags that at least one chosen ticket carries, for "Entfernen". */
		present: readonly TagRef[];
		oncreatetag: (name: string) => Promise<EnsureTagResult>;
		onapply: (action: Extract<FieldAction, { kind: 'tags' }>) => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		picker: `${uid}-picker`,
		pickerError: `${uid}-picker-error`,
		removeLegend: `${uid}-remove`,
		chooseError: `${uid}-choose-error`
	};

	let mode = $state<'add' | 'remove'>('add');
	let addIds = $state<string[]>([]);
	let removeIds = $state<string[]>([]);
	let text = $state('');
	let pickerError = $state<string | null>(null);
	let chooseError = $state<string | null>(null);

	const title = $derived(`Tags für ${ticketCount(count)}`);
	const chosen = $derived(
		addIds.flatMap((id) => {
			const tag = tags.find((entry) => entry.id === id);
			return tag === undefined ? [] : [tag];
		})
	);

	function add(tagId: string): boolean {
		if (!addIds.includes(tagId)) addIds = [...addIds, tagId];
		pickerError = null;
		chooseError = null;
		return true;
	}

	async function create(name: string): Promise<boolean> {
		const result = await oncreatetag(name);
		if (!result.ok) {
			pickerError = result.message;
			return false;
		}
		return add(result.tag.id);
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const tagIds = mode === 'add' ? addIds : removeIds;
		if (tagIds.length === 0) {
			chooseError =
				mode === 'add'
					? 'Bitte mindestens einen Tag wählen.'
					: 'Bitte mindestens einen Tag ankreuzen.';
			return;
		}
		onapply({ kind: 'tags', mode, tagIds: [...tagIds] });
	}
</script>

<Modal open size="m" {title} dirty={text.trim() !== ''} onclose={() => onclose()}>
	<form id={ids.form} class="form" onsubmit={submit} novalidate>
		<fieldset class="modes">
			<legend class="visually-hidden">Was soll geschehen?</legend>
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-mode`}
					checked={mode === 'add'}
					onchange={() => {
						mode = 'add';
						chooseError = null;
					}}
				/>
				Tags hinzufügen
			</label>
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-mode`}
					checked={mode === 'remove'}
					disabled={present.length === 0}
					onchange={() => {
						mode = 'remove';
						chooseError = null;
					}}
				/>
				Tags entfernen
			</label>
		</fieldset>
		{#if mode === 'add'}
			<div class="field">
				<label for={ids.picker}>Hinzufügen</label>
				<TagPicker
					id={ids.picker}
					selected={chosen}
					{tags}
					bind:text
					error={pickerError}
					errorId={ids.pickerError}
					describedBy={chooseError ? ids.chooseError : undefined}
					onadd={add}
					onremove={(tagId) => {
						addIds = addIds.filter((entry) => entry !== tagId);
						return true;
					}}
					oncreate={create}
				/>
				{#if pickerError}
					<p class="field-error" id={ids.pickerError}><ErrorIcon /><span>{pickerError}</span></p>
				{/if}
			</div>
		{:else}
			<fieldset class="remove" aria-describedby={chooseError ? ids.chooseError : undefined}>
				<legend id={ids.removeLegend}>Entfernen</legend>
				{#each present as tag (tag.id)}
					<label class="choice">
						<input
							type="checkbox"
							checked={removeIds.includes(tag.id)}
							onchange={(event) => {
								removeIds = event.currentTarget.checked
									? [...removeIds, tag.id]
									: removeIds.filter((entry) => entry !== tag.id);
								chooseError = null;
							}}
						/>
						{tag.name}
					</label>
				{/each}
			</fieldset>
		{/if}
		{#if chooseError}
			<p class="field-error" id={ids.chooseError}><ErrorIcon /><span>{chooseError}</span></p>
		{/if}
	</form>
	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		<button class="button-primary" type="submit" form={ids.form}>Übernehmen</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 1rem;
	}

	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.remove {
		display: grid;
		gap: 0.375rem;
	}

	legend,
	label:not(.choice) {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.choice {
		display: inline-flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	.field {
		display: grid;
		gap: 0.375rem;
	}
</style>
