<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { isPriority, isStatus, type Priority, type Status } from '$lib/domain/status';
	import {
		DEFAULT_PRIORITY,
		DEFAULT_STATUS,
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type TicketDraft
	} from '$lib/domain/ticket';
	import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import StatusSelect from './StatusSelect.svelte';

	// "Neues Ticket" in the side panel (E2 plan, T-8 and package 8): title (required, focused),
	// priority "Mittel", status "Offen", due date and description. "Anlegen" or Ctrl+Enter
	// creates; the button is locked during the request, so a double click creates one ticket.
	// "Abbrechen" and Escape ask first if something was entered.
	let {
		oncreate,
		oncreated,
		oncancel
	}: {
		oncreate: (draft: TicketDraft) => Promise<CreateResult>;
		oncreated: (id: string) => void;
		oncancel: () => void;
	} = $props();

	const DISCARD_QUESTION = 'Neues Ticket verwerfen? Die Eingaben gehen verloren.';

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		title: `${uid}-title`,
		titleHint: `${uid}-title-hint`,
		titleError: `${uid}-title-error`,
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		dueError: `${uid}-due-error`,
		description: `${uid}-description-error`
	};

	let title = $state('');
	let status = $state<Status>(DEFAULT_STATUS);
	let priority = $state<Priority>(DEFAULT_PRIORITY);
	let due = $state('');
	let dueInvalid = $state(false);
	let description = $state('');
	let pending = $state(false);
	let message = $state<string | null>(null);
	let fieldErrors = $state<Partial<Record<keyof TicketDraft, string>>>({});
	let titleInput = $state<HTMLInputElement>();

	const missingTitle = $derived(title.trim() === '');
	const dirty = $derived(
		title !== '' ||
			description !== '' ||
			due !== '' ||
			dueInvalid ||
			status !== DEFAULT_STATUS ||
			priority !== DEFAULT_PRIORITY
	);
	const dueError = $derived(dueInvalid ? 'Ungültiges Datum.' : (fieldErrors.due ?? null));

	$effect(() => {
		titleInput?.focus();
	});

	async function submit(event?: Event) {
		event?.preventDefault();
		if (pending) return;
		if (missingTitle || dueInvalid) {
			if (missingTitle) titleInput?.focus();
			return;
		}
		pending = true;
		message = null;
		fieldErrors = {};
		const result = await oncreate({
			title,
			description,
			status,
			priority,
			due: due === '' ? null : (due as CalendarDate)
		});
		if (result.ok) {
			oncreated(result.ticket.id);
			return;
		}
		pending = false;
		message = result.message;
		fieldErrors = result.fields;
		if (result.fields.title) titleInput?.focus();
	}

	function cancel() {
		if (pending) return;
		if (dirty && !window.confirm(DISCARD_QUESTION)) return;
		oncancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void submit();
		} else if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			cancel();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="side-panel" aria-labelledby={ids.heading} {onkeydown}>
	<h2 id={ids.heading}>Neues Ticket</h2>

	<div aria-live="polite">
		{#if message}
			<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
		{/if}
	</div>

	<form class="form" novalidate onsubmit={submit}>
		<div class="field">
			<label for={ids.title}>Titel</label>
			<input
				id={ids.title}
				type="text"
				required
				aria-required="true"
				maxlength={TITLE_MAX_LENGTH}
				aria-invalid={fieldErrors.title ? 'true' : undefined}
				aria-describedby={fieldErrors.title ? ids.titleError : undefined}
				bind:value={title}
				bind:this={titleInput}
			/>
			{#if fieldErrors.title}
				<p class="field-error" id={ids.titleError}><ErrorIcon /><span>{fieldErrors.title}</span></p>
			{/if}
		</div>

		<div class="row">
			<div class="field">
				<label for={ids.status}>Status</label>
				<StatusSelect
					id={ids.status}
					value={status}
					disabled={pending}
					error={fieldErrors.status ?? null}
					errorId={`${ids.status}-error`}
					onchoose={(value) => {
						if (isStatus(value)) status = value;
					}}
				/>
			</div>
			<div class="field">
				<label for={ids.priority}>Priorität</label>
				<PrioritySelect
					id={ids.priority}
					value={priority}
					disabled={pending}
					error={fieldErrors.priority ?? null}
					errorId={`${ids.priority}-error`}
					onchoose={(value) => {
						if (isPriority(value)) priority = value;
					}}
				/>
			</div>
			<div class="field">
				<label for={ids.due}>Fälligkeit</label>
				<input
					id={ids.due}
					type="date"
					aria-invalid={dueError ? 'true' : undefined}
					aria-describedby={dueError ? ids.dueError : undefined}
					bind:value={due}
					oninput={(event) => (dueInvalid = event.currentTarget.validity.badInput)}
				/>
			</div>
		</div>
		{#if dueError}
			<p class="field-error" id={ids.dueError}><ErrorIcon /><span>{dueError}</span></p>
		{/if}

		<MarkdownEditor
			label="Beschreibung"
			maxlength={DESCRIPTION_MAX_LENGTH}
			rows={6}
			bind:value={description}
			aria-invalid={fieldErrors.description ? 'true' : undefined}
			aria-describedby={fieldErrors.description ? ids.description : undefined}
		/>
		{#if fieldErrors.description}
			<p class="field-error" id={ids.description}>
				<ErrorIcon /><span>{fieldErrors.description}</span>
			</p>
		{/if}

		<div class="buttons">
			<button
				class="button-primary"
				type="submit"
				aria-disabled={missingTitle || pending ? 'true' : undefined}
				aria-describedby={missingTitle ? ids.titleHint : undefined}
			>
				{pending ? 'Wird angelegt …' : 'Anlegen'}
			</button>
			<button class="secondary" type="button" onclick={cancel}>Abbrechen</button>
		</div>
		{#if missingTitle}
			<p class="hint" id={ids.titleHint}>Zum Anlegen fehlt noch ein Titel.</p>
		{/if}
		<p class="hint">Tipp: Strg+Enter legt das Ticket an.</p>
	</form>
</aside>

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	.field {
		display: grid;
		gap: 0.375rem;
		align-content: start;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input,
	.form :global(select) {
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	input[type='text'] {
		width: 100%;
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.secondary {
		padding: 0.625rem 1rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
