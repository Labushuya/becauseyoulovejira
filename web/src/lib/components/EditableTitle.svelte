<script lang="ts">
	import { tick } from 'svelte';
	import { TITLE_MAX_LENGTH } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// Title of the panel (E2 plan, T-7): a heading with "Titel bearbeiten". While editing, Enter
	// or leaving the field saves and Escape cancels; the heading is the focus target of the panel.
	let {
		store,
		headingId,
		heading = $bindable()
	}: { store: TicketDetailStore; headingId: string; heading?: HTMLElement } = $props();

	const uid = $props.id();
	const errorId = `${uid}-error`;
	let editButton = $state<HTMLButtonElement>();

	const editing = $derived(store.isEditing('title'));
	const error = $derived(store.fieldError('title'));

	async function start() {
		store.edit('title');
		await tick();
		document.getElementById(`${uid}-input`)?.focus();
	}

	async function finish(saved: boolean) {
		if (!saved) return;
		await tick();
		editButton?.focus();
	}

	async function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			await finish(await store.save('title'));
		} else if (event.key === 'Escape') {
			event.preventDefault();
			store.cancel('title');
			await finish(true);
		}
	}
</script>

<div class="title">
	{#if editing}
		<input
			id={`${uid}-input`}
			class="input"
			type="text"
			aria-label="Titel"
			maxlength={TITLE_MAX_LENGTH}
			value={store.value('title')}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? errorId : undefined}
			readonly={store.isSaving('title')}
			oninput={(event) => store.setDraft('title', event.currentTarget.value)}
			{onkeydown}
			onblur={() => store.save('title')}
		/>
	{:else}
		<h2 id={headingId} tabindex="-1" bind:this={heading}>{store.ticket?.title}</h2>
		<button class="edit" type="button" bind:this={editButton} onclick={start}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<path
					d="M10.5 2.5l3 3L6 13H3v-3z"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
			</svg>
			<span class="visually-hidden">Titel bearbeiten</span>
		</button>
	{/if}
	{#if error}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
</div>

<style>
	.title {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: flex-start;
	}

	h2 {
		flex: 1;
		min-width: 0;
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	h2:focus {
		outline: none;
	}

	h2:focus-visible {
		outline: 2px solid var(--color-brand-text);
	}

	.input {
		flex: 1;
		width: 100%;
		padding: 0.25rem 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.edit {
		display: inline-flex;
		padding: 0.375rem;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.edit:hover {
		border-color: var(--color-line);
	}
</style>
