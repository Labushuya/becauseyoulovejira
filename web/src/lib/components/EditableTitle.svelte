<script lang="ts">
	import { tick } from 'svelte';
	import { TITLE_MAX_LENGTH } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import CharmIcon from './CharmIcon.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import KindBadge from './KindBadge.svelte';

	// Title of the panel (E2 plan, T-7): a heading with "Titel bearbeiten". While editing, Enter
	// or leaving the field saves and Escape cancels; the heading is the focus target of the panel.
	// The charm of the ticket (ADR-0062) stands before the heading, not in it, so the name of the
	// panel stays the title; the badge "Vorhaben" of an ongoing project (ADR-0065) after it.
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
		<CharmIcon charm={store.ticket?.charm} />
		<h2 id={headingId} tabindex="-1" bind:this={heading}>{store.ticket?.title}</h2>
		<KindBadge kind={store.ticket?.kind} />
		<button
			class="button-icon"
			type="button"
			aria-label="Titel bearbeiten"
			title="Titel bearbeiten"
			bind:this={editButton}
			onclick={start}
		>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<path
					d="M10.5 2.5l3 3L6 13H3v-3z"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
			</svg>
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

	/*
	 * The charm (ADR-0062) in its size and gap of every place (the gap of the row adds 0.5rem),
	 * centered on the first line of the heading (1.25rem at 1.35).
	 */
	.title :global(.charm-mark) {
		margin-top: 0.4rem;
		margin-right: -0.125rem;
	}

	/* The badge "Vorhaben" (ADR-0065) on the first line of the heading. */
	.title :global(.kind-badge) {
		margin-top: 0.3rem;
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

	/*
	 * The field takes the place of the heading and keeps its size and weight, so the title does not
	 * jump while it is edited; surface, line and states come from base.css (allowlist of
	 * no-own-form-styles.test.ts).
	 */
	.input {
		flex: 1;
		width: 100%;
		font-size: 1.25rem;
		font-weight: 600;
	}
</style>
