<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import type { TicketChoice } from '$lib/data/tickets';
	import type { RequestOptions } from '$lib/data/options';
	import ErrorIcon from './ErrorIcon.svelte';

	// Ticket search as a combobox (ADR-0031 section 7; WAI-ARIA APG "combobox with listbox popup",
	// list autocomplete): typing searches the server by number, key or title after a short pause,
	// the list stands in the flow below the field (inside a modal, so no own popover and no glass),
	// arrow keys move the active option, Enter chooses it, Escape closes the list or else empties
	// the field and is then consumed. Options are never focused; the keyboard stays in the field
	// (aria-activedescendant). A status line says what the search found.
	let {
		label,
		search,
		value = $bindable(null),
		error = null,
		hint = '',
		delay = 200
	}: {
		label: string;
		search: (text: string, options: RequestOptions) => Promise<TicketChoice[]>;
		/** The chosen ticket, null while none is chosen. */
		value?: TicketChoice | null;
		/** Field error (ADR-0009), e.g. "Bitte ein Ticket wählen." */
		error?: string | null;
		hint?: string;
		/** Pause after typing before the search runs, in milliseconds. */
		delay?: number;
	} = $props();

	const uid = $props.id();
	const inputId = `${uid}-input`;
	const listboxId = `${uid}-listbox`;
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;
	const optionId = (index: number) => `${uid}-option-${index}`;

	let text = $state(value === null ? '' : choiceText(value));
	let options = $state<TicketChoice[]>([]);
	let activeIndex = $state(-1);
	let expanded = $state(false);
	let status = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;

	const describedBy = $derived(
		[hint === '' ? '' : hintId, error ? errorId : ''].filter((part) => part !== '').join(' ') ||
			undefined
	);
	const activeId = $derived(expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined);

	function choiceText(choice: TicketChoice): string {
		return `${choice.key} ${choice.title}`;
	}

	function cancelSearch() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		controller?.abort();
		controller = null;
	}

	async function run(query: string) {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		status = 'Suche …';
		try {
			const found = await search(query, { signal: current.signal });
			if (current.signal.aborted) return;
			options = found;
			activeIndex = found.length > 0 ? 0 : -1;
			expanded = found.length > 0;
			status =
				found.length === 0
					? 'Kein Ticket gefunden.'
					: found.length === 1
						? '1 Ticket gefunden.'
						: `${found.length} Tickets gefunden.`;
		} catch {
			if (current.signal.aborted) return;
			options = [];
			expanded = false;
			status = 'Die Suche ist fehlgeschlagen. Bitte erneut tippen.';
		}
	}

	function oninput() {
		value = null;
		cancelSearch();
		const query = text.trim();
		if (query === '') {
			options = [];
			expanded = false;
			status = '';
			return;
		}
		timer = setTimeout(() => {
			timer = null;
			void run(query);
		}, delay);
	}

	function choose(choice: TicketChoice) {
		cancelSearch();
		value = choice;
		text = choiceText(choice);
		expanded = false;
		status = `${choice.key} gewählt.`;
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowDown':
				if (options.length === 0) return;
				event.preventDefault();
				if (!expanded) {
					expanded = true;
					activeIndex = 0;
				} else activeIndex = (activeIndex + 1) % options.length;
				break;
			case 'ArrowUp':
				if (options.length === 0) return;
				event.preventDefault();
				if (!expanded) {
					expanded = true;
					activeIndex = options.length - 1;
				} else activeIndex = (activeIndex - 1 + options.length) % options.length;
				break;
			case 'Enter': {
				const choice = expanded ? options[activeIndex] : undefined;
				if (choice === undefined) return;
				event.preventDefault();
				choose(choice);
				break;
			}
			case 'Escape':
				// The list, then the text; only then Escape belongs to the modal around.
				if (expanded) {
					event.preventDefault();
					event.stopPropagation();
					expanded = false;
				} else if (text !== '') {
					event.preventDefault();
					event.stopPropagation();
					cancelSearch();
					text = '';
					value = null;
					options = [];
					status = '';
				}
				break;
		}
	}

	$effect(() => () => cancelSearch());
</script>

<div class="combobox">
	<label for={inputId}>{label}</label>
	<input
		id={inputId}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-autocomplete="list"
		aria-expanded={expanded}
		aria-controls={listboxId}
		aria-activedescendant={activeId}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		bind:value={text}
		{oninput}
		{onkeydown}
		onblur={() => (expanded = false)}
	/>
	{#if hint !== ''}
		<p class="hint" id={hintId}>{hint}</p>
	{/if}
	{#if error}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<ul class="listbox" id={listboxId} role="listbox" aria-label="Tickets" hidden={!expanded}>
		{#each options as option, index (option.id)}
			<!-- Options are never focused: the keyboard works on the field (aria-activedescendant),
			     the click is for the mouse. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id={optionId(index)}
				class="option"
				class:active={index === activeIndex}
				role="option"
				aria-selected={index === activeIndex}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => choose(option)}
			>
				<span class="key">{option.key}</span>
				<span class="title">{option.title}</span>
				{#if option.status === 'done'}
					<span class="status">{STATUS_LABELS.done}</span>
				{/if}
			</li>
		{/each}
	</ul>
	<p class="visually-hidden" aria-live="polite">{status}</p>
</div>

<style>
	.combobox {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	input {
		width: 100%;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.listbox {
		display: grid;
		max-height: 15rem;
		margin: 0;
		padding: 0.25rem;
		overflow-y: auto;
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.listbox[hidden] {
		display: none;
	}

	.option {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.25rem 0.5rem;
		font-size: var(--font-size-control);
		border-radius: var(--radius-item);
		cursor: pointer;
	}

	.option.active {
		color: var(--color-on-brand);
		background: var(--color-brand);
	}

	.key {
		font-family: var(--font-mono);
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		font-size: var(--font-size-small);
	}
</style>
