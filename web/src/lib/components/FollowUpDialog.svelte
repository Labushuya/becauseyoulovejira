<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { charmName } from '$lib/domain/charms';
	import { projectPath } from '$lib/domain/project-tree';
	import {
		DEFAULT_FOLLOW_UP_TAKE,
		followUpTitle,
		followUpTitleError,
		FOLLOW_UP_TITLE_MAX,
		type FollowUpTake
	} from '$lib/domain/ticket-origins';
	import type { ProjectRef, Ticket } from '$lib/domain/ticket';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { TicketFollowUpStore } from '$lib/stores/ticket-follow-up.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Field from './form/Field.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';

	// "Folge-Ticket anlegen …" (QT-1, ADR-0067 §4): a new ticket that stems from this one. The title
	// starts as "Folge: ‹Titel›"; project and area come from the source (an archived project not, the
	// dialog says so); tags and charm are taken over unless unchecked, the description only when
	// checked. The new ticket is a task ("Aufgabe") and starts open. The server creates it and the link
	// in one transaction; then the dialog closes and the owner opens the new ticket. In the side panel
	// and a row a modal M; inside a modal (the full view) the same form stands inline (InlineDialog,
	// ADR-0025 addendum 16).
	let {
		ticket,
		project = null,
		store,
		onopen,
		onclose,
		returnFocus
	}: {
		ticket: Pick<Ticket, 'id' | 'key' | 'title' | 'tags' | 'charm' | 'description'>;
		/** The project of the source as the catalog knows it (with `archived`), null without one. */
		project?: ProjectRef | null;
		store: TicketFollowUpStore;
		/** Opens a ticket in the remembered way (the new one, or the source from the flag). */
		onopen: (ticketId: string) => void;
		/** Cancel, or after creating. */
		onclose: () => void;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const describedId = `${uid}-described`;
	const inline = insideModal();

	let title = $state(untrack(() => followUpTitle(ticket.title)));
	let take = $state<FollowUpTake>({ ...DEFAULT_FOLLOW_UP_TAKE });
	let titleError = $state('');
	let message = $state<string | null>(null);
	let busy = $state(false);
	let formElement = $state<HTMLFormElement>();

	const tagNames = $derived(ticket.tags.map((tag) => tag.name).join(', '));
	const charm = $derived(ticket.charm ? charmName(ticket.charm) : '');
	const projectText = $derived.by(() => {
		if (project === null) return 'Das Folge-Ticket kommt ohne Projekt in denselben Bereich.';
		if (project.archived) {
			return `„${projectPath(project)}“ ist archiviert; das Folge-Ticket kommt ohne Projekt in denselben Bereich.`;
		}
		return `Das Folge-Ticket kommt in das Projekt „${projectPath(project)}“ im selben Bereich.`;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		message = null;
		titleError = followUpTitleError(title) ?? '';
		if (titleError !== '') {
			await tick();
			formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
			return;
		}
		busy = true;
		try {
			const result = await store.create(
				{ id: ticket.id, key: ticket.key },
				{ title, take: { ...take } },
				onopen
			);
			if (result.ok) {
				onclose();
				onopen(result.outcome.id);
				return;
			}
			titleError = result.title ?? '';
			message = result.message;
		} finally {
			busy = false;
		}
		await tick();
		formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}
</script>

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={submit} bind:this={formElement}>
		<p id={describedId}>
			Ein neues Ticket, das aus {ticket.key} stammt. Beide Tickets zeigen die Verknüpfung und vermerken
			sie im Verlauf.
		</p>
		<Field label="Titel" error={titleError}>
			{#snippet control(field)}
				<input
					{...field}
					type="text"
					maxlength={FOLLOW_UP_TITLE_MAX}
					autocomplete="off"
					bind:value={title}
					oninput={() => (titleError = '')}
				/>
			{/snippet}
		</Field>
		<fieldset class="group">
			<legend>Übernehmen</legend>
			<label class="choice">
				<input type="checkbox" bind:checked={take.tags} />
				Tags: {tagNames === '' ? 'keine' : tagNames}
			</label>
			{#if ticket.charm !== undefined}
				<label class="choice">
					<input type="checkbox" bind:checked={take.charm} />
					Charm: {charm === '' ? 'keiner' : charm}
				</label>
			{/if}
			<label class="choice">
				<input type="checkbox" bind:checked={take.description} />
				Beschreibung{ticket.description.trim() === '' ? ' (leer)' : ''}
			</label>
		</fieldset>
		<p class="hint">{projectText} Es ist eine Aufgabe und startet offen.</p>
		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		Abbrechen
	</button>
	<button
		class="button-primary"
		type="submit"
		form={formId}
		aria-disabled={busy}
		aria-busy={busy ? 'true' : undefined}
	>
		{busy ? 'Wird angelegt …' : 'Folge-Ticket anlegen'}
	</button>
{/snippet}

{#if inline}
	<InlineDialog
		open
		title={`Folge-Ticket aus ${ticket.key}`}
		describedBy={describedId}
		{busy}
		{returnFocus}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal
		open
		size="m"
		title={`Folge-Ticket aus ${ticket.key}`}
		describedBy={describedId}
		{busy}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.875rem;
		font-size: var(--font-size-body);
	}

	.group {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
