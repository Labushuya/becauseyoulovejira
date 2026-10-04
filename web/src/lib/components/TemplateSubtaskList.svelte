<script lang="ts">
	import { tick } from 'svelte';
	import {
		TEMPLATE_SUBTASKS_MAX,
		moveSubtask,
		subtaskCountText,
		subtasksOfTicket,
		takeSubtasks,
		takenText,
		type TemplateSubtask,
		type TicketSubtask
	} from '$lib/domain/series-template';
	import { isPriority } from '$lib/domain/status';
	import { DEFAULT_PRIORITY, TITLE_MAX_LENGTH } from '$lib/domain/ticket';
	import ErrorIcon from './ErrorIcon.svelte';
	import PrioritySelect from './PrioritySelect.svelte';

	// The list "Unteraufgaben" of the template of a rule (plan WV-3, ADR-0022 addendum 10): every
	// next ticket of the series gets these entries as new, open sub-tasks. Each row has a title
	// (required) and a priority; rows are added, removed and moved with named buttons, so keyboard
	// and screen reader reach every step (no dragging), and a polite status says what happened. At
	// most TEMPLATE_SUBTASKS_MAX rows. At a ticket of the series "Unteraufgaben dieses Tickets
	// übernehmen" fills the list with its sub-tasks: at once into an empty list, otherwise after an
	// inline question "Ergänzen" (default, nothing is lost) or "Ersetzen". No dialog: the list stands
	// in the full view as well (ADR-0025 addendum 16). `subtasks` is replaced as a whole on every
	// change, so a binding through getter and setter (a draft in a store) works.
	let {
		subtasks = $bindable(),
		ticketSubtasks = [],
		invalidRows = [],
		error = null,
		busy = false
	}: {
		subtasks: TemplateSubtask[];
		/** Sub-tasks of the ticket the template is edited at; empty elsewhere (rule panel). */
		ticketSubtasks?: readonly TicketSubtask[];
		/** Rows the owner refused for a missing title; marked until they have one. */
		invalidRows?: readonly number[];
		/** A refusal of the list by the server. */
		error?: string | null;
		busy?: boolean;
	} = $props();

	const uid = $props.id();
	const ids = {
		legend: `${uid}-legend`,
		hint: `${uid}-hint`,
		error: `${uid}-error`,
		question: `${uid}-question`
	};
	const titleId = (index: number) => `${uid}-title-${index}`;
	const priorityId = (index: number) => `${uid}-priority-${index}`;
	const rowErrorId = (index: number) => `${uid}-row-error-${index}`;

	const full = $derived(subtasks.length >= TEMPLATE_SUBTASKS_MAX);
	const fromTicket = $derived(subtasksOfTicket(ticketSubtasks));

	/** Polite status of the last step ("„Filter“ an Position 2 verschoben."). */
	let status = $state('');
	/** The question "Ergänzen" or "Ersetzen" while it is open. */
	let asking = $state(false);
	let list = $state<HTMLOListElement>();
	let addButton = $state<HTMLButtonElement>();
	let takeButton = $state<HTMLButtonElement>();
	let appendButton = $state<HTMLButtonElement>();

	/** How a row is named on its buttons: its title, or its position while it has none. */
	function nameOf(index: number): string {
		const title = subtasks[index]?.title.trim() ?? '';
		return title === '' ? `Unteraufgabe ${index + 1}` : `„${title}“`;
	}

	function rowControl(index: number, part: 'title' | 'up' | 'down'): HTMLElement | null {
		return list?.querySelectorAll<HTMLElement>(`[data-row-part="${part}"]`)[index] ?? null;
	}

	function setRow(index: number, entry: TemplateSubtask) {
		subtasks = subtasks.map((current, position) => (position === index ? entry : current));
	}

	async function add() {
		if (busy || full) return;
		subtasks = [...subtasks, { title: '', priority: DEFAULT_PRIORITY }];
		status = '';
		await tick();
		rowControl(subtasks.length - 1, 'title')?.focus();
	}

	async function remove(index: number) {
		if (busy) return;
		const name = nameOf(index);
		subtasks = subtasks.filter((_entry, position) => position !== index);
		status = `${name} entfernt.`;
		await tick();
		const next = Math.min(index, subtasks.length - 1);
		(next >= 0 ? rowControl(next, 'title') : addButton)?.focus();
	}

	async function move(index: number, to: number) {
		if (busy || to < 0 || to >= subtasks.length) return;
		const name = nameOf(index);
		subtasks = moveSubtask(subtasks, index, to);
		status = `${name} an Position ${to + 1} von ${subtasks.length} verschoben.`;
		await tick();
		// The focus stays with the moved row, on the button that can still move it.
		const same = to < index ? 'up' : 'down';
		const canGoOn = same === 'up' ? to > 0 : to < subtasks.length - 1;
		rowControl(to, canGoOn ? same : same === 'up' ? 'down' : 'up')?.focus();
	}

	async function take(replace: boolean) {
		const taken = takeSubtasks(subtasks, fromTicket, replace);
		subtasks = taken.subtasks;
		status = takenText(taken);
		asking = false;
		await tick();
		takeButton?.focus();
	}

	/** "Unteraufgaben dieses Tickets übernehmen": an empty list takes them at once, else it asks. */
	async function startTake() {
		if (busy) return;
		if (subtasks.length === 0) {
			await take(true);
			return;
		}
		asking = !asking;
		await tick();
		if (asking) appendButton?.focus();
	}

	async function endQuestion() {
		asking = false;
		await tick();
		takeButton?.focus();
	}

	/** Escape closes the question only (the form around it stays). */
	function questionKeys(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		void endQuestion();
	}
</script>

<fieldset class="subtasks" aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}>
	<legend id={ids.legend}>Unteraufgaben</legend>
	<p class="hint" id={ids.hint}>
		Jedes neue Ticket der Serie bekommt sie als offene Unteraufgaben ohne Fälligkeit, höchstens {TEMPLATE_SUBTASKS_MAX}.
	</p>
	{#if subtasks.length > 0}
		<ol class="list" aria-labelledby={ids.legend} bind:this={list}>
			{#each subtasks as entry, index (index)}
				{@const invalid = invalidRows.includes(index) && entry.title.trim() === ''}
				<li class="row">
					<span class="position" aria-hidden="true">{index + 1}.</span>
					<label class="visually-hidden" for={titleId(index)}>
						Titel der Unteraufgabe {index + 1}
					</label>
					<input
						id={titleId(index)}
						class="title"
						type="text"
						required
						aria-required="true"
						autocomplete="off"
						maxlength={TITLE_MAX_LENGTH}
						data-row-part="title"
						value={entry.title}
						aria-invalid={invalid ? 'true' : undefined}
						aria-describedby={invalid ? rowErrorId(index) : undefined}
						oninput={(event) => setRow(index, { ...entry, title: event.currentTarget.value })}
					/>
					<label class="visually-hidden" for={priorityId(index)}>
						Priorität der Unteraufgabe {index + 1}
					</label>
					<PrioritySelect
						id={priorityId(index)}
						value={entry.priority}
						errorId={`${priorityId(index)}-error`}
						onchoose={(value) => {
							if (isPriority(value)) setRow(index, { ...entry, priority: value });
						}}
					/>
					<span class="moves">
						<button
							class="button-icon"
							type="button"
							data-row-part="up"
							aria-label={`${nameOf(index)} nach oben verschieben`}
							title="Nach oben verschieben"
							aria-disabled={index === 0 || busy ? 'true' : undefined}
							onclick={() => void move(index, index - 1)}
						>
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
								<path d="M8 13V3M4 7l4-4 4 4" />
							</svg>
						</button>
						<button
							class="button-icon"
							type="button"
							data-row-part="down"
							aria-label={`${nameOf(index)} nach unten verschieben`}
							title="Nach unten verschieben"
							aria-disabled={index === subtasks.length - 1 || busy ? 'true' : undefined}
							onclick={() => void move(index, index + 1)}
						>
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
								<path d="M8 3v10M4 9l4 4 4-4" />
							</svg>
						</button>
						<button
							class="button-icon"
							type="button"
							aria-label={`${nameOf(index)} entfernen`}
							title="Unteraufgabe entfernen"
							aria-disabled={busy ? 'true' : undefined}
							onclick={() => void remove(index)}
						>
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
								<path d="M4 4l8 8M12 4l-8 8" />
							</svg>
						</button>
					</span>
					{#if invalid}
						<p class="field-error" id={rowErrorId(index)}>
							<ErrorIcon /><span>Bitte einen Titel eingeben.</span>
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<p class="muted">Keine Unteraufgaben.</p>
	{/if}
	<div class="actions">
		<button
			class="button-subtle"
			type="button"
			aria-disabled={full || busy ? 'true' : undefined}
			aria-describedby={full ? `${uid}-full` : undefined}
			bind:this={addButton}
			onclick={() => void add()}
		>
			Unteraufgabe hinzufügen
		</button>
		{#if fromTicket.length > 0}
			<button
				class="button-subtle"
				type="button"
				aria-expanded={subtasks.length > 0 ? asking : undefined}
				aria-controls={asking ? ids.question : undefined}
				aria-disabled={busy ? 'true' : undefined}
				bind:this={takeButton}
				onclick={() => void startTake()}
			>
				Unteraufgaben dieses Tickets übernehmen
			</button>
		{/if}
	</div>
	{#if full}
		<p class="hint" id={`${uid}-full`}>
			Die Liste ist voll: höchstens {TEMPLATE_SUBTASKS_MAX} Unteraufgaben.
		</p>
	{/if}
	{#if asking}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="question"
			role="group"
			id={ids.question}
			aria-labelledby={`${ids.question}-text`}
			onkeydown={questionKeys}
		>
			<p id={`${ids.question}-text`}>
				Die Vorlage hat schon {subtaskCountText(subtasks.length)}. Sollen die
				{subtaskCountText(fromTicket.length)} dieses Tickets dazukommen oder sie ersetzen?
			</p>
			<div class="question-actions">
				<button
					class="button-secondary"
					type="button"
					bind:this={appendButton}
					onclick={() => void take(false)}
				>
					Ergänzen
				</button>
				<button class="button-secondary" type="button" onclick={() => void take(true)}>
					Ersetzen
				</button>
				<button class="button-subtle" type="button" onclick={() => void endQuestion()}>
					Abbrechen
				</button>
			</div>
		</div>
	{/if}
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<p class="visually-hidden" aria-live="polite">{status}</p>
</fieldset>

<style>
	.subtasks {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.list {
		display: grid;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Title, priority and the buttons in one row; on narrow columns the buttons wrap below. */
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
	}

	.position {
		flex: none;
		min-width: 1.5rem;
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.title {
		flex: 1 1 10rem;
		min-width: 0;
	}

	.row :global(select) {
		flex: 0 1 auto;
	}

	.moves {
		display: inline-flex;
		flex: none;
	}

	.moves svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.actions,
	.question-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.question {
		display: grid;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.question p {
		font-size: var(--font-size-body);
	}

	.hint,
	.muted {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
