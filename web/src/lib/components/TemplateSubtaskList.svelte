<script lang="ts">
	import { tick } from 'svelte';
	import {
		TEMPLATE_STATUSES,
		TEMPLATE_SUBTASKS_MAX,
		isTemplateStatus,
		moveSubtask,
		subtaskCountText,
		subtaskStatusProblemText,
		subtasksOfTicket,
		takeSubtasks,
		takenText,
		type TemplateStatus,
		type TemplateSubtask,
		type TicketSubtask
	} from '$lib/domain/series-template';
	import { isPriority } from '$lib/domain/status';
	import { DEFAULT_PRIORITY, TITLE_MAX_LENGTH } from '$lib/domain/ticket';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import StatusSelect from './StatusSelect.svelte';

	// The list "Unteraufgaben" of the template of a rule (plan WV-3, ADR-0022 addendum 10): every
	// next ticket of the series gets these entries as new sub-tasks. Each row has a title (required),
	// since UT-1 a status (with `statusAvailable`: every one but "Erledigt", without an own choice
	// `defaultStatus`, the "Status beim Anlegen"; choosing that one again follows it again) and a
	// priority; rows are added, removed and moved with named buttons, so keyboard and screen reader
	// reach every step (no dragging), and a polite status says what happened. At most
	// TEMPLATE_SUBTASKS_MAX rows. At a ticket of the series "Unteraufgaben dieses Tickets übernehmen"
	// fills the list with its sub-tasks: at once into an empty list, otherwise after an inline question
	// "Ergänzen" (default, nothing is lost) or "Ersetzen". No dialog: the list stands in the full view
	// as well (ADR-0025 addendum 16). `subtasks` is replaced as a whole on every change, so a binding
	// through getter and setter (a draft in a store) works. "Neues Ticket" (NT-1) uses the same list
	// for the sub-tasks of the new ticket, with its own hint and the status of the ticket as default.
	// Since RG-1 every control of a row has a short visible name above it ("Titel", "Status",
	// "Priorität", in the order of "Neues Ticket"); its accessible name adds the row ("Status der
	// Unteraufgabe 2"), so a screen reader knows which row a field belongs to. Since UT-2 a failed
	// question whether the hooks take the status (`statusProblem`) is no "server without it": the hint
	// stays neutral, and a message says why with "Erneut versuchen" (`onretrystatus`).
	let {
		subtasks = $bindable(),
		ticketSubtasks = [],
		invalidRows = [],
		error = null,
		errorRow = null,
		busy = false,
		disabled = false,
		statusAvailable = false,
		statusProblem = null,
		statusBusy = false,
		onretrystatus,
		defaultStatus = 'open',
		hint
	}: {
		subtasks: TemplateSubtask[];
		/** Sub-tasks of the ticket the template is edited at; empty elsewhere (rule panel). */
		ticketSubtasks?: readonly TicketSubtask[];
		/** Rows the owner refused for a missing title; marked until they have one. */
		invalidRows?: readonly number[];
		/** A refusal of the list by the server. */
		error?: string | null;
		/** The row that refusal names (`params.index`), marked with it; null for the list as a whole. */
		errorRow?: number | null;
		busy?: boolean;
		/** No rows can be added (the hint says why). */
		disabled?: boolean;
		/** Each row offers its status (UT-1): the hooks know it (after the restart after UT-1). */
		statusAvailable?: boolean;
		/**
		 * Why the question for `statusAvailable` failed (UT-2), null otherwise: whether a row may have a
		 * status is unknown then.
		 */
		statusProblem?: string | null;
		/** That question runs again. */
		statusBusy?: boolean;
		/** "Erneut versuchen" of that question; without it the message has no button. */
		onretrystatus?: () => void;
		/** The status a row without an own choice shows and starts with. */
		defaultStatus?: TemplateStatus;
		/** What the list is for, below its legend; without one the text of the template. */
		hint?: string;
	} = $props();

	/** In the phone frame the titles start with a capital letter (MO-7a, as "＋" since MO-5). */
	const mobileLayout = getMobileLayoutStore();

	/**
	 * What the list of a template means, before and after the hooks of UT-1; "offene … ohne
	 * Fälligkeit" only when the server answered so, not when the question failed (UT-2).
	 */
	const shownHint = $derived(
		hint ??
			(statusAvailable
				? `Jedes neue Ticket der Serie bekommt sie als Unteraufgaben mit seiner Fälligkeit, Art und Zuständigkeit, höchstens ${TEMPLATE_SUBTASKS_MAX}. Ohne eigene Wahl starten sie mit dem „Status beim Anlegen“.`
				: statusProblem !== null
					? `Jedes neue Ticket der Serie bekommt sie als Unteraufgaben, höchstens ${TEMPLATE_SUBTASKS_MAX}.`
					: `Jedes neue Ticket der Serie bekommt sie als offene Unteraufgaben ohne Fälligkeit, höchstens ${TEMPLATE_SUBTASKS_MAX}.`)
	);

	const uid = $props.id();
	const ids = {
		legend: `${uid}-legend`,
		hint: `${uid}-hint`,
		error: `${uid}-error`,
		question: `${uid}-question`
	};
	const titleId = (index: number) => `${uid}-title-${index}`;
	const statusId = (index: number) => `${uid}-status-${index}`;
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

	/** The status of a row: the default again means "follow it" (no own status). */
	function setStatus(index: number, entry: TemplateSubtask, value: string) {
		if (!isTemplateStatus(value)) return;
		setRow(index, {
			title: entry.title,
			priority: entry.priority,
			...(value !== defaultStatus && { status: value })
		});
	}

	async function add() {
		if (busy || full || disabled) return;
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

{#snippet retryStatus()}
	<button
		class="button-subtle"
		type="button"
		aria-busy={statusBusy ? 'true' : undefined}
		onclick={() => {
			if (!statusBusy) onretrystatus?.();
		}}>Erneut versuchen</button
	>
{/snippet}

<fieldset class="subtasks" aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}>
	<legend id={ids.legend}>Unteraufgaben</legend>
	<p class="hint" id={ids.hint}>{shownHint}</p>
	{#if !statusAvailable && statusProblem !== null}
		<SectionMessage tone="error" compact actions={onretrystatus ? retryStatus : undefined}>
			{subtaskStatusProblemText(statusProblem)}
		</SectionMessage>
	{/if}
	{#if subtasks.length > 0}
		<ol class="list" aria-labelledby={ids.legend} bind:this={list}>
			{#each subtasks as entry, index (index)}
				{@const invalid = invalidRows.includes(index) && entry.title.trim() === ''}
				{@const refused = !invalid && error !== null && errorRow === index}
				<li class="row">
					<span class="position" aria-hidden="true">{index + 1}.</span>
					<!-- Each control with its name above it, short and visible; the number of the row
					     only for screen readers ("Status der Unteraufgabe 2"). -->
					<div class="cell title">
						<label class="cell-label" for={titleId(index)}>
							Titel <span class="visually-hidden">der Unteraufgabe {index + 1}</span>
						</label>
						<input
							id={titleId(index)}
							type="text"
							required
							aria-required="true"
							autocomplete="off"
							autocapitalize={mobileLayout.active ? 'sentences' : undefined}
							maxlength={TITLE_MAX_LENGTH}
							data-row-part="title"
							value={entry.title}
							aria-invalid={invalid || refused ? 'true' : undefined}
							aria-describedby={invalid ? rowErrorId(index) : refused ? ids.error : undefined}
							oninput={(event) => setRow(index, { ...entry, title: event.currentTarget.value })}
						/>
					</div>
					{#if statusAvailable}
						<div class="cell">
							<label class="cell-label" for={statusId(index)}>
								Status <span class="visually-hidden">der Unteraufgabe {index + 1}</span>
							</label>
							<StatusSelect
								id={statusId(index)}
								value={entry.status ?? defaultStatus}
								statuses={TEMPLATE_STATUSES}
								errorId={`${statusId(index)}-error`}
								onchoose={(value) => setStatus(index, entry, value)}
							/>
						</div>
					{/if}
					<div class="cell">
						<label class="cell-label" for={priorityId(index)}>
							Priorität <span class="visually-hidden">der Unteraufgabe {index + 1}</span>
						</label>
						<PrioritySelect
							id={priorityId(index)}
							value={entry.priority}
							errorId={`${priorityId(index)}-error`}
							onchoose={(value) => {
								if (isPriority(value)) setRow(index, { ...entry, priority: value });
							}}
						/>
					</div>
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
			aria-disabled={full || busy || disabled ? 'true' : undefined}
			aria-describedby={full ? `${uid}-full` : disabled ? ids.hint : undefined}
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

	/*
	 * Title, status, priority and the buttons in one row, each control with its short name above it
	 * (RG-1, ADR-0060: the label above the control); on narrow columns status, priority and the
	 * buttons wrap below and keep their names. Number and buttons sit on the line of the controls.
	 */
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.5rem;
		align-items: end;
		min-width: 0;
	}

	.position {
		display: inline-flex;
		flex: none;
		align-items: center;
		min-width: 1.5rem;
		min-height: var(--control-height-m);
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.cell {
		display: grid;
		flex: 0 1 auto;
		gap: 0.125rem;
		min-width: 0;
	}

	.cell.title {
		flex: 1 1 10rem;
	}

	.cell.title input[type='text'] {
		width: 100%;
	}

	/* Short names of the controls of a row, in the size of the hints (compact, RG-1). */
	.cell-label {
		font-size: var(--font-size-small);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.moves {
		display: inline-flex;
		flex: none;
	}

	/* The error of a row stands on a line of its own below it. */
	.row > .field-error {
		flex-basis: 100%;
	}

	@media (pointer: coarse) {
		.position {
			min-height: var(--control-height-touch);
		}
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
