<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { CHANNEL_LABELS } from '$lib/domain/inbox';
	import { DESCRIPTION_MAX_LENGTH, type Ticket } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { inboxItemHref } from '$lib/ticket-links';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import DueInput from './DueInput.svelte';
	import EditableTitle from './EditableTitle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';

	// Detail panel (E2 plan, package 7; E3 plan, T-13 and T-14) on the side panel building block
	// (ADR-0025 section 6): header with the key, "Löschen …" and ×; title, status, priority, due
	// date, project, tags and description editable in place, the remaining fields for display.
	// Project and tags come from the catalog. Escape closes the panel unless a form field has the
	// focus (fields handle Escape themselves; the rule is the Drawer's). Comments and history (E2
	// plan, packages 9 and 10) come in through `activity`. "Löschen …" asks in a modal dialog before
	// deleting for good (E2 plan, package 11); the dialog returns the focus to it.
	let {
		store,
		catalog,
		listHref,
		onclose,
		ondeleted,
		activity,
		recurrence
	}: {
		store: TicketDetailStore;
		/** Projects and tags (E3 plan, T-16). */
		catalog: CatalogStore;
		/** Link back to the list with the current query. */
		listHref: ResolvedPathname;
		onclose: () => void;
		/** Called after the ticket was deleted; the owner closes the panel. */
		ondeleted: () => void;
		activity?: Snippet<[Ticket]>;
		/** "Wiederholen…" or the series of the ticket (E5 plan, package 4). */
		recurrence?: Snippet<[Ticket]>;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	const ids = {
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		tags: `${uid}-tags`,
		description: `${uid}-description`
	};
	const errorIdOf = (field: string) => `${uid}-${field}-error`;

	let heading = $state<HTMLElement>();
	let messageHeading = $state<HTMLElement>();
	let descriptionButton = $state<HTMLButtonElement>();
	let descriptionText = $state<HTMLTextAreaElement>();
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	/** Ticket the focus was last moved to, so it moves only once per opened ticket. */
	let focusedFor: string | null = null;

	const ticket = $derived(store.ticket);
	const ticketTags = $derived(ticket ? catalog.tagsOf(ticket) : []);
	const editingDescription = $derived(store.isEditing('description'));

	// Focus on opening (E2 plan, section 3): the heading of the ticket, or the message heading.
	$effect(() => {
		const target = store.state === 'ready' ? heading : messageHeading;
		const key = `${store.id}:${store.state}`;
		if (target === undefined || focusedFor === key || store.state === 'loading') return;
		focusedFor = key;
		target.focus();
	});

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

	function cancelDelete() {
		confirmingDelete = false;
		deleteError = null;
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

	/** New tag from the picker: an existing one in another spelling or a new one, then assigned. */
	async function createTag(name: string): Promise<boolean> {
		const result = await catalog.ensureTag(name);
		if (!result.ok) {
			if (result.message !== null) store.reject('tags', result.message);
			return false;
		}
		return store.addTag(result.tag.id);
	}

	function onDescriptionKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void endDescription(true);
		}
	}
</script>

{#snippet fieldError(field: 'status' | 'priority' | 'due' | 'project' | 'tags' | 'description')}
	{@const error = store.fieldError(field)}
	{#if error}
		<p class="field-error" id={errorIdOf(field)}><ErrorIcon /><span>{error}</span></p>
	{/if}
{/snippet}

<Drawer labelledby={headingId} {onclose}>
	{#snippet context()}
		<span class="key">{ticket?.key ?? ''}</span>
	{/snippet}
	{#snippet actions()}
		{#if store.state === 'ready' && ticket}
			<button class="button-subtle" type="button" aria-haspopup="dialog" onclick={askDelete}>
				Löschen …
			</button>
		{/if}
	{/snippet}

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

			<label for={ids.project}>Projekt</label>
			<div class="control">
				<ProjectSelect
					id={ids.project}
					value={store.value('project')}
					projects={catalog.activeProjects}
					current={catalog.projectOf(ticket)}
					busy={store.isSaving('project')}
					error={store.fieldError('project')}
					errorId={errorIdOf('project')}
					hintId={ids.projectHint}
					onchoose={(value) => store.choose('project', value)}
				/>
				{@render fieldError('project')}
			</div>

			<label for={ids.tags}>Tags</label>
			<div class="control">
				<TagPicker
					id={ids.tags}
					selected={ticketTags}
					tags={catalog.tags}
					bind:text={() => store.tagInput, (text) => store.setTagInput(text)}
					busy={store.isSaving('tags')}
					error={store.fieldError('tags')}
					errorId={errorIdOf('tags')}
					onadd={(tagId) => store.addTag(tagId)}
					onremove={(tagId) => store.removeTag(tagId)}
					oncreate={createTag}
				/>
				{@render fieldError('tags')}
			</div>
			{#if ticket.recurring && !recurrence}
				<span class="term">Wiederholung</span>
				<span class="detail">wiederkehrend</span>
			{/if}
		</div>

		{@render recurrence?.(ticket)}

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
			{#if ticket.source !== null}
				<div>
					<dt>Quelle</dt>
					<dd>
						{CHANNEL_LABELS[ticket.source]}
						{#if ticket.sourceItem !== null}
							· <a href={inboxItemHref(ticket.sourceItem)}>Original ansehen</a>
						{/if}
					</dd>
				</div>
			{/if}
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
				{#if ticket.recurring && ticket.status !== 'done'}Die Regel läuft weiter.{/if}
			</p>
		</ConfirmDialog>
	{:else}
		<p class="loading" role="status">Ticket wird geladen …</p>
	{/if}
</Drawer>

<style>
	.key {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
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

	.meta a {
		color: var(--color-brand-text);
	}

	.grow {
		flex: 1;
	}
</style>
