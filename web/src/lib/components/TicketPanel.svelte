<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { DESCRIPTION_MAX_LENGTH, type Ticket } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import DueInput from './DueInput.svelte';
	import EditableTitle from './EditableTitle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import StatusSelect from './StatusSelect.svelte';

	// Detail panel (E2 plan, package 7): header with key and "Schließen", title, status,
	// priority, due date and description editable in place, the remaining fields for display.
	// Escape closes the panel unless a form field has the focus (fields handle Escape
	// themselves). Comments and history (packages 9 and 10) come in through `activity`.
	// "Löschen …" asks in a modal dialog before deleting for good (package 11).
	let {
		store,
		listHref,
		onclose,
		ondeleted,
		activity
	}: {
		store: TicketDetailStore;
		/** Link back to the list with the current query. */
		listHref: ResolvedPathname;
		onclose: () => void;
		/** Called after the ticket was deleted; the owner closes the panel. */
		ondeleted: () => void;
		activity?: Snippet<[Ticket]>;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	const ids = {
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		description: `${uid}-description`
	};
	const errorIdOf = (field: string) => `${uid}-${field}-error`;

	let heading = $state<HTMLElement>();
	let messageHeading = $state<HTMLElement>();
	let descriptionButton = $state<HTMLButtonElement>();
	let descriptionText = $state<HTMLTextAreaElement>();
	let deleteButton = $state<HTMLButtonElement>();
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	/** Ticket the focus was last moved to, so it moves only once per opened ticket. */
	let focusedFor: string | null = null;

	const ticket = $derived(store.ticket);
	const editingDescription = $derived(store.isEditing('description'));

	// Focus on opening (E2 plan, section 3): the heading of the ticket, or the message heading.
	$effect(() => {
		const target = store.state === 'ready' ? heading : messageHeading;
		const key = `${store.id}:${store.state}`;
		if (target === undefined || focusedFor === key || store.state === 'loading') return;
		focusedFor = key;
		target.focus();
	});

	function isFormField(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented || isFormField(event.target)) return;
		event.preventDefault();
		onclose();
	}

	async function editDescription() {
		store.edit('description');
		await tick();
		descriptionText?.focus();
	}

	async function endDescription(save: boolean) {
		if (save) {
			if (!(await store.save('description'))) return;
		} else {
			store.cancel('description');
		}
		await tick();
		descriptionButton?.focus();
	}

	function askDelete() {
		deleteError = null;
		confirmingDelete = true;
	}

	async function cancelDelete() {
		confirmingDelete = false;
		deleteError = null;
		await tick();
		deleteButton?.focus();
	}

	async function confirmDelete() {
		if (deleting) return;
		deleting = true;
		deleteError = null;
		const result = await store.deleteTicket();
		deleting = false;
		if (result.ok) {
			confirmingDelete = false;
			ondeleted();
		} else if (result.message !== null) {
			deleteError = result.message;
		} else {
			confirmingDelete = false;
		}
	}

	function onDescriptionKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void endDescription(true);
		}
	}
</script>

{#snippet fieldError(field: 'status' | 'priority' | 'due' | 'description')}
	{@const error = store.fieldError(field)}
	{#if error}
		<p class="field-error" id={errorIdOf(field)}><ErrorIcon /><span>{error}</span></p>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="side-panel" aria-labelledby={headingId} {onkeydown}>
	<header class="bar">
		<span class="key">{ticket?.key ?? ''}</span>
		{#if store.state === 'ready' && ticket}
			<button
				class="close delete"
				type="button"
				aria-haspopup="dialog"
				bind:this={deleteButton}
				onclick={askDelete}
			>
				Löschen …
			</button>
		{/if}
		<button class="close" type="button" onclick={onclose}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<path
					d="M4 4l8 8M12 4l-8 8"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			</svg>
			Schließen
		</button>
	</header>

	{#if store.state === 'not_found'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Ticket nicht gefunden</h2>
			<p>Das Ticket gibt es nicht, oder es ist für dich nicht sichtbar.</p>
			<a href={listHref}>Zur Liste</a>
		</div>
	{:else if store.state === 'deleted'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Dieses Ticket wurde gelöscht.</h2>
			<p>Es wurde an anderer Stelle gelöscht, samt Kommentaren und Verlauf.</p>
			<a href={listHref}>Zur Liste</a>
		</div>
	{:else if store.state === 'error'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>
				Ticket konnte nicht geladen werden
			</h2>
			<div class="alert-error">
				<ErrorIcon />
				<span class="grow">{store.error}</span>
				<button class="small" type="button" onclick={() => store.reload()}>Erneut versuchen</button>
			</div>
		</div>
	{:else if store.state === 'ready' && ticket}
		<EditableTitle {store} {headingId} bind:heading />

		<div class="fields">
			<label for={ids.status}>Status</label>
			<div class="control">
				<StatusSelect
					id={ids.status}
					value={store.value('status')}
					busy={store.isSaving('status')}
					error={store.fieldError('status')}
					errorId={errorIdOf('status')}
					onchoose={(value) => store.choose('status', value)}
				/>
				{@render fieldError('status')}
			</div>

			<label for={ids.priority}>Priorität</label>
			<div class="control">
				<PrioritySelect
					id={ids.priority}
					value={store.value('priority')}
					busy={store.isSaving('priority')}
					error={store.fieldError('priority')}
					errorId={errorIdOf('priority')}
					onchoose={(value) => store.choose('priority', value)}
				/>
				{@render fieldError('priority')}
			</div>

			<label for={ids.due}>Fälligkeit</label>
			<div class="control">
				<DueInput
					id={ids.due}
					value={store.value('due')}
					saving={store.isSaving('due')}
					error={store.fieldError('due')}
					errorId={errorIdOf('due')}
					onedit={() => store.edit('due')}
					oninput={(value) => store.setDraft('due', value)}
					onsave={() => store.save('due')}
					oncancel={() => store.cancel('due')}
					onreject={() => store.reject('due', 'Ungültiges Datum.')}
					onclear={() => {
						store.edit('due');
						store.setDraft('due', '');
						void store.save('due');
					}}
				/>
				{@render fieldError('due')}
			</div>

			{#if ticket.project}
				<span class="term">Projekt</span>
				<span class="detail" title={ticket.project.name}>
					<span class="code">{ticket.project.code}</span>
					{ticket.project.name}
				</span>
			{/if}
			{#if ticket.tags.length > 0}
				<span class="term">Tags</span>
				<span class="detail tags">
					{#each ticket.tags as tag (tag.id)}
						<span class="tag">{tag.name}</span>
					{/each}
				</span>
			{/if}
			{#if ticket.recurring}
				<span class="term">Wiederholung</span>
				<span class="detail">wiederkehrend</span>
			{/if}
		</div>

		<section class="description" aria-labelledby={`${uid}-description-title`}>
			<div class="section-head">
				<h3 id={`${uid}-description-title`}>Beschreibung</h3>
				{#if !editingDescription}
					<button
						class="small"
						type="button"
						bind:this={descriptionButton}
						onclick={editDescription}
					>
						Bearbeiten<span class="visually-hidden">: Beschreibung</span>
					</button>
				{/if}
			</div>
			{#if editingDescription}
				<MarkdownEditor
					label="Beschreibung (Markdown)"
					maxlength={DESCRIPTION_MAX_LENGTH}
					bind:value={
						() => store.value('description'), (value) => store.setDraft('description', value)
					}
					bind:textarea={descriptionText}
					aria-invalid={store.fieldError('description') ? 'true' : undefined}
					aria-describedby={store.fieldError('description') ? errorIdOf('description') : undefined}
					onkeydown={onDescriptionKeydown}
				/>
				{@render fieldError('description')}
				<div class="buttons">
					<button
						class="button-primary small-primary"
						type="button"
						disabled={store.isSaving('description')}
						onclick={() => endDescription(true)}
					>
						{store.isSaving('description') ? 'Wird gespeichert …' : 'Speichern'}
					</button>
					<button class="small" type="button" onclick={() => endDescription(false)}>
						Abbrechen
					</button>
				</div>
			{:else if ticket.description.trim() !== ''}
				<Markdown source={ticket.description} />
			{:else}
				<p class="muted">Keine Beschreibung.</p>
			{/if}
		</section>

		<dl class="meta">
			<div>
				<dt>Erstellt</dt>
				<dd>{formatBerlinDateTime(ticket.created)}</dd>
			</div>
			<div>
				<dt>Aktualisiert</dt>
				<dd>{formatBerlinDateTime(ticket.updated)}</dd>
			</div>
			{#if ticket.completedAt}
				<div>
					<dt>Erledigt am</dt>
					<dd>{formatBerlinDateTime(ticket.completedAt)}</dd>
				</div>
			{/if}
		</dl>

		{@render activity?.(ticket)}

		<ConfirmDialog
			open={confirmingDelete}
			title={`${ticket.key} endgültig löschen?`}
			confirmLabel="Endgültig löschen"
			busy={deleting}
			error={deleteError}
			onconfirm={confirmDelete}
			oncancel={cancelDelete}
		>
			<p>
				Dabei werden auch alle Kommentare und der gesamte Verlauf dieses Tickets gelöscht. Das lässt
				sich nicht rückgängig machen.
			</p>
		</ConfirmDialog>
	{:else}
		<p class="loading" role="status">Ticket wird geladen …</p>
	{/if}
</aside>

<style>
	.bar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
	}

	.key {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.delete {
		margin-left: auto;
	}

	.close {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.message {
		display: grid;
		gap: 0.75rem;
	}

	.message h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	.message a {
		color: var(--color-brand-text);
	}

	.fields {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.625rem 1rem;
		align-items: baseline;
		font-size: 0.875rem;
	}

	.fields label,
	.term {
		color: var(--color-text-muted);
	}

	.control {
		display: grid;
		gap: 0.25rem;
	}

	.fields :global(select),
	.fields :global(input[type='date']) {
		width: fit-content;
		padding: 0.25rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.code {
		margin-right: 0.25rem;
		font-weight: 500;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.tag {
		padding: 0 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}

	.description {
		display: grid;
		gap: 0.5rem;
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
	}

	.small {
		padding: 0.125rem 0.625rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.small-primary {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
	}

	.muted,
	.loading {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		padding-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-line);
	}

	.meta dd {
		color: var(--color-text);
	}

	.grow {
		flex: 1;
	}
</style>
