<script lang="ts">
	import { normalizeTitle, type InboxItemSummary } from '$lib/domain/inbox';
	import { sourceChannelLabel, sourceOrigin, sourceWhen } from '$lib/domain/sources';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { TicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Quelle hinzufügen …" in the ticket (ADR-0031 section 7): choose new entries of the inbox and
	// link them to this ticket, the same way as "Mit Ticket verknüpfen …" in the inbox. Modal M with
	// a search over title, sender, chat and address and one checkbox per entry. Without failures
	// the dialog closes (the flag names the result); failed entries stay chosen with their reason.
	// Inside a modal (the full view) the same form unfolds inline where the owner renders it
	// (ADR-0025 section 3, addendum 16).
	let {
		ticket,
		candidates,
		store,
		onclose
	}: {
		ticket: { id: string; key: string };
		/** The new entries of the inbox. */
		candidates: readonly InboxItemSummary[];
		store: TicketSourcesStore;
		onclose: () => void;
	} = $props();

	const inline = insideModal();
	const uid = $props.id();
	const formId = `${uid}-form`;
	const searchId = `${uid}-search`;
	const errorId = `${uid}-error`;

	let query = $state('');
	let chosen = $state<string[]>([]);
	let failures = $state<{ id: string; title: string; message: string }[]>([]);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const shown = $derived.by(() => {
		const needle = normalizeTitle(query);
		if (needle === '') return candidates;
		return candidates.filter((item) =>
			normalizeTitle(`${item.title} ${sourceOrigin(item)}`).includes(needle)
		);
	});

	function toggle(id: string, on: boolean) {
		chosen = on
			? [...chosen.filter((entry) => entry !== id), id]
			: chosen.filter((entry) => entry !== id);
		error = null;
	}

	async function link(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const items = candidates.filter((item) => chosen.includes(item.id));
		if (items.length === 0) {
			error = 'Bitte mindestens einen Eintrag wählen.';
			return;
		}
		busy = true;
		try {
			const outcome = await store.link(items, ticket);
			failures = outcome.failures;
			const failed = outcome.failures.map((failure) => failure.id);
			chosen = chosen.filter((id) => failed.includes(id));
			if (outcome.failures.length === 0) onclose();
		} finally {
			busy = false;
		}
	}
</script>

{#snippet content()}
	{#if candidates.length === 0}
		<EmptyState
			size="compact"
			title="Keine neuen Einträge"
			description="Im Eingang wartet gerade nichts, das eine Quelle werden könnte."
		/>
	{:else}
		<form id={formId} class="form" novalidate onsubmit={link}>
			<p>Gewählte Einträge werden Quellen von {ticket.key}.</p>
			<span class="search-field search">
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<circle cx="7" cy="7" r="4.25" />
					<path d="M10.25 10.25L13.5 13.5" />
				</svg>
				<input
					id={searchId}
					type="search"
					autocomplete="off"
					spellcheck="false"
					aria-label="Einträge durchsuchen"
					placeholder="Suchen"
					bind:value={query}
				/>
			</span>
			<fieldset aria-describedby={error ? errorId : undefined}>
				<legend>Neue Einträge im Eingang</legend>
				{#if shown.length === 0}
					<p class="hint" role="status">Keine Treffer.</p>
				{:else}
					<ul class="candidates">
						{#each shown as item (item.id)}
							<li>
								<label>
									<input
										type="checkbox"
										checked={chosen.includes(item.id)}
										onchange={(event) => toggle(item.id, event.currentTarget.checked)}
									/>
									<span class="text">
										<span class="title">{item.title}</span>
										<span class="meta">
											{[sourceChannelLabel(item), sourceWhen(item), sourceOrigin(item)]
												.filter((part) => part !== '')
												.join(' · ')}
										</span>
									</span>
								</label>
							</li>
						{/each}
					</ul>
				{/if}
			</fieldset>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
			{#if failures.length > 0}
				<div class="alert-error" role="alert">
					<ErrorIcon />
					<div>
						<p>Nicht verknüpft:</p>
						<ul>
							{#each failures as failure (failure.id)}
								<li>„{failure.title}“: {failure.message}</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
		</form>
	{/if}
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		{failures.length > 0 ? 'Schließen' : 'Abbrechen'}
	</button>
	{#if candidates.length > 0}
		<button
			class="button-primary"
			type="submit"
			form={formId}
			aria-disabled={busy}
			aria-busy={busy ? 'true' : undefined}
		>
			{busy ? 'Wird verknüpft …' : `Verknüpfen${chosen.length > 0 ? ` (${chosen.length})` : ''}`}
		</button>
	{/if}
{/snippet}

{#if inline}
	<InlineDialog open title="Quelle hinzufügen" {busy} onclose={() => onclose()} footer={buttons}>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal open size="m" title="Quelle hinzufügen" {busy} onclose={() => onclose()} footer={buttons}>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.75rem;
		font-size: var(--font-size-body);
	}

	.search {
		width: 100%;
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.375rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.candidates {
		display: grid;
		gap: 0.25rem;
		max-height: 20rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
		padding: 0.375rem 0.25rem;
		cursor: pointer;
	}

	.text {
		display: grid;
		min-width: 0;
	}

	.title {
		overflow-wrap: anywhere;
	}

	.meta,
	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.alert-error ul {
		padding-left: 1rem;
	}
</style>
